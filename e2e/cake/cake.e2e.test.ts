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

// What each step's request body should be auto-filled with once the prior step has run —
// i.e. the value captured from the previous endpoint's response and threaded in via `bind`.
// (Step 1 takes a seed `destination`, so it has nothing to autofill.)
const EXPECTED_AUTOFILL = [
  null,
  "store-42", // groceryShop.storeId   <- driveToStore.storeId
  "cart-store-42", // checkout.cartId        <- groceryShop.cartId
  "ing-cart-store-42", // mixIngredients.ingred. <- checkout.ingredientsId
  "batter-ing-cart-store-42", // bake.batterId          <- mixIngredients.batterId
  "cake-batter-ing-cart-store-42", // cut.cakeId             <- bake.cakeId
];

// Stage 4 — the interactive emulator, driven step by step in headless chromium. Emulates EVERY
// step in order, asserting per step: it's unlocked, the next step is still locked, its body was
// auto-filled from the prior capture, and a checkmark appears after it runs. Opt-in (needs
// `deno run -A npm:playwright install chromium chromium-headless-shell`; `deno task cake` provisions).
Deno.test({
  name: "cake e2e — emulator drives all 6 steps: progressive unlock + autofill + checkmarks",
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
    const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 500 : 0 });
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${p}/docs/cake`);
      const emulate = page.locator("button.emulate");
      const row = (i: number) => page.locator("li").nth(i);

      // Walk every step in order, emulating and verifying each one individually.
      for (let i = 0; i < CHAIN.length; i++) {
        // This step is unlocked; the next one is still locked until this one succeeds.
        assertEquals(await emulate.nth(i).isDisabled(), false, `step ${i + 1} (${CHAIN[i]}) should be unlocked`);
        if (i + 1 < CHAIN.length) {
          assertEquals(await emulate.nth(i + 1).isDisabled(), true, `step ${i + 2} should still be locked before step ${i + 1} runs`);
        }
        // Its request body was pre-filled with the value captured from the previous step.
        const expected = EXPECTED_AUTOFILL[i];
        if (expected) {
          const body = await row(i).locator("textarea").inputValue();
          assert(body.includes(expected), `step ${i + 1} (${CHAIN[i]}) not autofilled with "${expected}": ${body}`);
        }
        // Emulate it, then wait for its checkmark.
        await emulate.nth(i).click();
        await row(i).locator(".dot.ok").waitFor({ timeout: 10000 });
      }

      // All six green.
      assertEquals(await page.locator("li .dot.ok").count(), 6);

      // The "Run all in order" button replays the whole chain from a fresh load.
      await page.reload();
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
