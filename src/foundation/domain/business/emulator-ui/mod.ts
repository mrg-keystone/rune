/**
 * The per-module **process emulator** page. For one rune-module's OpenAPI doc (with
 * `x-keep-process`) it renders endpoints as an ordered, bulleted checklist: expand a bullet to see
 * its request (curl + editable JSON body), click **Emulate process** to fire the real request and
 * see the response, get a checkmark on success — which captures the output and unlocks + pre-fills
 * the next dependent step (`bind`). A **Run all** button walks the chain. Standard Swagger UI lives
 * at `<page>/swagger` and the raw spec at `<page>/json` for deeper inspection.
 *
 * The spec is inlined into the page (no gated fetch needed to render); live endpoint calls reuse
 * the docs `?token=`→localStorage bearer flow, and resolve the app root from the page path so it
 * works standalone (`/docs/<m>`) or mounted under Fresh (`/api/docs/<m>`).
 */

import type { OpenApiDocument } from "@types";
import { endpointsFromDoc, type SpecEndpoint } from "@foundation/domain/business/endpoint-spec/mod.ts";
import { processOrder } from "@foundation/domain/business/process-graph/mod.ts";
import { docsSeedScript } from "@foundation/domain/business/docs-ui/mod.ts";

/** Endpoints in process order, ready to embed in the emulator page. */
export function orderedEndpoints(doc: OpenApiDocument): SpecEndpoint[] {
  const endpoints = endpointsFromDoc(doc);
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  const { order } = processOrder(endpoints);
  return order.map((id) => byId.get(id)).filter((e): e is SpecEndpoint => !!e);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/** Build the self-contained emulator HTML page for a module. */
export function emulatorShellHtml(title: string, doc: OpenApiDocument): string {
  const endpoints = orderedEndpoints(doc);
  const payload = JSON.stringify({ title, endpoints });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · emulator</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,sans-serif;margin:0;background:#0b0d12;color:#e6e9ef}
  header{padding:1rem 1.25rem;border-bottom:1px solid #232734;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
  header h1{font-size:1.1rem;margin:0}
  header a{color:#7aa2f7;text-decoration:none;font-size:.85rem}
  .bar{margin-left:auto;display:flex;gap:.5rem}
  button{font:inherit;border:1px solid #2c3142;background:#161a23;color:#e6e9ef;border-radius:6px;padding:.4rem .7rem;cursor:pointer}
  button:disabled{opacity:.4;cursor:not-allowed}
  button.primary{background:#234; border-color:#3b5}
  ul{list-style:none;margin:0;padding:.5rem 0}
  li{border-bottom:1px solid #1b1f29}
  .row{display:flex;align-items:center;gap:.6rem;padding:.6rem 1.25rem;cursor:pointer}
  .dot{width:1.1rem;text-align:center}
  .verb{font-weight:700;font-size:.75rem;width:3.2rem;color:#9aa5ce}
  .path{font-family:ui-monospace,monospace;font-size:.9rem}
  .desc{color:#6b7394;font-size:.8rem;margin-left:.4rem}
  .row .emulate{margin-left:auto}
  .detail{display:none;padding:.2rem 1.25rem 1rem 2.9rem}
  li.open .detail{display:block}
  textarea{width:100%;min-height:4rem;background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:6px;font-family:ui-monospace,monospace;font-size:.82rem;padding:.5rem;box-sizing:border-box}
  pre{background:#0e1117;border:1px solid #2c3142;border-radius:6px;padding:.5rem;overflow:auto;font-size:.78rem;margin:.5rem 0 0}
  .label{font-size:.72rem;color:#6b7394;text-transform:uppercase;letter-spacing:.04em;margin-top:.6rem}
  .ok{color:#7ee787}.fail{color:#ff7b72}.locked{color:#6b7394}
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <a id="rawlink" href="#">raw swagger &#8599;</a>
  <div class="bar"><button id="runall" class="primary">Run all in order</button></div>
</header>
<ul id="app"></ul>
<script>${docsSeedScript()}</script>
<script>
(function(){
  var DATA = ${payload};
  var base = location.pathname.replace(/\\/+$/,"").replace(/\\/docs\\/[^/]+$/,"");
  var store = {};        // endpointId -> parsed response body
  var statusById = {};   // endpointId -> "ok" | "fail"
  document.getElementById("title").textContent = DATA.title + " — process emulator";
  document.getElementById("rawlink").href = location.pathname.replace(/\\/+$/,"") + "/swagger";

  function token(){ try { return window.__danetDocs ? window.__danetDocs.token() : null; } catch(e){ return null; } }
  function ready(ep){ return ep.dependsOn.every(function(d){ return statusById[d] === "ok"; }); }

  function buildBody(ep){
    var body = {};
    ep.inputFields.forEach(function(f){ body[f] = ""; });
    Object.keys(ep.bind).forEach(function(field){
      var parts = ep.bind[field].split(".");
      var src = store[parts[0]];
      if (src && parts[1] in src) body[field] = src[parts[1]];
    });
    return body;
  }

  function curlFor(ep, bodyText){
    var url = base + ep.path;
    var parts = ["curl -X " + ep.method + " " + JSON.stringify(url)];
    if (ep.method !== "GET") parts.push("-H " + JSON.stringify("content-type: application/json"));
    var t = token();
    if (t) parts.push("-H " + JSON.stringify("authorization: Bearer <token>"));
    if (ep.method !== "GET" && bodyText) parts.push("-d " + JSON.stringify(bodyText));
    return parts.join(" \\\\\\n  ");
  }

  var rows = {};
  function refreshLocks(){
    DATA.endpoints.forEach(function(ep){
      var r = rows[ep.id];
      var st = statusById[ep.id];
      var dot = r.querySelector(".dot");
      var btn = r.querySelector(".emulate");
      if (st === "ok"){ dot.textContent = "\\u2713"; dot.className = "dot ok"; }
      else if (st === "fail"){ dot.textContent = "\\u2717"; dot.className = "dot fail"; }
      else if (ready(ep)){ dot.textContent = "\\u25cf"; dot.className = "dot"; }
      else { dot.textContent = "\\u25cb"; dot.className = "dot locked"; }
      btn.disabled = !ready(ep) && st !== "ok" && st !== "fail";
      // refresh autofilled body if not yet run and user hasn't focused it
      if (!st){
        var ta = r.querySelector("textarea");
        if (ta && document.activeElement !== ta && Object.keys(ep.bind).length){
          ta.value = JSON.stringify(buildBody(ep), null, 2);
          var pre = r.querySelector(".curl"); if (pre) pre.textContent = curlFor(ep, ta.value);
        }
      }
    });
  }

  function emulate(ep){
    var r = rows[ep.id];
    var ta = r.querySelector("textarea");
    var out = r.querySelector(".resp");
    var bodyText = ta ? ta.value : "";
    var url = base + ep.path;
    var headers = {};
    var init = { method: ep.method, headers: headers };
    if (ep.method !== "GET"){
      headers["content-type"] = "application/json";
      init.body = bodyText || "{}";
    }
    var t = token(); if (t) headers["authorization"] = "Bearer " + t;
    out.textContent = "…";
    return fetch(url, init).then(function(res){
      return res.text().then(function(text){
        var parsed; try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
        out.textContent = "HTTP " + res.status + "\\n" + (typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
        if (res.ok){
          statusById[ep.id] = "ok";
          if (parsed && typeof parsed === "object") store[ep.id] = parsed;
        } else {
          statusById[ep.id] = "fail";
        }
        refreshLocks();
        return res.ok;
      });
    }).catch(function(err){
      out.textContent = "ERROR " + (err && err.message ? err.message : err);
      statusById[ep.id] = "fail"; refreshLocks(); return false;
    });
  }

  function makeRow(ep, idx){
    var li = document.createElement("li");
    var row = document.createElement("div"); row.className = "row";
    var dot = document.createElement("span"); dot.className = "dot locked"; dot.textContent = "\\u25cb";
    var num = document.createElement("span"); num.textContent = (idx + 1) + ".";
    var verb = document.createElement("span"); verb.className = "verb"; verb.textContent = ep.method;
    var path = document.createElement("span"); path.className = "path"; path.textContent = ep.path;
    var desc = document.createElement("span"); desc.className = "desc"; desc.textContent = ep.description || "";
    var btn = document.createElement("button"); btn.className = "emulate"; btn.textContent = "Emulate process";
    row.appendChild(dot); row.appendChild(num); row.appendChild(verb); row.appendChild(path); row.appendChild(desc); row.appendChild(btn);

    var detail = document.createElement("div"); detail.className = "detail";
    var html = "";
    if (ep.method !== "GET"){
      html += '<div class="label">request body</div><textarea spellcheck="false"></textarea>';
    }
    html += '<div class="label">curl</div><pre class="curl"></pre>';
    html += '<div class="label">response</div><pre class="resp"></pre>';
    detail.innerHTML = html;

    li.appendChild(row); li.appendChild(detail);
    row.addEventListener("click", function(e){ if (e.target === btn) return; li.classList.toggle("open"); });
    btn.addEventListener("click", function(e){ e.stopPropagation(); emulate(ep); });
    rows[ep.id] = li;

    var ta = detail.querySelector("textarea");
    if (ta){ ta.value = JSON.stringify(buildBody(ep), null, 2); }
    detail.querySelector(".curl").textContent = curlFor(ep, ta ? ta.value : "");
    return li;
  }

  var app = document.getElementById("app");
  DATA.endpoints.forEach(function(ep, i){ app.appendChild(makeRow(ep, i)); });
  refreshLocks();

  document.getElementById("runall").addEventListener("click", function(){
    var i = 0;
    function step(){
      if (i >= DATA.endpoints.length) return;
      var ep = DATA.endpoints[i++];
      if (statusById[ep.id] === "ok") return step();
      if (!ready(ep)) return step();           // skip locked; a later pass isn't attempted
      return emulate(ep).then(function(ok){ if (ok) return step(); });
    }
    step();
  });
})();
</script>
</body>
</html>`;
}
