/**
 * Token-aware Swagger docs UI. The doc pages (index + per-module shells) are served publicly so
 * they always load; the actual OpenAPI spec is fetched over XHR from a gated `/json` endpoint
 * with a bearer token. The token is seeded once from a `?token=` query param, stored in
 * `localStorage` (which survives same-origin navigation between doc pages), attached to every
 * spec request, and wiped if the server replies `401`.
 */

const STORAGE_KEY = "danet_docs_token";
const SWAGGER_UI_VERSION = "5";

/**
 * Client JS (no `<script>` wrapper) shared by every doc page: seed the token from `?token`,
 * strip it from the visible URL, and expose `window.__danetDocs.{token,wipe}`.
 */
export function docsSeedScript(): string {
  return `(function(){
  var KEY=${JSON.stringify(STORAGE_KEY)};
  function read(){try{return localStorage.getItem(KEY);}catch(e){return null;}}
  function write(t){try{localStorage.setItem(KEY,t);}catch(e){}}
  function wipe(){try{localStorage.removeItem(KEY);}catch(e){}}
  try{
    var u=new URL(window.location.href);
    var q=u.searchParams.get("token");
    if(q){write(q);u.searchParams.delete("token");history.replaceState(null,"",u.pathname+(u.search||"")+u.hash);}
  }catch(e){}
  window.__danetDocs={token:read,wipe:wipe,KEY:KEY};
})();`;
}

/** Injects the seed script into an existing HTML page (the docs index) before `</body>`. */
export function injectDocsScript(html: string): string {
  const tag = `<script>${docsSeedScript()}</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
}

/**
 * A self-contained Swagger UI page that loads the spec from `<currentPath>/json` with the
 * stored token, and shows a clear message (and clears the token) on a `401`.
 */
export function swaggerShellHtml(title: string): string {
  const cssHref = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css`;
  const bundleSrc = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${cssHref}">
<style>body{margin:0}#danet-docs-message{font-family:system-ui,sans-serif;padding:2rem;color:#b91c1c}</style>
</head>
<body>
<div id="swagger-ui"></div>
<div id="danet-docs-message" hidden></div>
<script>${docsSeedScript()}</script>
<script src="${bundleSrc}" crossorigin></script>
<script>
window.addEventListener("load", function(){
  var p = window.location.pathname;
  if (p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
  var jsonUrl = p + "/json";
  window.ui = SwaggerUIBundle({
    url: jsonUrl,
    dom_id: "#swagger-ui",
    deepLinking: true,
    requestInterceptor: function(req){
      var t = window.__danetDocs.token();
      if (t) req.headers["Authorization"] = "Bearer " + t;
      return req;
    },
    responseInterceptor: function(res){
      if (res.status === 401){
        window.__danetDocs.wipe();
        var m = document.getElementById("danet-docs-message");
        document.getElementById("swagger-ui").innerHTML = "";
        m.hidden = false;
        m.textContent = "Access denied — your docs token is missing, invalid, or expired. Reopen this page using a fresh ?token=… link.";
      }
      return res;
    }
  });
});
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
