import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";

// Opt-in: drives the real emulator UI in headless chromium. Needs Playwright + a
// browser provisioned (`deno run -A npm:playwright install chromium`). Run with:
//   KEEP_BROWSER=1 deno test -A --unstable-raw-imports .../emulator-ui/browser.test.ts
const enabled = Deno.env.get("KEEP_BROWSER") === "1";

class CreateDto {
  @ApiProperty()
  name!: string;
}
class RefDto {
  @ApiProperty()
  id!: string;
}
class ThingDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
}

@EndpointController("http")
class HttpController {
  @Endpoint({ path: "create", input: CreateDto, output: ThingDto, order: 1 })
  create(body: CreateDto): ThingDto {
    return { id: "thing-7", name: body.name ?? "anon" };
  }
  @Endpoint({
    path: "fetch",
    input: RefDto,
    output: ThingDto,
    order: 2,
    dependsOn: "create",
    bind: { id: "create.id" },
  })
  fetch(body: RefDto): ThingDto {
    if (!body?.id) throw new Error("missing id");
    return { id: body.id, name: "fetched" };
  }
}

const EmuModule = endpointModule("Emu", [HttpController]);

Deno.test({
  name:
    "emulator — progressive unlock + autofill + checkmarks (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9611;
    const server = await bootstrapServer("emu", EmuModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/emu`);

      const emulateButtons = page.locator("button.emulate");
      // Initially: step 1 enabled, step 2 locked.
      assertEquals(await emulateButtons.nth(0).isDisabled(), false);
      assertEquals(await emulateButtons.nth(1).isDisabled(), true);

      // Emulate step 1 → checkmark, step 2 unlocks. Its body holds the {{reference}} (stable,
      // never rewritten); the "will send" preview resolves it to the captured id.
      await emulateButtons.nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();
      assertEquals(await emulateButtons.nth(1).isDisabled(), false);
      const step2Body = await page.locator("li").nth(1).locator("textarea")
        .inputValue();
      assert(
        step2Body.includes("{{create.id}}"),
        `step 2 body should reference create.id: ${step2Body}`,
      );
      const step2Resolved = await page.locator("li").nth(1).locator(
        ".resolved",
      ).textContent();
      assert(
        step2Resolved?.includes("thing-7"),
        `step 2 resolved request not filled from the captured id: ${step2Resolved}`,
      );

      // Run all → both steps green.
      await page.locator("#runall").click();
      // String predicate runs in the browser; avoids needing the DOM lib in Deno's typecheck.
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 5000 },
      );

      // The curl is paste-ready: absolute URL, single-quoted, compact resolved body.
      const curl = await page.locator("li").nth(1).locator(".curl")
        .textContent();
      assert(
        curl?.includes(`curl -X POST 'http://localhost:${port}/http/fetch'`),
        `curl is not absolute + shell-quoted: ${curl}`,
      );
      assert(
        curl?.includes(`-d '{"id":"thing-7"}'`),
        `curl body is not the compact resolved request: ${curl}`,
      );

      // The session survives a reload: statuses, captured outputs, and the restored note.
      await page.reload();
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 5000 },
      );
      assertEquals(await page.locator("#session-note").isVisible(), true);
      const varsText = await page.locator("#vars").textContent();
      assert(
        varsText?.includes("create.id") && varsText?.includes("thing-7"),
        `variables panel not restored: ${varsText}`,
      );

      // A failing step stops run-all with an explanatory banner (statuses were cleared by the
      // all-green re-run path, so step 1 really re-fires — with a body the server rejects).
      await page.locator("li").nth(0).locator(".path").click();
      await page.locator("li").nth(0).locator("textarea").fill("not json {{");
      await page.locator("#runall").click();
      await page.locator("#banner.err").waitFor({ timeout: 5000 });
      const bannerText = await page.locator("#banner").textContent();
      assert(
        bannerText?.includes("Stopped at step 1") &&
          bannerText?.includes("invalid JSON"),
        `failure banner missing or unclear: ${bannerText}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── flows: XOR branches, the OR-join, and the flow selector ──────────────────

class TicketDto {
  @ApiProperty()
  ticketId!: string;
}
class PaymentDto {
  @ApiProperty()
  paymentId!: string;
}
class DoneDto {
  @ApiProperty()
  done!: boolean;
}

@EndpointController("pay")
class PayController {
  @Endpoint({ path: "start", input: CreateDto, output: TicketDto, order: 1 })
  start(_body: CreateDto): TicketDto {
    return { ticketId: "t-1" };
  }
  @Endpoint({
    path: "card",
    input: TicketDto,
    output: PaymentDto,
    order: 2,
    dependsOn: "start",
    bind: { ticketId: "start.ticketId" },
    flows: "card",
  })
  payCard(body: TicketDto): PaymentDto {
    return { paymentId: `card-${body.ticketId}` };
  }
  @Endpoint({
    path: "cash",
    input: TicketDto,
    output: PaymentDto,
    order: 2,
    dependsOn: "start",
    bind: { ticketId: "start.ticketId" },
    flows: "cash",
  })
  payCash(body: TicketDto): PaymentDto {
    return { paymentId: `cash-${body.ticketId}` };
  }
  @Endpoint({
    path: "fulfill",
    input: PaymentDto,
    output: DoneDto,
    order: 3,
    dependsOn: ["payCard", "payCash"],
    bind: { paymentId: ["payCard.paymentId", "payCash.paymentId"] },
  })
  fulfill(body: PaymentDto): DoneDto {
    if (!body?.paymentId) throw new Error("missing paymentId");
    return { done: true };
  }
}

const PayModule = endpointModule("Pay", [PayController]);

Deno.test({
  name:
    "emulator — flow selector walks one branch; the OR-join unlocks (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9613;
    const server = await bootstrapServer("flows", PayModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/pay`);

      // The selector lists the untagged-only "main" pseudo-flow, All, and both flows (card,
      // cash); branch steps carry flow chips in the All view.
      assertEquals(await page.locator("#flows").isVisible(), true);
      assertEquals(await page.locator("#flows button").count(), 4);

      // Pick the card flow: the cash step disappears, 3 steps remain.
      await page.locator('#flows button[data-flow="card"]').click();
      await page.waitForFunction(
        "document.querySelectorAll('li:not(.offflow)').length === 3",
        { timeout: 5000 },
      );

      // Run all walks start → payCard → fulfill; the join unlocks via the card branch alone,
      // and its OR-bind resolves to the card payment.
      await page.locator("#runall").click();
      await page.waitForFunction(
        "document.querySelectorAll('li:not(.offflow) .dot.ok').length === 3",
        { timeout: 10000 },
      );
      const banner = await page.locator("#banner").textContent();
      assert(
        banner?.includes("All 3 required steps passed"),
        `unexpected banner: ${banner}`,
      );
      const fulfillResolved = await page.locator("li").nth(3).locator(
        ".resolved",
      ).textContent();
      assert(
        fulfillResolved?.includes("card-t-1"),
        `fulfill should have resolved the card alternative: ${fulfillResolved}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── cross-module: declared $inputs + the shared variable scope ───────────────

@EndpointController("a")
class AlphaController {
  @Endpoint({ path: "create", input: CreateDto, output: ThingDto, order: 1 })
  create(body: CreateDto): ThingDto {
    return { id: "thing-7", name: body.name ?? "anon" };
  }
}

@EndpointController("b")
class BetaController {
  // The id comes from OUTSIDE this module — a declared external input.
  @Endpoint({
    path: "register",
    input: RefDto,
    output: ThingDto,
    order: 1,
    bind: { id: "$thingId" },
  })
  register(body: RefDto): ThingDto {
    if (!body?.id) throw new Error("missing id");
    return { id: body.id, name: "registered" };
  }
}

const AlphaModule = endpointModule("Alpha", [AlphaController]);
const BetaModule = endpointModule("Beta", [BetaController]);

Deno.test({
  name:
    "emulator — cross-module $inputs and global captures span docs pages (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9612;
    const server = await bootstrapServer("xmod", [AlphaModule, BetaModule], {
      port,
    });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();

      // Run alpha's create — its output is captured AND published to the shared scope.
      await page.goto(`http://localhost:${port}/docs/alpha`);
      await page.locator("button.emulate").nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();

      // Beta's page: the declared input is listed (unset), and the body references it.
      await page.goto(`http://localhost:${port}/docs/beta`);
      assertEquals(await page.locator("#inputs-card").isVisible(), true);
      const body = await page.locator("li").nth(0).locator("textarea")
        .inputValue();
      assert(
        body.includes("{{$thingId}}"),
        `beta's body should reference the module input: ${body}`,
      );
      // Alpha's capture is visible here as a module-qualified variable.
      const vars = await page.locator("#vars").textContent();
      assert(
        vars?.includes("alpha:create.id"),
        `alpha's capture not in beta's variables panel: ${vars}`,
      );

      // Point the input at alpha's capture once — references resolve recursively, so every
      // future alpha re-run feeds beta with no copying.
      await page.locator('#inputs input[data-gvar="thingId"]').fill(
        "{{alpha:create.id}}",
      );
      const resolved = await page.locator("li").nth(0).locator(".resolved")
        .textContent();
      assert(
        resolved?.includes("thing-7"),
        `beta's resolved request should carry alpha's id: ${resolved}`,
      );
      await page.locator("button.emulate").nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();
      const resp = await page.locator("li").nth(0).locator(".resp")
        .textContent();
      assert(
        resp?.includes('"registered"'),
        `beta's endpoint did not receive the cross-module id: ${resp}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── contract auto-wiring: a composed producer satisfies a $input untouched ───

class MemberOutDto {
  @ApiProperty()
  memberId!: string;
}
class GreetInDto {
  @ApiProperty()
  memberId!: string;
}
class GreetOutDto {
  @ApiProperty()
  greeting!: string;
}

@EndpointController("mint")
class MintController {
  @Endpoint({
    path: "member",
    input: CreateDto,
    output: MemberOutDto,
    order: 1,
  })
  mintMember(_body: CreateDto): MemberOutDto {
    return { memberId: "m-42" };
  }
}

@EndpointController("greet")
class GreetController {
  // memberId is external to THIS module — but the composed mint module produces it.
  @Endpoint({
    path: "hello",
    input: GreetInDto,
    output: GreetOutDto,
    order: 1,
    bind: { memberId: "$memberId" },
  })
  hello(body: GreetInDto): GreetOutDto {
    if (!body?.memberId) throw new Error("missing memberId");
    return { greeting: `hi ${body.memberId}` };
  }
}

const MintModule = endpointModule("Mint", [MintController]);
const GreetModule = endpointModule("Greet", [GreetController]);

Deno.test({
  name:
    "emulator — a composed producer auto-satisfies a $input (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9614;
    const server = await bootstrapServer("xauto", [MintModule, GreetModule], {
      port,
    });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();

      // Run the producer's step — its capture (memberId) lands in the shared scope.
      await page.goto(`http://localhost:${port}/docs/mint`);
      await page.locator("button.emulate").nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();

      // The consumer page: the module-inputs row is satisfied automatically — dim "auto"
      // note, no amber unset treatment — without typing anything.
      await page.goto(`http://localhost:${port}/docs/greet`);
      assertEquals(await page.locator("#inputs-card").isVisible(), true);
      const autoNote = await page.locator("#inputs .input-auto").textContent();
      assert(
        autoNote?.includes("auto: mint:mintMember.memberId"),
        `module input should show the auto affordance: ${autoNote}`,
      );
      assertEquals(await page.locator("#inputs .var-name.unset").count(), 0);
      const resolved = await page.locator("li").nth(0).locator(".resolved")
        .textContent();
      assert(
        resolved?.includes("m-42"),
        `the resolved request should carry the producer's capture: ${resolved}`,
      );

      // The consumer step goes green with no manual input at all.
      await page.locator("button.emulate").nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();
      const resp = await page.locator("li").nth(0).locator(".resp")
        .textContent();
      assert(
        resp?.includes("hi m-42"),
        `the consumer endpoint did not receive the produced value: ${resp}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── per-route copy + run-all follows without auto-expanding ──────────────────

Deno.test({
  name:
    "emulator — copy-route button + run-all keeps boxes collapsed (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9617;
    const server = await bootstrapServer("emu", EmuModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/emu`);

      // Expand step 1 to reach its request panel; its address bar carries a copy-route button
      // that copies the full resolved URL — the button flips to "copied ✓" on success.
      await page.locator("li").nth(0).locator(".path").click();
      await page.locator("li").nth(0).locator(".copy-route").click();
      // The button flips to a "copied" affordance on success.
      await page.locator("li").nth(0).locator(".copy-route").filter({
        hasText: "copied",
      }).waitFor({ timeout: 3000 });

      // Collapse it again, then Run all: the walk must NOT auto-expand any box.
      await page.locator("li").nth(0).locator(".path").click();
      await page.waitForFunction(
        "document.querySelectorAll('li.open').length === 0",
        { timeout: 3000 },
      );
      await page.locator("#runall").click();
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 5000 },
      );
      // Every step passed but stayed collapsed — you open boxes yourself.
      assertEquals(await page.locator("li.open").count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── module setup + persisted variables + the spec/misc/cake.json artifact ─────

Deno.test({
  name:
    "emulator — setup steps + persist vars save to fixtures and restore in a fresh browser (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9619;
    const fixturesDir = await Deno.makeTempDir();
    Deno.env.set("KEEP_FIXTURES_DIR", fixturesDir); // redirect writes off the repo tree
    const server = await bootstrapServer("emu", EmuModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/docs/emu`);

      // Add an environment variable and mark it persist.
      await page.locator('#addvar input[name="varname"]').fill("tenantId");
      await page.locator('#addvar input[name="varvalue"]').fill("t-42");
      await page.locator("#addvar button").click();
      await page.locator('#vars input[data-persist="tenantId"]').check();

      // Snapshot step 1 (create) as a setup step from its Request panel.
      await page.locator("li").nth(0).locator(".path").click();
      await page.locator("li").nth(0).locator(".add-setup").click();
      await page.locator("#setup .setup-row").waitFor({ timeout: 3000 });
      assertEquals(await page.locator("#setup .setup-row").count(), 1);

      // Save the artifact and confirm the success banner.
      await page.locator("#save-fixtures").click();
      await page.locator("#banner.ok").waitFor({ timeout: 5000 });
      const saveBanner = await page.locator("#banner").textContent();
      assert(
        saveBanner?.includes("Saved spec/misc/cake.json"),
        `expected a save banner, got: ${saveBanner}`,
      );

      // The artifact on disk carries the setup step and the persisted variable.
      const onDisk = JSON.parse(
        await Deno.readTextFile(`${fixturesDir}/cake.json`),
      );
      assertEquals(onDisk.variables.tenantId, "t-42");
      assertEquals(onDisk.modules.emu.setup.length, 1);
      assertEquals(onDisk.modules.emu.setup[0].id, "create");

      // A FRESH browser context (empty localStorage) restores both from fixtures alone.
      const fresh = await browser.newContext();
      const page2 = await fresh.newPage();
      await page2.goto(`http://localhost:${port}/docs/emu`);
      // The setup row can only have come from fixtures (this context has no localStorage).
      await page2.locator("#setup .setup-row").waitFor({ timeout: 5000 });
      assertEquals(await page2.locator("#setup .setup-row").count(), 1);
      // The persisted variable is back, with its checkbox checked.
      await page2.locator('#vars input[data-persist="tenantId"]').waitFor({
        timeout: 5000,
      });
      assertEquals(
        await page2.locator('#vars input[data-persist="tenantId"]').isChecked(),
        true,
      );
      assertEquals(
        await page2.locator('#vars input[data-uservar="tenantId"]')
          .inputValue(),
        "t-42",
      );

      // Run setup runs the snapshotted step → it goes green.
      await page2.locator("#run-setup").click();
      await page2.locator('li[data-id="create"] .dot.ok').waitFor({
        timeout: 5000,
      });
    } finally {
      await browser.close();
      await server.stop();
      Deno.env.delete("KEEP_FIXTURES_DIR");
      await Deno.remove(fixturesDir, { recursive: true });
    }
  },
});

// ── per-step expectations: green only when the response meets them ───────────

Deno.test({
  name:
    "emulator — expectations gate green: passing check, then failing check stops run-all (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9621;
    const server = await bootstrapServer("emu", EmuModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/emu`);

      // Pin an expectation on step 1: body.id == thing-7 (what the endpoint always returns).
      await page.locator("li").nth(0).locator(".path").click();
      await page.locator("li").nth(0).locator(".add-check").click();
      await page.locator("li").nth(0).locator(".a-path").fill("id");
      await page.locator("li").nth(0).locator(".a-val").fill("thing-7");
      await page.locator("li").nth(0).locator("button.emulate").click();
      await page.locator('li[data-id="create"] .dot.ok').waitFor({
        timeout: 5000,
      });
      const verdict = await page.locator("li").nth(0).locator(".assert-results")
        .textContent();
      assert(
        verdict?.includes("✓ id == thing-7"),
        `expected a passing verdict: ${verdict}`,
      );

      // Now make it impossible: HTTP stays 200 but the step must go RED and stop run-all.
      await page.locator("li").nth(0).locator(".a-val").fill("nope");
      await page.locator("li").nth(0).locator("button.emulate").click();
      await page.locator(
        'li[data-id="create"] .dot.fail, li[data-id="create"] .dot.warn',
      ).first()
        .waitFor({ timeout: 5000 });
      const mini = await page.locator("li").nth(0).locator(".status-mini")
        .textContent();
      assert(
        mini?.includes("expect ✗"),
        `status-mini should flag the expectation: ${mini}`,
      );
      const verdict2 = await page.locator("li").nth(0).locator(
        ".assert-results",
      ).textContent();
      assert(
        verdict2?.includes("✗ id == nope") && verdict2?.includes("got"),
        `expected a failing verdict with the got value: ${verdict2}`,
      );
      // Same response as the previous run — the diff says so explicitly.
      const diffNote = await page.locator("li").nth(0).locator(".diff")
        .textContent();
      assert(
        diffNote?.includes("unchanged vs previous run"),
        `expected the unchanged note: ${diffNote}`,
      );

      // Run-all stops there and names the expectation in the banner.
      await page.locator("#runall").click();
      await page.locator("#banner.err").waitFor({ timeout: 5000 });
      const bannerText = await page.locator("#banner").textContent();
      assert(
        bannerText?.includes("expectation failed") &&
          bannerText?.includes("id == nope"),
        `banner should name the failed expectation: ${bannerText}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

// ── project heal rules drive the heal panel ──────────────────────────────────

class GateDto {
  @ApiProperty()
  ok!: boolean;
}

@EndpointController("gate")
class GateController {
  static enabled = false;
  @Endpoint({ path: "enable", output: GateDto, order: 1, optional: true })
  enable(): GateDto {
    GateController.enabled = true;
    return { ok: true };
  }
  @Endpoint({ path: "select", output: GateDto, order: 2 })
  select(): GateDto {
    if (!GateController.enabled) throw new Error("not-enabled");
    return { ok: true };
  }
}
const GateModule = endpointModule("Gate", [GateController]);

Deno.test({
  name:
    "emulator — project heal rules (fixtures/heal-rules.json) map a slug to a one-click fix (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9622;
    const fixturesDir = await Deno.makeTempDir();
    Deno.env.set("KEEP_FIXTURES_DIR", fixturesDir);
    await Deno.writeTextFile(
      `${fixturesDir}/heal-rules.json`,
      JSON.stringify({
        v: 1,
        slugs: {
          "not-enabled": [
            {
              kind: "run-step",
              match: "/enable/i",
              why: "the gate must be enabled first",
              todo: true,
            },
          ],
        },
      }),
    );
    GateController.enabled = false;
    const server = await bootstrapServer("gate", GateModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/gate`);

      // Run the gated step directly — it fails with the slug, and the heal panel offers the
      // project rule's fix (run the enable endpoint), not a hardcoded framework guess.
      await page.locator('li[data-id="select"] button.emulate').click();
      await page.locator('li[data-id="select"] .dot.warn').waitFor({
        timeout: 5000,
      });
      await page.locator('li[data-id="select"] .path').click();
      const heal = await page.locator('li[data-id="select"] .heal')
        .textContent();
      assert(
        heal?.includes("Run enable") &&
          heal?.includes("the gate must be enabled first"),
        `heal panel should carry the project rule: ${heal}`,
      );

      // Apply the suggestion → enable runs → retry select → green.
      await page.locator('li[data-id="select"] .heal .apply-sg').first()
        .click();
      await page.locator('li[data-id="enable"] .dot.ok').waitFor({
        timeout: 5000,
      });
      await page.locator('li[data-id="select"] button.emulate').click();
      await page.locator('li[data-id="select"] .dot.ok').waitFor({
        timeout: 5000,
      });
      // The retry's response differs from the failed one — the diff names what changed.
      const diffText = await page.locator('li[data-id="select"] .diff')
        .textContent();
      assert(
        diffText?.includes("changed vs previous run"),
        `expected a changed-response diff: ${diffText}`,
      );
    } finally {
      await browser.close();
      await server.stop();
      Deno.env.delete("KEEP_FIXTURES_DIR");
      await Deno.remove(fixturesDir, { recursive: true });
    }
  },
});

// ── scenarios: save the walk under a name, load it back, run it ──────────────

Deno.test({
  name:
    "emulator — scenarios save/load/run round-trip through fixtures/scenarios (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9623;
    const fixturesDir = await Deno.makeTempDir();
    Deno.env.set("KEEP_FIXTURES_DIR", fixturesDir);
    const server = await bootstrapServer("emu", EmuModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/emu`);

      // Customize step 1's body, then save the walk as a named scenario.
      await page.locator("li").nth(0).locator(".path").click();
      await page.locator("li").nth(0).locator("textarea").fill(
        '{"name":"from-scenario"}',
      );
      await page.locator('#save-scenario input[name="scenname"]').fill(
        "happy path",
      );
      await page.locator("#save-scenario button").click();
      await page.locator("#banner.ok").waitFor({ timeout: 5000 });
      const file = JSON.parse(
        await Deno.readTextFile(`${fixturesDir}/scenarios/happy-path.json`),
      );
      assertEquals(file.module, "emu");
      assert(
        file.steps.find((s: { id: string }) => s.id === "create").body.includes(
          "from-scenario",
        ),
      );

      // A FRESH context (no localStorage): the scenario lists, loads its body, and runs green.
      const fresh = await browser.newContext();
      const page2 = await fresh.newPage();
      await page2.goto(`http://localhost:${port}/docs/emu`);
      await page2.locator("#scenarios .scen-row").waitFor({ timeout: 5000 });
      await page2.locator("#scenarios .scen-load").click();
      const body = await page2.locator("li").nth(0).locator("textarea")
        .inputValue();
      assert(
        body.includes("from-scenario"),
        `scenario body not applied: ${body}`,
      );
      await page2.locator("#scenarios .scen-run").click();
      await page2.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 8000 },
      );
      const resp = await page2.locator("li").nth(0).locator(".resp")
        .textContent();
      assert(
        resp?.includes("from-scenario"),
        `scenario run should use its body: ${resp}`,
      );
    } finally {
      await browser.close();
      await server.stop();
      Deno.env.delete("KEEP_FIXTURES_DIR");
      await Deno.remove(fixturesDir, { recursive: true });
    }
  },
});

// ── app-wide setup: a setup step can call ANOTHER module's endpoint ───────────

Deno.test({
  name:
    "emulator — app-wide setup: a cross-module setup step establishes state and persists to fixtures (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9624;
    const fixturesDir = await Deno.makeTempDir();
    Deno.env.set("KEEP_FIXTURES_DIR", fixturesDir);
    const server = await bootstrapServer("xsetup", [MintModule, GreetModule], {
      port,
    });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // greet's only step needs $memberId, which mint (a DIFFERENT module) produces.
      await page.goto(`http://localhost:${port}/docs/greet`);

      // The picker lists the whole app — pick mint's endpoint as a setup step.
      await page.selectOption("#setup-add", "mint:mintMember");
      await page.locator("#setup .setup-row").waitFor({ timeout: 3000 });
      const label = await page.locator("#setup .setup-name").textContent();
      assert(
        label?.includes("mint:") && label?.includes("/mint/member"),
        `setup row should carry the module qualifier: ${label}`,
      );

      // Run setup → the foreign call fires, its result lands in MINT's session + the shared
      // scope, and greet's $memberId is satisfied without typing anything.
      await page.locator("#run-setup").click();
      await page.locator("#setup .su-dot.ok").waitFor({ timeout: 5000 });
      const written = await page.evaluate<{ status: string; shared: boolean }>(
        `(() => {
          const s = JSON.parse(localStorage.getItem("keep:emulator:/docs/mint"));
          const g = JSON.parse(localStorage.getItem("keep:emulator:globals"));
          return {
            status: s.status.mintMember,
            shared: g.captured["mint:mintMember"].memberId === "m-42",
          };
        })()`,
      );
      assertEquals(written, { status: "ok", shared: true });

      // The whole walk now passes: setup (mint) runs first, then greet's step goes green.
      await page.locator("#runall").click();
      await page.locator('li[data-id="hello"] .dot.ok').waitFor({
        timeout: 8000,
      });
      const resp = await page.locator('li[data-id="hello"] .resp')
        .textContent();
      assert(
        resp?.includes("hi m-42"),
        `greet should have received mint's value: ${resp}`,
      );

      // Save fixtures → the artifact carries the module-qualified setup step.
      await page.locator("#save-fixtures").click();
      await page.locator("#banner.ok").waitFor({ timeout: 5000 });
      const onDisk = JSON.parse(
        await Deno.readTextFile(`${fixturesDir}/cake.json`),
      );
      assertEquals(onDisk.modules.greet.setup[0].id, "mintMember");
      assertEquals(onDisk.modules.greet.setup[0].module, "mint");

      // A FRESH context restores the cross-module setup from fixtures and the walk still works.
      const fresh = await browser.newContext();
      const page2 = await fresh.newPage();
      await page2.goto(`http://localhost:${port}/docs/greet`);
      await page2.locator("#setup .setup-row").waitFor({ timeout: 5000 });
      const label2 = await page2.locator("#setup .setup-name").textContent();
      assert(
        label2?.includes("mint:"),
        `restored setup lost its module: ${label2}`,
      );
      await page2.locator("#runall").click();
      await page2.locator('li[data-id="hello"] .dot.ok').waitFor({
        timeout: 8000,
      });
    } finally {
      await browser.close();
      await server.stop();
      Deno.env.delete("KEEP_FIXTURES_DIR");
      await Deno.remove(fixturesDir, { recursive: true });
    }
  },
});

// ── the plural composition contract: tableNames[0] → $tableName, zero typing ──

class DiscoverOutDto {
  @ApiProperty()
  tableNames!: string[];
}
class EnableDto {
  @ApiProperty()
  tableName!: string;
}
class EnabledDto {
  @ApiProperty()
  tableName!: string; // echo — must not be treated as the producer
  @ApiProperty()
  enabled!: boolean;
}

@EndpointController("catalog")
class CatalogController {
  @Endpoint({ path: "discover", output: DiscoverOutDto, order: 1 })
  discover(): DiscoverOutDto {
    return { tableNames: ["alpha", "beta"] };
  }
  @Endpoint({
    path: "enable",
    input: EnableDto,
    output: EnabledDto,
    order: 2,
    bind: { tableName: "$tableName" },
  })
  enable(body: EnableDto): EnabledDto {
    if (!body?.tableName) throw new Error("tableName should not be empty");
    return { tableName: body.tableName, enabled: true };
  }
}
const CatalogModule = endpointModule("Catalog", [CatalogController]);

Deno.test({
  name:
    "emulator — $tableName auto-fills from the tableNames collection, zero typing (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9625;
    const server = await bootstrapServer("catalog", CatalogModule, { port });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/docs/catalog`);

      // The Module-inputs card knows the collection producer (NOT the echo): auto, not amber.
      await page.locator("#inputs-card").waitFor();
      const auto = await page.locator("#inputs .input-auto").textContent();
      assert(
        auto?.includes("catalog:discover"),
        `tableName should be auto-wired to the collection producer: ${auto}`,
      );
      assertEquals(await page.locator("#inputs .var-name.unset").count(), 0);

      // Run all with NO typing at all: discover runs, $tableName resolves to tableNames[0],
      // enable goes green with "alpha".
      await page.locator("#runall").click();
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 8000 },
      );
      const resp = await page.locator('li[data-id="enable"] .resp')
        .textContent();
      assert(
        resp?.includes('"alpha"'),
        `enable should have received the collection's first element: ${resp}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
