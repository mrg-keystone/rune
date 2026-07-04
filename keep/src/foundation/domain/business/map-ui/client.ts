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

  button{font:inherit;border:1px solid #2c3142;background:#161a23;color:#e6e9ef;border-radius:6px;padding:.4rem .7rem;cursor:pointer}
  button:hover:not(:disabled){border-color:#3d4459}
  button:disabled{opacity:.4;cursor:not-allowed}
  button.primary{background:#1d2c44;border-color:#33547e}

  header{padding:.85rem 1.25rem;border-bottom:1px solid #232734;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;position:sticky;top:0;background:#0b0d12;z-index:10}
  header h1{font-size:1.05rem;margin:0;display:flex;align-items:baseline;gap:.5rem}
  .h-sub{color:#6b7394;font-weight:400;font-size:.85rem}
  header nav{display:flex;gap:.9rem;margin-top:.15rem}
  header nav a{color:#7aa2f7;text-decoration:none;font-size:.78rem}
  header nav a:hover{text-decoration:underline}
  .bar{margin-left:auto;display:flex;gap:.5rem;align-items:center}

  #banner{margin:.8rem 1.25rem 0;padding:.6rem .9rem;border-radius:8px;font-size:.85rem;border:1px solid}
  #banner.err{background:#2a1215;border-color:#6e2a2f;color:#ffb4ad}
  #banner.ok{background:#11261a;border-color:#2b5e3c;color:#7ee787}
  #banner.info{background:#13233a;border-color:#33547e;color:#9ecbff}
  #banner a{color:inherit;text-decoration:underline;font-family:ui-monospace,monospace}

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
  circle.dot.run{fill:#7aa2f7;stroke:#33547e;animation:kpulse .9s ease-in-out infinite}
  @keyframes kpulse{0%,100%{opacity:.45}50%{opacity:1}}
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
  // The page lives at <prefix>/docs/_map: standalone the prefix is "", mounted under a host it
  // is e.g. "/api" — every emulator link and localStorage key below carries it.
  var pagePath = location.pathname.replace(/\/+$/, "");
  var prefix = pagePath.replace(/\/docs\/_map$/, "");
  var indexLink = document.getElementById("link-index");
  if (indexLink) indexLink.href = prefix + "/docs";
  var traceLink = document.getElementById("link-trace");
  if (traceLink) traceLink.href = prefix + "/docs/_trace";

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

  // ── banner ─────────────────────────────────────────────────────────────────
  var bannerEl = document.getElementById("banner");
  function banner(kind, html) {
    if (!bannerEl) return;
    if (!kind) { bannerEl.hidden = true; return; }
    bannerEl.className = kind;
    bannerEl.innerHTML = html;
    bannerEl.hidden = false;
  }

  // ── live run state ─────────────────────────────────────────────────────────
  // ONE source of truth: the per-module cake sessions in localStorage. The map only ever reads
  // them; its own "Run all" (below) WRITES the headless report back into those sessions, so the
  // map, every cake tab, and a later page load all agree on the same colors and captures.
  var running = false;
  var settled = {};   // during a run: node key -> true once its streamed result landed
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
      // Mid-run, nodes pulse until their streamed result lands; settled ones show the session
      // truth that result just wrote. Off-walk nodes settle back at the end.
      var st = running && !settled[n.key] ? "run" : statusFor(n);
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

  // ── Run all (the whole composed process, server-side) ──────────────────────
  // POST the sibling /docs/_run with stream:true — the walk runs MODULE BY MODULE, endpoint by
  // endpoint (the order the lanes draw), like the cake's own defaults: untagged steps only (no
  // destructive flow branches), the user's typed environment variables as seeds, and each
  // module's per-step skips honored. Every streamed result is written into that module's cake
  // session (status, response meta, captures + shared scope) AS IT LANDS, and its node settles
  // green/red while the rest keep pulsing — so the map paints one step at a time and every cake
  // tab agrees afterwards. 403 (not localhost) / 503 (still booting) surface their message.

  // Mirrors the cake's freshState() — keep the shapes in sync.
  function freshSession() {
    return { v: 1, status: {}, captured: {}, meta: {}, userVars: {}, bodies: {}, paramVals: {}, expanded: {}, skips: {}, setup: [], asserts: {}, prev: {}, savedAt: 0 };
  }
  function readJson(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key));
      return parsed && parsed.v === 1 ? parsed : null;
    } catch (e) { return null; }
  }
  function writeBackRow(row) {
    if (!row || !row.module || !row.id) return;
    var key = "keep:emulator:" + prefix + "/docs/" + row.module;
    var session = readJson(key) || freshSession();
    ["status", "captured", "meta"].forEach(function (k) { if (!session[k]) session[k] = {}; });
    session.status[row.id] = row.ok ? "ok" : "fail";
    session.meta[row.id] = { http: row.status || 0, ms: row.ms || 0, body: row.body };
    if (row.ok && row.body !== null && typeof row.body === "object") {
      session.captured[row.id] = row.body;
      var globals = readJson("keep:emulator:globals") || { v: 1, vars: {}, captured: {}, persist: {} };
      if (!globals.captured) globals.captured = {};
      globals.captured[row.module + ":" + row.id] = row.body;
      try { localStorage.setItem("keep:emulator:globals", JSON.stringify(globals)); } catch (e) { /* best effort */ }
    }
    session.savedAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(session)); } catch (e) { /* storage full */ }
  }
  // The cake-session context the headless walk should run under: the user's typed environment
  // variables (literal values only — {{refs}} are page-side machinery) and every lane's skips.
  function sessionSeeds() {
    var globals = readJson("keep:emulator:globals");
    var out = {};
    if (globals && globals.vars) {
      Object.keys(globals.vars).forEach(function (name) {
        var v = globals.vars[name];
        if (typeof v === "string" && (v === "" || v.indexOf("{{") >= 0)) return;
        out[name] = v;
      });
    }
    return out;
  }
  function sessionSkips() {
    var out = [];
    var seen = {};
    DATA.nodes.forEach(function (n) {
      if (seen[n.module]) return;
      seen[n.module] = true;
      var session = readJson("keep:emulator:" + prefix + n.docsPath);
      if (!session || !session.skips) return;
      Object.keys(session.skips).forEach(function (id) {
        if (session.skips[id]) out.push(n.module + ":" + id);
      });
    });
    return out;
  }

  var runallBtn = document.getElementById("runall");
  function runFinished() {
    running = false;
    settled = {};
    runallBtn.disabled = false;
    runallBtn.textContent = "Run all";
    recolor();
  }
  function showReport(rep) {
    var nfail = (rep.failed || []).length;
    var nopt = (rep.optionalFailed || []).length;
    var ncyc = (rep.cycles || []).length;
    if (ncyc) {
      banner("err", "Dependency cycle — " + rep.cycles.map(function (c) {
        return esc(c.join(" → "));
      }).join("; ") + ".");
    } else if (nfail) {
      // Heal takes over from here: each failed step links straight into its cake step, where
      // the heal panel is already lit with this run's actual failure (the results were written
      // into the cake sessions as they streamed).
      banner("err", nfail + " step" + (nfail === 1 ? "" : "s") + " failed: " +
        (rep.failed || []).map(function (row) {
          var label = esc((row.module ? row.module + ":" : "") + row.id);
          if (!row.module) return label;
          return '<a href="' + esc(prefix + "/docs/" + row.module + "#" + encodeURIComponent(row.id)) + '">' + label + "</a>";
        }).join(", ") + "." + (nopt ? " " + nopt + " optional also failed." : "") +
        " Click a step to open its cake — the heal panel has the failure loaded.");
    } else {
      banner("ok", "All " + (rep.passed || 0) + " steps passed." +
        (nopt ? " " + nopt + " optional failed." : ""));
    }
  }
  if (runallBtn) {
    runallBtn.addEventListener("click", function () {
      if (running) return;
      running = true;
      settled = {};
      runallBtn.disabled = true;
      runallBtn.textContent = "Running…";
      banner("info", "Running each module in order, one endpoint at a time…");
      recolor();
      var done = 0;
      fetch(prefix + "/docs/_run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stream: true,
          orderBy: "module",
          flow: "__main",
          seeds: sessionSeeds(),
          skip: sessionSkips(),
        }),
      }).then(function (res) {
        if (!res.ok) {
          return res.json().then(
            function (v) { throw new Error(v && v.error ? v.error : "HTTP " + res.status); },
            function () { throw new Error("HTTP " + res.status); },
          );
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        function handleLine(line) {
          if (!line) return;
          var msg;
          try { msg = JSON.parse(line); } catch (e) { return; }
          if (msg.kind === "result") {
            writeBackRow(msg);
            settled[msg.module + ":" + msg.id] = true;
            done++;
            banner("info", "Running each module in order — " + done + " call" + (done === 1 ? "" : "s") + " completed…");
            recolor();
          } else if (msg.kind === "done") {
            runFinished();
            showReport(msg);
          } else if (msg.kind === "error") {
            runFinished();
            banner("err", "Run failed — " + esc(msg.error || "unknown error"));
          }
        }
        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) {
              handleLine(buffer.trim());
              if (running) runFinished();   // stream ended without a done line — settle anyway
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop();
            lines.forEach(function (l) { handleLine(l.trim()); });
            return pump();
          });
        }
        return pump();
      }).catch(function (err) {
        runFinished();
        banner("err", "Run failed — " + esc(err && err.message ? err.message : String(err)));
      });
    });
  }
})();
`;
