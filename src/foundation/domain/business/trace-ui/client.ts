/**
 * The request-trace waterfall's client assets, exported as plain strings so the page stays one
 * self-contained HTML response (no build step, no CDN).
 *
 * Same authoring rule as the map/emulator client.ts: `String.raw`, and the embedded JS/CSS must
 * never contain a backtick or a dollar-brace — both would terminate / interpolate the template
 * literal. Client code is therefore ES5-flavored string concatenation, never template literals,
 * and builds DOM with createElement rather than HTML strings.
 *
 * The page provides config as `window.__KEEP_TRACE__ = { app, dataUrl }`. The script polls
 * `dataUrl` (the localhost-only `/docs/_traces`) and renders, per request, a bar whose segments
 * are the timed spans; a crashed request shows a ✕ on the span that threw.
 */

export const traceCss: string = String.raw`
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;margin:0;background:#0b0d12;color:#e6e9ef}

  button{font:inherit;border:1px solid #2c3142;background:#161a23;color:#e6e9ef;border-radius:6px;padding:.4rem .7rem;cursor:pointer}
  button:hover:not(:disabled){border-color:#3d4459}
  button:disabled{opacity:.4;cursor:not-allowed}
  button.on{background:#1d2c44;border-color:#33547e}

  header{padding:.85rem 1.25rem;border-bottom:1px solid #232734;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;position:sticky;top:0;background:#0b0d12;z-index:10}
  header h1{font-size:1.05rem;margin:0;display:flex;align-items:baseline;gap:.5rem}
  .h-sub{color:#6b7394;font-weight:400;font-size:.85rem}
  header nav{display:flex;gap:.9rem;margin-top:.15rem}
  header nav a{color:#7aa2f7;text-decoration:none;font-size:.78rem}
  header nav a:hover{text-decoration:underline}
  .bar{margin-left:auto;display:flex;gap:.5rem;align-items:center}
  .count{color:#6b7394;font-size:.78rem}
  .store{color:#7aa2f7;font-size:.68rem;border:1px solid #283047;border-radius:5px;padding:.05rem .4rem;background:#0f1622}

  #filters{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.55rem 1.25rem;border-bottom:1px solid #1b2030;background:#0c0f16}
  #filters input,#filters select{font:inherit;font-size:.8rem;background:#11151f;color:#e6e9ef;border:1px solid #2c3142;border-radius:6px;padding:.32rem .5rem}
  #filters input{min-width:13rem}
  #filters input:focus,#filters select:focus{outline:none;border-color:#33547e}
  #filters .legend{margin-left:auto;padding:0}

  #wrap{padding:1rem 1.25rem 3rem;max-width:1100px}
  .empty{color:#6b7394;font-size:.9rem;padding:2rem 0}

  .trace{border:1px solid #232734;border-radius:9px;margin-bottom:.55rem;background:#0e1118;overflow:hidden}
  .thead{display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;cursor:pointer;user-select:none}
  .thead:hover{background:#11151f}
  .caret{color:#6b7394;width:.8rem;display:inline-block;transition:transform .12s}
  .trace.open .caret{transform:rotate(90deg)}
  .dot{width:.6rem;height:.6rem;border-radius:50%;flex:none;background:#3fb950}
  .dot.crash{background:#ff7b72}
  .meth{font:600 .7rem ui-monospace,monospace;letter-spacing:.03em;color:#9db4e6;background:#161d2c;border:1px solid #28324a;border-radius:5px;padding:.05rem .35rem}
  .user{font:.7rem ui-monospace,monospace;color:#9aa4bf;background:#141a26;border:1px solid #283047;border-radius:5px;padding:.05rem .4rem;cursor:pointer;max-width:13rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
  .user.none{color:#566175;border-style:dashed;cursor:default}
  .user:hover:not(.none){border-color:#3d4459;color:#cdd4e6}
  .route{font:.82rem ui-monospace,monospace;color:#d7dceb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stat{font:.7rem ui-monospace,monospace;color:#6b7394}
  .stat.bad{color:#ff9a92}
  .grow{margin-left:auto}
  .dur{font:600 .78rem ui-monospace,monospace;color:#e6e9ef}
  .when{color:#6b7394;font-size:.72rem;min-width:4.5rem;text-align:right}

  /* collapsed mini-bar: direct children laid out proportionally over the request */
  .mini{height:6px;border-radius:3px;background:#1a1f2b;position:relative;margin:.15rem .7rem .55rem;overflow:hidden}
  .mini i{position:absolute;top:0;bottom:0;border-radius:3px;opacity:.9}

  .falls{padding:.2rem .7rem .7rem;border-top:1px solid #1b2030}
  .axis{display:flex;justify-content:space-between;color:#56607d;font:.66rem ui-monospace,monospace;padding:.35rem 0 .25rem}
  .row{display:flex;align-items:center;gap:.5rem;height:1.45rem}
  .lbl{flex:none;width:240px;display:flex;align-items:center;gap:.35rem;white-space:nowrap;overflow:hidden}
  .lbl .nm{font:.74rem ui-monospace,monospace;color:#cdd4e6;overflow:hidden;text-overflow:ellipsis}
  .lbl .kd{font-size:.6rem;color:#6b7394;border:1px solid #28324a;border-radius:4px;padding:0 .25rem}
  .track{flex:1;position:relative;height:.85rem;background:#12161f;border-radius:4px}
  .seg{position:absolute;top:0;bottom:0;border-radius:4px;min-width:2px;display:flex;align-items:center}
  .seg .t{position:absolute;left:calc(100% + .3rem);font:.64rem ui-monospace,monospace;color:#8b93ac;white-space:nowrap}
  .k-request{background:#2d6cdf}
  .k-backend{background:#8957e5}
  .k-user{background:#2ea043}
  .seg.err{background:#da3633!important;box-shadow:0 0 0 1px #ff7b72 inset}
  .x{position:absolute;left:calc(100% + .3rem);color:#ff7b72;font-weight:700;font-size:.8rem;line-height:.85rem}
  .errline{color:#ff9a92;font:.68rem ui-monospace,monospace;padding:.1rem 0 .35rem 248px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  #banner{margin:0 0 .8rem;padding:.6rem .9rem;border-radius:8px;font-size:.85rem;border:1px solid #6e2a2f;background:#2a1215;color:#ffb4ad}
  .legend{display:flex;gap:1rem;color:#6b7394;font-size:.72rem;padding:.2rem 0 .9rem}
  .legend span{display:flex;align-items:center;gap:.3rem}
  .legend i{width:.7rem;height:.7rem;border-radius:3px;display:inline-block}
`;

export const traceClientJs: string = String.raw`
(function(){
  var CFG = window.__KEEP_TRACE__ || {};
  var DATA = CFG.dataUrl || "/docs/_traces";
  var wrap = document.getElementById("wrap");
  var countEl = document.getElementById("count");
  var pauseBtn = document.getElementById("pause");
  var clearBtn = document.getElementById("clear");
  var fRoute = document.getElementById("f-route");
  var fUser = document.getElementById("f-user");
  var fStatus = document.getElementById("f-status");
  var fMethod = document.getElementById("f-method");
  var storeEl = document.getElementById("store");
  var paused = false;
  var open = {};      // trace id -> expanded?
  var timer = null;
  var curUser = "";   // server-side user scope (sent as ?user=)

  function kindClass(k){ return k === "backend" ? "k-backend" : k === "request" ? "k-request" : "k-user"; }
  function fmtMs(ms){
    if (ms < 1) return (Math.round(ms * 1000) / 1000) + "ms";
    if (ms < 1000) return (Math.round(ms * 10) / 10) + "ms";
    return (Math.round(ms / 100) / 10) + "s";
  }
  function ago(ts){
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 1) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    return Math.round(m / 60) + "h ago";
  }
  function el(tag, cls, txt){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function byId(spans){ var m = {}; for (var i = 0; i < spans.length; i++) m[spans[i].id] = spans[i]; return m; }
  // Geometry in PERCENT, clamped so a span never overflows the track (sub-ms traces used to
  // explode past 100%) and always keeps a visible sliver.
  function place(seg, start, end, dur){
    var left = dur > 0 ? Math.max(0, Math.min(100, start / dur * 100)) : 0;
    var w = dur > 0 ? (end - start) / dur * 100 : 100;
    w = Math.max(0.6, Math.min(w, 100 - left));
    seg.style.left = left + "%";
    seg.style.width = w + "%";
  }
  function depthOf(span, m){
    var d = 0, p = span.parentId, guard = 0;
    while (p != null && guard++ < 64){ d++; var pe = m[p]; if (!pe) break; p = pe.parentId; }
    return d;
  }

  function miniBar(trace){
    var mini = el("div", "mini");
    var dur = trace.durationMs || 1;
    var m = byId(trace.spans);
    for (var i = 0; i < trace.spans.length; i++){
      var s = trace.spans[i];
      if (s.parentId !== 1) continue;            // only direct children of the request root
      var seg = el("i", kindClass(s.kind) + (s.error ? " err" : ""));
      place(seg, s.start, s.end, dur);
      if (s.error) seg.style.background = "#da3633";
      mini.appendChild(seg);
    }
    return mini;
  }

  function waterfall(trace){
    var box = el("div", "falls");
    var dur = trace.durationMs || 1;
    var m = byId(trace.spans);
    var axis = el("div", "axis");
    axis.appendChild(el("span", null, "0ms"));
    axis.appendChild(el("span", null, fmtMs(dur)));
    box.appendChild(axis);

    var spans = trace.spans.slice().sort(function(a,b){
      return (a.start - b.start) || (a.id - b.id);
    });
    for (var i = 0; i < spans.length; i++){
      var s = spans[i];
      var crashed = s.id === trace.crashedSpanId || !!s.error;
      var row = el("div", "row");
      var lbl = el("div", "lbl");
      lbl.style.paddingLeft = (depthOf(s, m) * 12) + "px";
      var nm = el("span", "nm", s.name);
      if (s.meta && s.meta.status) nm.textContent = s.name + "  (" + s.meta.status + ")";
      lbl.appendChild(nm);
      lbl.appendChild(el("span", "kd", s.kind));
      row.appendChild(lbl);

      var track = el("div", "track");
      var seg = el("div", "seg " + kindClass(s.kind) + (crashed ? " err" : ""));
      place(seg, s.start, s.end, dur);
      var t = el("span", "t", fmtMs(s.end - s.start));
      seg.appendChild(t);
      if (crashed){ var x = el("span", "x", "✖"); seg.appendChild(x); }
      track.appendChild(seg);
      row.appendChild(track);
      box.appendChild(row);

      if (s.error){
        box.appendChild(el("div", "errline", "✖ " + (s.error.type ? s.error.type + ": " : "") + s.error.message));
      }
    }
    return box;
  }

  function card(trace){
    var open0 = !!open[trace.id];
    var c = el("div", "trace" + (open0 ? " open" : ""));
    var head = el("div", "thead");
    head.appendChild(el("span", "caret", "▶"));
    head.appendChild(el("span", "dot" + (trace.ok ? "" : " crash")));
    head.appendChild(el("span", "meth", trace.method));
    head.appendChild(el("span", "route", trace.route));
    var st = el("span", "stat" + (trace.status >= 400 ? " bad" : ""), trace.status ? String(trace.status) : "");
    head.appendChild(st);
    var grow = el("span", "grow"); head.appendChild(grow);
    // User chip — click to filter the whole list down to this user.
    var u = el("span", "user" + (trace.user ? "" : " none"), trace.user || "anon");
    if (trace.user){
      u.title = "filter by " + trace.user;
      u.addEventListener("click", function(ev){
        ev.stopPropagation();
        selectUser(trace.user);
      });
    }
    head.appendChild(u);
    head.appendChild(el("span", "dur", fmtMs(trace.durationMs)));
    head.appendChild(el("span", "when", ago(trace.startedAt)));
    head.addEventListener("click", function(){
      open[trace.id] = !open[trace.id];
      render(LAST);
    });
    c.appendChild(head);
    c.appendChild(miniBar(trace));
    if (open0) c.appendChild(waterfall(trace));
    return c;
  }

  // Keep a <select>'s options in sync with the distinct values seen, preserving the current
  // choice (so a live poll never yanks the filter out from under the user).
  function syncOptions(sel, values, allLabel){
    var cur = sel.value;
    var want = [""].concat(values);
    var have = [];
    for (var i = 0; i < sel.options.length; i++) have.push(sel.options[i].value);
    if (have.join("") === want.join("")) return;       // unchanged — leave it alone
    sel.innerHTML = "";
    for (var k = 0; k < want.length; k++){
      var o = document.createElement("option");
      o.value = want[k];
      o.textContent = want[k] === "" ? allLabel : want[k];
      sel.appendChild(o);
    }
    sel.value = values.indexOf(cur) >= 0 ? cur : "";               // drop a choice that vanished
  }

  function distinct(traces, pick){
    var seen = {}, out = [];
    for (var i = 0; i < traces.length; i++){
      var v = pick(traces[i]);
      if (v && !seen[v]){ seen[v] = 1; out.push(v); }
    }
    out.sort();
    return out;
  }

  function matches(t){
    var r = fRoute.value.trim().toLowerCase();
    if (r && (t.route || "").toLowerCase().indexOf(r) < 0) return false;
    if (fUser.value && (t.user || "") !== fUser.value) return false;
    if (fMethod.value && t.method !== fMethod.value) return false;
    if (fStatus.value === "ok" && !t.ok) return false;
    if (fStatus.value === "crash" && t.ok) return false;
    return true;
  }

  function urlFor(){
    var q = "limit=200";
    if (curUser) q += "&user=" + encodeURIComponent(curUser);
    return DATA + "?" + q;
  }

  // Switch the server-side user scope and refetch — KV serves this from the per-user index.
  function selectUser(u){
    curUser = u || "";
    fUser.value = curUser;
    poll();
  }

  var LAST = { traces: [] };
  function render(data){
    LAST = data;
    var traces = data.traces || [];
    // The user list comes from the server (all users seen, even outside this page); methods are
    // derived from the page.
    syncOptions(fUser, data.users || distinct(traces, function(t){ return t.user; }), "all users");
    syncOptions(fMethod, distinct(traces, function(t){ return t.method; }), "any method");
    if (storeEl) storeEl.textContent = data.persistent ? "Deno KV" : "in-memory";
    renderFromLast();
  }

  function renderFromLast(){
    var data = LAST;
    var traces = data.traces || [];
    wrap.innerHTML = "";
    if (data.banner) wrap.appendChild(el("div", "banner", data.banner));

    if (!traces.length){
      countEl.textContent = "0 traces";
      wrap.appendChild(el("div", "empty",
        data.enabled === false
          ? "Tracing is disabled (KEEP_TRACE=off). Remove the env var to capture requests."
          : "No requests traced yet — call one of your endpoints, then watch it appear here."));
      return;
    }
    var shown = 0;
    for (var j = 0; j < traces.length; j++){
      if (!matches(traces[j])) continue;
      wrap.appendChild(card(traces[j]));
      shown++;
    }
    countEl.textContent = shown === traces.length
      ? (traces.length + " trace" + (traces.length === 1 ? "" : "s"))
      : (shown + " of " + traces.length);
    if (!shown){
      wrap.appendChild(el("div", "empty", "No traces match the current filters."));
    }
  }

  function poll(){
    fetch(urlFor(), { headers: { "accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : { traces: [], banner: "Trace data unavailable (HTTP " + r.status + ")." }; })
      .then(function(d){ render(d); })
      .catch(function(){ render({ traces: [], banner: "Could not reach /docs/_traces." }); });
  }

  // User scoping is server-side (refetch); route/status/method filter the loaded page in place —
  // no refetch, no focus loss.
  fUser.addEventListener("change", function(){ selectUser(fUser.value); });
  fRoute.addEventListener("input", renderFromLast);
  fStatus.addEventListener("change", renderFromLast);
  fMethod.addEventListener("change", renderFromLast);

  pauseBtn.addEventListener("click", function(){
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.classList.toggle("on", paused);
    if (!paused) poll();
  });
  clearBtn.addEventListener("click", function(){
    fetch(DATA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clear: true }) })
      .then(function(){ open = {}; poll(); })
      .catch(function(){});
  });

  poll();
  timer = setInterval(function(){ if (!paused) poll(); }, 2000);
})();
`;
