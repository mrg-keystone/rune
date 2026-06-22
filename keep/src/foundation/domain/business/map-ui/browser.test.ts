import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";

// Opt-in: drives the real system map UI in headless chromium. Needs Playwright + a
// browser provisioned (`deno run -A npm:playwright install chromium`). Run with:
//   KEEP_BROWSER=1 deno test -A --unstable-raw-imports .../map-ui/browser.test.ts
const enabled = Deno.env.get("KEEP_BROWSER") === "1";

class CreateDto {
  @ApiProperty()
  name!: string;
}
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
  // memberId is external to THIS module — the composed mint module produces it, so the map
  // draws a dashed $memberId edge between the two lanes.
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
    "system map — lanes + dashed edge, click-through deep link, storage-driven recolor (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9615;
    const server = await bootstrapServer("map", [MintModule, GreetModule], {
      port,
    });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const mapPage = await context.newPage();
      await mapPage.goto(`http://localhost:${port}/docs/_map`);

      // Both modules' endpoints render as nodes; the produced $input is a dashed edge.
      assertEquals(await mapPage.locator("svg [data-node]").count(), 2);
      assertEquals(
        await mapPage.locator('svg path[data-kind="input"]').count(),
        1,
      );
      const edgeLabel = await mapPage.locator("svg text.edgelabel")
        .textContent();
      assertEquals(edgeLabel, "$memberId");
      // Lane titles link to each module's emulator page.
      assertEquals(await mapPage.locator("svg text.lane-title").count(), 2);
      // Nothing has run yet — no green dots.
      assertEquals(await mapPage.locator("svg .dot.ok").count(), 0);

      // Click-through: a node lands on that module's emulator with the step expanded.
      await mapPage.locator('[data-node="mint:mintMember"]').click();
      await mapPage.waitForURL(`**/docs/mint#mintMember`);
      await mapPage.locator('li.open[data-id="mintMember"]').waitFor({
        timeout: 5000,
      });

      // Run the producer's step in ANOTHER tab — the map (still open below) must recolor
      // live via the storage event, without a reload.
      await mapPage.goBack();
      await mapPage.locator("svg [data-node]").first().waitFor();
      const emuPage = await context.newPage();
      await emuPage.goto(`http://localhost:${port}/docs/mint`);
      await emuPage.locator("button.emulate").nth(0).click();
      await emuPage.locator("li .dot.ok").first().waitFor();

      await mapPage.bringToFront();
      await mapPage.locator('[data-node="mint:mintMember"] .dot.ok').waitFor({
        timeout: 5000,
      });
      assertEquals(await mapPage.locator("svg .dot.ok").count(), 1);
      assert(
        await mapPage.locator('[data-node="greet:hello"] .dot.ok').count() ===
          0,
        "the consumer has not run — its dot must stay idle",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "system map — Run all walks the whole app server-side and greens the nodes (headless chromium)",
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const port = 9616;
    const server = await bootstrapServer("map", [MintModule, GreetModule], {
      port,
    });
    await server.listen();
    const { chromium } = await import("#playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/docs/_map`);

      // Nothing has run — no green dots, button idle.
      assertEquals(await page.locator("svg .dot.ok").count(), 0);

      // Open mint's cake BEFORE the run and leave it open — it must pick the results up live
      // via the storage merge, without a reload.
      const liveCake = await context.newPage();
      await liveCake.goto(`http://localhost:${port}/docs/mint`);
      assertEquals(await liveCake.locator("li .dot.ok").count(), 0);
      await page.bringToFront();

      // Run all → POST /docs/_run (localhost-only) walks both modules in-process; greet's
      // $memberId auto-wires from mint's output, so both endpoints pass and both dots green.
      await page.locator("#runall").click();
      await page.locator("#banner.ok").waitFor({ timeout: 10000 });
      await page.waitForFunction(
        "document.querySelectorAll('svg .dot.ok').length === 2",
        { timeout: 5000 },
      );
      assertEquals(await page.locator("svg .dot.ok").count(), 2);
      const banner = await page.locator("#banner").textContent();
      assert(
        banner?.includes("passed"),
        `expected a passed banner, got: ${banner}`,
      );

      // The report was WRITTEN BACK into the cake sessions — localStorage is the one source of
      // truth, so the colors survive a reload (the old transient overlay would not have).
      await page.reload();
      await page.waitForFunction(
        "document.querySelectorAll('svg .dot.ok').length === 2",
        { timeout: 5000 },
      );
      const session = await page.evaluate<
        { status: string; captured: boolean; sharedCapture: boolean }
      >(`(() => {
        const s = JSON.parse(localStorage.getItem("keep:emulator:/docs/mint"));
        const g = JSON.parse(localStorage.getItem("keep:emulator:globals"));
        return {
          status: s.status.mintMember,
          captured: s.captured.mintMember.memberId === "m-42",
          sharedCapture: g.captured["mint:mintMember"].memberId === "m-42",
        };
      })()`);
      assertEquals(session, {
        status: "ok",
        captured: true,
        sharedCapture: true,
      });

      // The ALREADY-OPEN cake tab caught the run live (storage merge) — no reload happened.
      await liveCake.bringToFront();
      await liveCake.locator('li[data-id="mintMember"] .dot.ok').waitFor({
        timeout: 5000,
      });
      const liveVars = await liveCake.locator("#vars").textContent();
      assert(
        liveVars?.includes("m-42"),
        `the open cake should show the run's capture live: ${liveVars}`,
      );

      // Opening a FRESH cake finds the step already green, with response + capture pre-filled.
      const cake = await context.newPage();
      await cake.goto(`http://localhost:${port}/docs/mint`);
      await cake.locator('li[data-id="mintMember"] .dot.ok').waitFor({
        timeout: 5000,
      });
      const vars = await cake.locator("#vars").textContent();
      assert(
        vars?.includes("mintMember.memberId") && vars?.includes("m-42"),
        `the cake should show the run's capture: ${vars}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
