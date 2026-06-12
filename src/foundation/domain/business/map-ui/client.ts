/**
 * The system map's client assets, exported as plain strings so the page stays a single
 * self-contained HTML response (no build step, no CDN, no raw-import flags for consumers).
 *
 * Same authoring rule as the emulator's client.ts: `String.raw`, and the embedded JS/CSS must
 * never contain a backtick or a dollar-brace — both would terminate / interpolate the template
 * literal. Client code therefore uses string concatenation, ES5-flavored, never template
 * literals.
 *
 * The page provides the script's input as `window.__KEEP_MAP__`:
 * `{ app, nodes, edges, lanes, flows, width, height }` — positions are computed server-side
 * (see mod.ts buildMapModel), so this script only draws SVG and wires interactivity:
 * - lane titles link to each module's emulator page;
 * - node click deep-links to `/docs/<module>#<endpointId>` (the emulator expands that step);
 * - dots recolor from each module's emulator session in localStorage
 *   (`keep:emulator:<prefix>/docs/<module>`), live via the `storage` event, so running a step
 *   in any tab updates the map.
 */

export const mapCss: string = String.raw`
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;margin:0;background:#0b0d12;color:#e6e9ef}

  header{padding:.85rem 1.25rem;border-bottom:1px solid #232734;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;position:sticky;top:0;background:#0b0d12;z-index:10}
  header h1{font-size:1.05rem;margin:0;display:flex;align-items:baseline;gap:.5rem}
  .h-sub{color:#6b7394;font-weight:400;font-size:.85rem}
  header nav{display:flex;gap:.9rem;margin-top:.15rem}
  header nav a{color:#7aa2f7;text-decoration:none;font-size:.78rem}
  header nav a:hover{text-decoration:underline}

  #banner{margin:.8rem 1.25rem 0;padding:.6rem .9rem;border-radius:8px;font-size:.85rem;border:1px solid}
  #banner.err{background:#2a1215;border-color:#6e2a2f;color:#ffb4ad}
  #banner.ok{background:#11261a;border-color:#2b5e3c;color:#7ee787}
  #banner.info{background:#13233a;border-color:#33547e;color:#9ecbff}

  #legend{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap;padding:.55rem 1.25rem;border-bottom:1px solid #161a23;font-size:.72rem;color:#6b7394}
  .lg{display:inline-flex;align-items:center;gap:.35rem;white-space:nowrap}
  .lgline{stroke:#4d5468;stroke-width:2;fill:none}
  .lgline.dashed{stroke-dasharray:5 4}
  .lgdot{width:.68rem;height:.68rem;border-radius:50%;border:1px solid #2c3142;background:#12151d;display:inline-block}
  .lgdot.okd{border-color:#2b5e3c;background:#7ee787}
  .lgdot.faild{border-color:#6e2a2f;background:#ff7b72}
  .lgflow{width:.9rem;height:3px;display:inline-block;border-radius:2px}
  #legend-flows{display:inline-flex;gap:1.1rem}
  #legend-flows:empty{display:none}

  #canvas{overflow:auto;padding:1rem 1.25rem 3rem}
  svg#map{display:block}
  rect.lane{fill:#0d1017;stroke:#1b1f29}
  text.lane-title{fill:#9aa5ce;font:600 12px system-ui,sans-serif;cursor:pointer}
  a:hover text.lane-title{fill:#7aa2f7;text-decoration:underline}

  g.node{cursor:pointer}
  g.node rect{fill:#12151d;stroke:#2c3142}
  g.node:hover rect{stroke:#33547e}
  circle.dot{fill:#12151d;stroke:#2c3142}
  circle.dot.ok{fill:#7ee787;stroke:#2b5e3c}
  circle.dot.fail{fill:#ff7b72;stroke:#6e2a2f}
  text.nmethod{font:700 10px ui-monospace,monospace}
  text.nmethod.GET{fill:#7ee787}
  text.nmethod.POST{fill:#7aa2f7}
  text.nmethod.PUT,text.nmethod.PATCH{fill:#e3b341}
  text.nmethod.DELETE{fill:#ff7b72}
  text.npath{font:11px ui-monospace,monospace;fill:#e6e9ef}
  text.nchips{font:9px ui-monospace,monospace;fill:#9aa5ce}
  path.edge{fill:none;stroke-width:1.5;opacity:.85}
  path.edge.input{stroke-dasharray:5 4}
  text.edgelabel{font:9px ui-monospace,monospace;fill:#6b7394}
  text.edgelabel.input{fill:#e3b341}
`;

export const mapClientJs: string = String.raw`
(function () {
  "use strict";
  var DATA = window.__KEEP_MAP__;

  // ── paths ──────────────────────────────────────────────────────────────────
  // The page lives at <prefix>/docs/_map: standalone the prefix is "", mounted under Fresh it
  // is e.g. "/api" — every emulator link and localStorage key below carries it.
  var pagePath = location.pathname.replace(/\/+$/, "");
  var prefix = pagePath.replace(/\/docs\/_map$/, "");
  var indexLink = document.getElementById("link-index");
  if (indexLink) indexLink.href = prefix + "/docs";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Flow tints: the same palette family the emulator uses for its flow chips (#c792ea first).
  var PALETTE = ["#c792ea", "#7aa2f7", "#e3b341", "#7ee787", "#ff7b72", "#89ddff"];
  function flowColor(name) {
    var i = DATA.flows.indexOf(name);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  var byKey = {};
  DATA.nodes.forEach(function (n) { byKey[n.key] = n; });

  function pathTail(p) {
    return p.length > 26 ? "…" + p.slice(-25) : p;
  }

  // ── draw ───────────────────────────────────────────────────────────────────
  var svg = document.getElementById("map");
  svg.setAttribute("width", DATA.width);
  svg.setAttribute("height", DATA.height);
  svg.setAttribute("viewBox", "0 0 " + DATA.width + " " + DATA.height);

  var parts = [];

  // Lane backgrounds + module titles (each title links to that module's emulator page).
  DATA.lanes.forEach(function (lane) {
    parts.push('<rect class="lane" x="2" y="' + lane.y + '" width="' + (DATA.width - 4) +
      '" height="' + lane.h + '" rx="10"></rect>');
    parts.push('<a href="' + esc(prefix + lane.docsPath) + '"><text class="lane-title" x="14" y="' +
      (lane.y + 21) + '">' + esc(lane.module) + " →</text></a>");
  });

  // Edges under the nodes: bezier from the producer's right edge to the consumer's left edge.
  // Solid = a bind ("step.field" autofill); dashed = a "$input" satisfied by a producer in
  // another module. Single-flow edges take that flow's tint.
  DATA.edges.forEach(function (e) {
    var a = byKey[e.from];
    var b = byKey[e.to];
    if (!a || !b) return;
    var x1 = a.x + a.w;
    var y1 = a.y + a.h / 2;
    var x2 = b.x;
    var y2 = b.y + b.h / 2;
    var dx = Math.max(40, Math.abs(x2 - x1) / 2);
    var c1x = x1 + dx;
    var c2x = x2 - dx;
    var d = "M" + x1 + " " + y1 + " C" + c1x + " " + y1 + ", " + c2x + " " + y2 + ", " + x2 + " " + y2;
    var color = e.flows && e.flows.length === 1 ? flowColor(e.flows[0]) : "#4d5468";
    var mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
    var my = (y1 + y2) / 2;
    parts.push('<path class="edge' + (e.kind === "input" ? " input" : "") + '" data-edge="' +
      esc(e.from + "→" + e.to) + '" data-kind="' + esc(e.kind) + '" stroke="' + color +
      '" d="' + d + '"></path>');
    parts.push('<text class="edgelabel' + (e.kind === "input" ? " input" : "") + '" x="' + mx +
      '" y="' + (my - 5) + '" text-anchor="middle">' + esc(e.label) + "</text>");
  });

  // Nodes: rounded rect + status dot + METHOD + path tail + chips (flows / optional / stub /
  // unfulfilled $inputs).
  DATA.nodes.forEach(function (n) {
    var chips = [];
    (n.flows || []).forEach(function (f) {
      chips.push('<tspan dx="8" fill="' + flowColor(f) + '">' + esc(f) + "</tspan>");
    });
    if (n.optional) chips.push('<tspan dx="8" fill="#6b7394" font-style="italic">optional</tspan>');
    if (n.stub) chips.push('<tspan dx="8" fill="#e3b341">stub</tspan>');
    (n.inputs || []).forEach(function (name) {
      chips.push('<tspan dx="8" fill="#e3b341">$' + esc(name) + "</tspan>");
    });
    parts.push(
      '<g class="node" data-node="' + esc(n.key) + '" data-id="' + esc(n.id) + '" data-docs="' + esc(n.docsPath) + '">' +
        '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8"></rect>' +
        '<circle class="dot" cx="' + (n.x + 16) + '" cy="' + (n.y + n.h / 2) + '" r="5"></circle>' +
        '<text class="nmethod ' + esc(n.method) + '" x="' + (n.x + 28) + '" y="' + (n.y + 21) + '">' + esc(n.method) + "</text>" +
        '<text class="npath" x="' + (n.x + 28 + (n.method.length + 1) * 7) + '" y="' + (n.y + 21) + '">' + esc(pathTail(n.path)) + "</text>" +
        (chips.length ? '<text class="nchips" x="' + (n.x + 20) + '" y="' + (n.y + 38) + '">' + chips.join("") + "</text>" : "") +
        (n.description ? "<title>" + esc(n.description) + "</title>" : "") +
      "</g>",
    );
  });

  // innerHTML on an <svg> element parses in SVG context — same string-building style as the
  // emulator, no DOM-construction ceremony.
  svg.innerHTML = parts.join("");

  // ── click-through ──────────────────────────────────────────────────────────
  var nodeEls = {};
  svg.querySelectorAll("g[data-node]").forEach(function (g) {
    nodeEls[g.getAttribute("data-node")] = g;
    g.addEventListener("click", function () {
      location.href = prefix + g.getAttribute("data-docs") + "#" +
        encodeURIComponent(g.getAttribute("data-id"));
    });
  });

  // ── flow legend (dynamic — names come from the payload) ────────────────────
  var legendFlows = document.getElementById("legend-flows");
  if (legendFlows && DATA.flows.length) {
    legendFlows.innerHTML = DATA.flows.map(function (f) {
      return '<span class="lg"><span class="lgflow" style="background:' + flowColor(f) + '"></span>' + esc(f) + "</span>";
    }).join("");
  }

  // ── live run state ─────────────────────────────────────────────────────────
  // Each emulator page persists its session under "keep:emulator:" + its own page path; the
  // map reads OTHER pages' keys, computed from each node's docsPath plus the mount prefix.
  function statusFor(n) {
    try {
      var raw = localStorage.getItem("keep:emulator:" + prefix + n.docsPath);
      if (!raw) return "";
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.status) return "";
      var st = parsed.status[n.id];
      return st === "ok" ? "ok" : st === "fail" ? "fail" : "";
    } catch (e) { return ""; }
  }
  function recolor() {
    DATA.nodes.forEach(function (n) {
      var g = nodeEls[n.key];
      if (!g) return;
      var st = statusFor(n);
      g.querySelector(".dot").setAttribute("class", "dot" + (st ? " " + st : ""));
    });
  }
  recolor();
  // A step ran (or a session was reset) in another tab — recolor live. The storage event only
  // fires in OTHER tabs; this page re-reads everything on load anyway.
  window.addEventListener("storage", function (e) {
    if (e.key && e.key.indexOf("keep:emulator:") !== 0) return;
    recolor();
  });
})();
`;
