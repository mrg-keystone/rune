import { App, staticFiles } from "fresh";
import { withBasePath } from "@mrg-keystone/danet";
import { api } from "./backend.ts";
import { define, type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());

// In-process Danet client on ctx.state — server-side code calls the API with no token.
app.use((ctx) => {
  ctx.state.api = api.backend;
  return ctx.next();
});

// --- Runtime localhost-trust toggle (demo) ---------------------------------------------------
// Danet's TRUST_LOCALHOST is fixed at boot, so we flip the lever the guard actually reads: the
// request's conn info. trusted=true → forward the real localhost info (Danet trusts loopback →
// no token). trusted=false → forward NO info, so the request looks external → token required.
let trusted = false; // start gated, so /api needs a token

const mountedApi = withBasePath("/api", api.handler);
app.all("/api/*", (ctx) => mountedApi(ctx.req, trusted ? ctx.info : undefined));

// Public toggle endpoint (a plain Fresh route — not behind the /api guard).
app.get("/trust", (ctx) => {
  const set = new URL(ctx.req.url).searchParams.get("set");
  if (set === "on") trusted = true;
  else if (set === "off") trusted = false;
  const state = trusted
    ? "ON — localhost is trusted, /api needs NO token"
    : "OFF — /api requires a Bearer token (or a @Public route)";
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>localhost trust: ${trusted ? "ON" : "OFF"}</title>
<style>body{font:16px/1.5 system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem}
a{display:inline-block;margin:.2rem .6rem .2rem 0}code{background:#eee;padding:.1rem .3rem;border-radius:3px}</style>
</head><body>
<h1>localhost trust: <b>${trusted ? "ON" : "OFF"}</b></h1>
<p>/api/* is currently <b>${state}</b>.</p>
<p>Flip it: <a href="/trust?set=on">turn ON (trust localhost)</a> | <a href="/trust?set=off">turn OFF (gate it)</a></p>
<hr>
<p>Try these (watch how <code>/api/users</code> changes with the toggle):</p>
<p>
  <a href="/api/users">/api/users</a> (gated) |
  <a href="/api/health">/api/health</a> (@Public, always open) |
  <a href="/users">/users</a> (SSR, in-process — always works)
</p>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
});
// --------------------------------------------------------------------------------------------

// Include file-system based routes here
app.fsRoutes();
