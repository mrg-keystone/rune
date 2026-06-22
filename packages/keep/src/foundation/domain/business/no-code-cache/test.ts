import { assert, assertEquals } from "#assert";
import { noCodeCache } from "./mod.ts";

const CACHE_CONTROL = "Cache-Control";

/** Drives the middleware with a request URL and a canned downstream response. */
async function run(
  url: string,
  res: Response,
  options?: Parameters<typeof noCodeCache>[0],
) {
  const mw = noCodeCache(options);
  return await mw({
    req: new Request(url),
    next: () => Promise.resolve(res),
  });
}

function busted(res: Response): boolean {
  return res.headers.get(CACHE_CONTROL)?.includes("no-store") === true &&
    res.headers.get("Surrogate-Control") === "no-store" &&
    !res.headers.has("ETag");
}

Deno.test("busts an HTML page response (by content-type)", async () => {
  const out = await run(
    "http://app/",
    new Response("<h1>hi</h1>", {
      headers: { "content-type": "text/html; charset=utf-8", ETag: '"abc"' },
    }),
  );
  assert(busted(out), "html should be marked no-store");
  assertEquals(out.headers.get("Pragma"), "no-cache");
  assertEquals(out.headers.get("Expires"), "0");
});

Deno.test("busts a code file by extension even with a generic content-type", async () => {
  const out = await run(
    "http://app/assets/app.js",
    new Response("console.log(1)", {
      headers: { "content-type": "application/octet-stream" },
    }),
  );
  assert(busted(out));
});

Deno.test("busts everything under /_fresh/", async () => {
  const out = await run(
    "http://app/_fresh/island-chunk",
    new Response("…", {
      headers: { "content-type": "application/octet-stream" },
    }),
  );
  assert(busted(out));
});

Deno.test("leaves a non-code response (image) cacheable and untouched", async () => {
  const out = await run(
    "http://app/logo.png",
    new Response("\x89PNG", {
      headers: { "content-type": "image/png", ETag: '"img-1"' },
    }),
  );
  assertEquals(out.headers.get(CACHE_CONTROL), null);
  assertEquals(out.headers.get("ETag"), '"img-1"', "ETag must be preserved");
  assert(!busted(out));
});

Deno.test("respects custom extensions (merged with defaults)", async () => {
  const out = await run(
    "http://app/sitemap.xml",
    new Response("<urlset/>", {
      headers: { "content-type": "application/octet-stream" },
    }),
    { extensions: [".xml"] },
  );
  assert(busted(out));

  // Defaults still apply alongside the custom one.
  const css = await run(
    "http://app/site.css",
    new Response("body{}", {
      headers: { "content-type": "application/octet-stream" },
    }),
    { extensions: [".xml"] },
  );
  assert(busted(css));
});

Deno.test("busts by content-type alone (css/javascript/wasm) with no matching extension", async () => {
  // Paths have no code extension, so only the content-type branch can match.
  const css = await run(
    "http://app/styles",
    new Response("body{}", { headers: { "content-type": "text/css" } }),
  );
  const js = await run(
    "http://app/runtime",
    new Response("0", {
      headers: { "content-type": "application/javascript" },
    }),
  );
  const wasm = await run(
    "http://app/mod",
    new Response("\0", { headers: { "content-type": "application/wasm" } }),
  );
  assert(busted(css));
  assert(busted(js));
  assert(busted(wasm));
});

Deno.test("passes through a non-code path with no content-type (default branch)", async () => {
  const out = await run(
    "http://app/download",
    new Response("data", { headers: { ETag: '"d"' } }), // no content-type, no code extension
  );
  assertEquals(out.headers.get(CACHE_CONTROL), null);
  assertEquals(
    out.headers.get("ETag"),
    '"d"',
    "ETag preserved on pass-through",
  );
  assert(!busted(out));
});

Deno.test("a 304 under /_fresh/ stays valid when re-wrapped (null body invariant)", async () => {
  // 304 responses carry no body; mutableResponse must re-wrap them without throwing.
  const out = await run(
    "http://app/_fresh/island-chunk",
    new Response(null, { status: 304, headers: { ETag: '"v1"' } }),
  );
  assertEquals(out.status, 304);
  assert(busted(out)); // /_fresh/ → no-store, ETag stripped
});

Deno.test("preserves the response body and status while mutating headers", async () => {
  const out = await run(
    "http://app/api/users",
    new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  assert(busted(out));
  assertEquals(out.status, 201);
  assertEquals(await out.json(), { ok: true });
});
