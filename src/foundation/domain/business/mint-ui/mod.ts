import type { Context } from "#hono";
import { signToken, type TokenPayload } from "@foundation/domain/business/token/mod.ts";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";

/**
 * A localhost-only UI for minting signed access tokens. The signing key is read from the
 * environment (never entered in or returned by the form), and every handler refuses any
 * request that does not originate from the loopback interface — so the tool is unusable if
 * the port is ever exposed.
 */
export interface MintUiConfig {
  appName: string;
  /** The secret signing key, read from an env variable by the caller. Empty ⇒ minting disabled. */
  signingKey: string;
  logger: Logger;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function createMintUi(config: MintUiConfig): {
  form: (c: Context) => Response;
  mint: (c: Context) => Promise<Response>;
} {
  return {
    form: (c) => guard(c) ?? html(formPage(config)),
    mint: (c) => mint(c, config),
  };
}

/** Returns a 403 Response if the request is not from localhost; otherwise `undefined`. */
function guard(c: Context): Response | undefined {
  if (isLocalRequest(c)) return undefined;
  return new Response("Forbidden: the token minting UI is available on localhost only.", {
    status: 403,
  });
}

/**
 * A request is local only when its connecting socket address is loopback. That address is
 * authoritative and cannot be forged by a remote client. We deliberately do NOT fall back to the
 * `Host` header (which is client-spoofable) — if the peer address is unavailable we fail closed,
 * since this guard is the sole gate on the token-minting UI. To make this work when the backend
 * is mounted behind another listener, forward Deno's conn info: `handler(req, info)`.
 */
export function isLocalRequest(c: Context): boolean {
  const peer = remoteHostname(c);
  return peer !== undefined && LOOPBACK_HOSTS.has(peer);
}

function remoteHostname(c: Context): string | undefined {
  // Deno.serve passes conn info as Hono's `env`; it is absent for in-process dispatch.
  const env = c.env as { remoteAddr?: { hostname?: string } } | undefined;
  return env?.remoteAddr?.hostname;
}

async function mint(c: Context, config: MintUiConfig): Promise<Response> {
  const denied = guard(c);
  if (denied) return denied;

  if (!config.signingKey) {
    return html(resultPage({ error: "No signing key configured (set the env variable)." }), 500);
  }

  const form = await c.req.formData();
  const source = String(form.get("source") ?? "").trim();
  const appName = String(form.get("appName") ?? "").trim() || config.appName;
  const neverExpires = form.get("neverExpires") != null;

  if (!source) {
    return html(resultPage({ error: "`source` is required." }), 400);
  }

  const payload: TokenPayload = { source, appName };
  if (!neverExpires) {
    const expiresIn = Number(form.get("expiresIn"));
    if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
      return html(
        resultPage({ error: "`expires in` must be a positive integer (seconds), or check “never expires”." }),
        400,
      );
    }
    // The form takes a duration ("seconds from now"); the token stores an absolute Unix epoch.
    payload.expiry = Math.floor(Date.now() / 1000) + expiresIn;
  }
  try {
    const token = await signToken(payload, config.signingKey);
    config.logger.info("Minted access token", { source, appName, expiry: payload.expiry ?? null });
    return html(resultPage({ token, payload }));
  } catch (err) {
    return html(resultPage({ error: err instanceof Error ? err.message : String(err) }), 400);
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

// Default duration pre-filled in the form: 30 days, in seconds.
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function layout(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
  label.check { display: flex; align-items: center; gap: .45rem; }
  input { width: 100%; padding: .55rem .6rem; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
  input[type="checkbox"] { width: auto; }
  input:disabled { background: #f4f4f5; color: #999; }
  button { margin-top: 1.5rem; padding: .6rem 1.2rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; font-size: 1rem; cursor: pointer; }
  code, pre { background: #f4f4f5; border-radius: 6px; }
  pre { padding: 1rem; overflow-x: auto; word-break: break-all; white-space: pre-wrap; }
  .hint { color: #666; font-size: .85rem; font-weight: 400; }
  .err { color: #b91c1c; }
</style></head><body>${inner}</body></html>`;
}

function formPage(config: MintUiConfig): string {
  const keyState = config.signingKey
    ? `<span class="hint">Signing key loaded from env.</span>`
    : `<span class="hint err">No signing key configured — minting is disabled.</span>`;
  return layout(
    "Mint access token",
    `<h1>Mint access token</h1>
<p>${keyState}</p>
<form method="post" action="">
  <label>source <span class="hint">— attributed in the receiving app's logs</span></label>
  <input name="source" placeholder="ci-runner" autofocus required>
  <label>appName</label>
  <input name="appName" value="${escapeAttr(config.appName)}" required>
  <label class="check"><input type="checkbox" name="neverExpires" id="neverExpires"> never expires</label>
  <label>expires in <span class="hint">— seconds from now</span></label>
  <input name="expiresIn" id="expiresIn" type="number" min="1" step="1" value="${DEFAULT_TTL_SECONDS}">
  <p class="hint" id="expiryPreview"></p>
  <button type="submit">Mint token</button>
</form>
<script>${expiryPreviewScript()}</script>`,
  );
}

/** Live "expires at" preview in Eastern Time, recomputed as the duration field changes. */
function expiryPreviewScript(): string {
  return `(function(){
  var input = document.querySelector('input[name="expiresIn"]');
  var out = document.getElementById("expiryPreview");
  function fmt(epochMs){
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short", timeZoneName: "short",
      }).format(new Date(epochMs));
    } catch (e) { return new Date(epochMs).toISOString(); }
  }
  var never = document.getElementById("neverExpires");
  function update(){
    if (never && never.checked) { input.disabled = true; out.textContent = "Never expires"; return; }
    input.disabled = false;
    var secs = Number(input.value);
    if (!Number.isInteger(secs) || secs <= 0) { out.textContent = ""; return; }
    out.textContent = "Expires " + fmt(Date.now() + secs * 1000) + " (Eastern)";
  }
  input.addEventListener("input", update);
  if (never) never.addEventListener("change", update);
  update();
})();`;
}

function resultPage(
  result: { token?: string; payload?: TokenPayload; error?: string },
): string {
  if (result.error) {
    return layout(
      "Mint failed",
      `<h1>Mint failed</h1><p class="err">${escapeHtml(result.error)}</p><p><a href="">Back</a></p>`,
    );
  }
  const token = result.token ?? "";
  const expiry = result.payload?.expiry; // undefined ⇒ never expires
  return layout(
    "Token minted",
    `<h1>Token minted</h1>
<p class="hint">${escapeHtml(JSON.stringify(result.payload))}</p>
<p class="hint" id="expiresAt"></p>
<p id="copyStatus" class="hint"></p>

<label>Token</label>
<pre>${escapeHtml(token)}</pre>

<label>Docs link <span class="hint">— opens the API docs with this token</span></label>
<pre id="docsLink"></pre>
<button type="button" id="copyDocs">Copy docs link</button>
<button type="button" id="copyToken">Copy token</button>

<p><a href="">Mint another</a></p>
<script>
(function(){
  var token = ${JSON.stringify(token)};
  var expiry = ${expiry === undefined ? "null" : expiry};
  // Show the expiry in Eastern Time (or "never").
  if (expiry === null) {
    document.getElementById("expiresAt").textContent = "Expires: never";
  } else {
    try {
      document.getElementById("expiresAt").textContent = "Expires " + new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short", timeZoneName: "short",
      }).format(new Date(expiry * 1000)) + " (Eastern)";
    } catch (e) { /* ignore */ }
  }
  // Derive the docs URL from this page's own location so it works standalone (/_mint → /docs)
  // and when mounted under Fresh (/api/_mint → /api/docs).
  var base = window.location.pathname.replace("/_mint", "/docs");
  var docsUrl = window.location.origin + base + "?token=" + encodeURIComponent(token);
  document.getElementById("docsLink").textContent = docsUrl;
  function copier(id, text){
    var btn = document.getElementById(id);
    btn.addEventListener("click", function(){
      navigator.clipboard.writeText(text).then(function(){
        var label = btn.textContent; btn.textContent = "Copied!";
        setTimeout(function(){ btn.textContent = label; }, 1200);
      });
    });
  }
  copier("copyDocs", docsUrl);
  copier("copyToken", token);
  // Auto-copy the token on mint.
  var status = document.getElementById("copyStatus");
  navigator.clipboard.writeText(token).then(function(){
    status.textContent = "✓ Token copied to clipboard";
  }).catch(function(){
    status.textContent = "Press “Copy token” to copy it to your clipboard.";
  });
})();
</script>`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
