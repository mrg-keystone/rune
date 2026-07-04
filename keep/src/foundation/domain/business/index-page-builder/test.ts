import { assertEquals, assertStringIncludes } from "#assert";
import { IndexPageBuilder } from "./mod.ts";

Deno.test("IndexPageBuilder builds index page with default prefix", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build(["Users", "Products"]);

  // Assert contains links with correct hrefs (lowercase)
  assertStringIncludes(html, 'href="/docs/users"');
  assertStringIncludes(html, 'href="/docs/products"');
  // Display names stay as-is
  assertStringIncludes(html, ">Users<");
  assertStringIncludes(html, ">Products<");
  // Assert is valid HTML
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "</html>");
});

Deno.test("IndexPageBuilder builds index page with custom prefix", () => {
  const builder = new IndexPageBuilder({ prefix: "/api/docs/" });
  const html = builder.build(["Auth"]);

  // Assert contains link with custom prefix (lowercase href)
  assertStringIncludes(html, 'href="/api/docs/auth"');
  assertStringIncludes(html, ">Auth<");
});

Deno.test("IndexPageBuilder renders particles based on particleCount", () => {
  const builder = new IndexPageBuilder({ particleCount: 15 });
  const html = builder.build(["Test"]);

  // Count particle divs
  const particleCount = (html.match(/class="particle"/g) || []).length;
  assertEquals(particleCount, 15);
});

Deno.test("IndexPageBuilder renders fewer particles when reduced", () => {
  const builder = new IndexPageBuilder({ particleCount: 3 });
  const html = builder.build(["Test"]);

  const particleCount = (html.match(/class="particle"/g) || []).length;
  assertEquals(particleCount, 3);
});

Deno.test("IndexPageBuilder handles empty names array", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build([]);

  // Assert returns valid HTML even with no links
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "</html>");
  // Should indicate no docs available
  assertStringIncludes(html.toLowerCase(), "no");
});

Deno.test("IndexPageBuilder handles multiple modules with styling", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build(["Auth", "Users", "Products", "Orders"]);

  // Assert all modules are present (lowercase hrefs)
  assertStringIncludes(html, 'href="/docs/auth"');
  assertStringIncludes(html, 'href="/docs/users"');
  assertStringIncludes(html, 'href="/docs/products"');
  assertStringIncludes(html, 'href="/docs/orders"');

  // Assert has some styling
  assertStringIncludes(html, "<style>");
  assertStringIncludes(html, "</style>");
});

Deno.test("IndexPageBuilder renders a system map link when mapHref is given", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build(["Users"], { mapHref: "docs/_map" });

  assertStringIncludes(html, 'href="docs/_map"');
  assertStringIncludes(html, "System map");
});

Deno.test("IndexPageBuilder omits the system map link without mapHref (backward compatible)", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build(["Users"]);

  assertEquals(html.includes("System map"), false);
  assertEquals(html.includes('class="map-link"'), false);
});

Deno.test("IndexPageBuilder creates unique links for each module", () => {
  const builder = new IndexPageBuilder();
  const html = builder.build(["ModuleA", "ModuleB"]);

  // Count occurrences of each link (lowercase hrefs)
  const moduleACount = (html.match(/href="\/docs\/modulea"/g) || []).length;
  const moduleBCount = (html.match(/href="\/docs\/moduleb"/g) || []).length;

  assertEquals(moduleACount, 1);
  assertEquals(moduleBCount, 1);
});
