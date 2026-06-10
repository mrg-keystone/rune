// End-to-end acceptance for the rune -> keep flow, exercised through the cake module
// (rune-generated from example/cake/src/cake/cake.rune, bodies filled to chain deterministically).
// Run from the keep root: `deno task test:e2e` (in-process), or `KEEP_BROWSER=1 deno task test:e2e`
// to add the interactive-emulator browser stage.
import "reflect-metadata";
import { assert, assertEquals, assertExists } from "#assert";
import { bootstrapServer, exerciseEndpoints } from "@mrg-keystone/keep";
import { httpModule } from "@/src/cake/entrypoints/http/mod.ts";

let port = 8790;

const CHAIN = ["driveToStore", "groceryShop", "checkout", "mixIngredients", "bake", "cut"];

// Stage 1/2 — the generated controller exposes 6 ordered, chained, schema'd endpoints.
Deno.test("cake e2e — 6 endpoints with schemas + x-keep-process chain", async () => {
  const api = await bootstrapServer("cake", httpModule, { port: port++ });
  try {
    const doc = api.docs[0].doc;
    assertEquals(Object.keys(doc.paths ?? {}).length, 6);
    assertExists(doc.components?.schemas?.ArrivalDto);
    assertExists(doc.components?.schemas?.SlicesDto);
    // Last step's process metadata is fully derived from the DTO field graph.
    const cut = doc.paths!["/http/cut"].post!["x-keep-process"];
    assertEquals(cut?.order, 6);
    assertEquals(cut?.dependsOn, ["bake"]);
    assertEquals(cut?.bind, { cakeId: "bake.cakeId" });
  } finally {
    await api.stop();
  }
});

// Stage 5 — the headless runner drives the whole chain green in-process (no browser).
Deno.test("cake e2e — exerciseEndpoints chains all 6 green in-process", async () => {
  const api = await bootstrapServer("cake", httpModule, { port: port++ });
  try {
    const report = await exerciseEndpoints({ api });
    assertEquals(report.order, CHAIN);
    assertEquals(report.cycles, []);
    assertEquals(report.failed.map((r) => r.id), []);
    assertEquals(report.passed.length, 6);
  } finally {
    await api.stop();
  }
});

// Stage 4 — the interactive emulator: progressive unlock + autofill + checkmarks, in headless
// chromium. Opt-in (needs `deno run -A npm:playwright install chromium chromium-headless-shell`).
Deno.test({
  name: "cake e2e — emulator unlock/autofill/checkmarks (headless chromium)",
  ignore: Deno.env.get("KEEP_BROWSER") !== "1",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const p = port++;
    const api = await bootstrapServer("cake", httpModule, { port: p });
    await api.listen();
    const { chromium } = await import("#playwright");
    // KEEP_HEADED=1 launches a visible browser and slows actions so you can watch the
    // emulator walk the chain (`deno task cake`); otherwise it runs headless.
    const headed = Deno.env.get("KEEP_HEADED") === "1";
    const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 600 : 0 });
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${p}/docs/cake`);
      const emulate = page.locator("button.emulate");

      // Initially only step 1 is unlocked.
      assertEquals(await emulate.nth(0).isDisabled(), false);
      assertEquals(await emulate.nth(1).isDisabled(), true);

      // Emulate step 1 -> checkmark, step 2 unlocks pre-filled from the captured storeId.
      await emulate.nth(0).click();
      await page.locator("li .dot.ok").first().waitFor();
      assertEquals(await emulate.nth(1).isDisabled(), false);
      const step2Body = await page.locator("li").nth(1).locator("textarea").inputValue();
      assert(step2Body.includes("store-42"), `step 2 not autofilled: ${step2Body}`);

      // Run all -> all 6 green.
      await page.locator("#runall").click();
      await page.waitForFunction(
        "document.querySelectorAll('li .dot.ok').length === 6",
        { timeout: 10000 },
      );
      // Hold the all-green state on screen briefly when watching headed.
      if (headed) await new Promise((r) => setTimeout(r, 2500));
    } finally {
      await browser.close();
      await api.stop();
    }
  },
});
