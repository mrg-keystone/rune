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
  name: "emulator — progressive unlock + autofill + checkmarks (headless chromium)",
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

      // Emulate step 1 → checkmark, step 2 unlocks pre-filled with the captured id.
      await emulateButtons.nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();
      assertEquals(await emulateButtons.nth(1).isDisabled(), false);
      const step2Body = await page.locator("li").nth(1).locator("textarea").inputValue();
      assert(step2Body.includes("thing-7"), `step 2 body not autofilled: ${step2Body}`);

      // Run all → both steps green.
      await page.locator("#runall").click();
      // String predicate runs in the browser; avoids needing the DOM lib in Deno's typecheck.
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 2",
        { timeout: 5000 },
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
