/**
 * The emulator's client assets, exported as plain strings so the page stays a single
 * self-contained HTML response (no build step, no CDN, no raw-import flags for consumers).
 *
 * Authored with `String.raw` so backslashes (regexes, escapes) read naturally. The one rule:
 * the embedded JS/CSS must never contain a backtick or `${` — both would terminate / interpolate
 * the template literal. Client code therefore uses string concatenation, never template literals.
 *
 * The page provides the script's input as `window.__KEEP_EMULATOR__` (`{ title, endpoints }`,
 * endpoints in process order — see endpoint-spec's SpecEndpoint) and includes docsSeedScript()
 * beforehand, so `window.__danetDocs.token()` is available for authorized calls.
 *
 * Client model (the Postman-style core): request bodies hold `{{step.field}}` references that are
 * resolved against captured responses + user variables AT SEND TIME — the editor text is never
 * rewritten by the app, so hand edits cannot be clobbered. Whole-string references substitute the
 * captured value with its native type; embedded references string-interpolate. Session state
 * (statuses, captured outputs, variables, edited bodies) persists in localStorage per page path.
 */

export const emulatorCss: string = String.raw`
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;margin:0;background:#0b0d12;color:#e6e9ef}
  button{font:inherit;border:1px solid #2c3142;background:#161a23;color:#e6e9ef;border-radius:6px;padding:.4rem .7rem;cursor:pointer}
  button:hover:not(:disabled){border-color:#3d4459}
  button:disabled{opacity:.4;cursor:not-allowed}
  button.primary{background:#1d2c44;border-color:#33547e}
  button.mini{font-size:.7rem;padding:.1rem .45rem;border-radius:4px;color:#9aa5ce}
  input{font:inherit;background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:5px;padding:.25rem .45rem}
  input:focus,textarea:focus{outline:none;border-color:#33547e}

  header{padding:.85rem 1.25rem;border-bottom:1px solid #232734;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;position:sticky;top:0;background:#0b0d12;z-index:10}
  header h1{font-size:1.05rem;margin:0;display:flex;align-items:baseline;gap:.5rem}
  .h-sub{color:#6b7394;font-weight:400;font-size:.85rem}
  header nav{display:flex;gap:.9rem;margin-top:.15rem}
  header nav a{color:#7aa2f7;text-decoration:none;font-size:.78rem}
  header nav a:hover{text-decoration:underline}
  .bar{margin-left:auto;display:flex;gap:.5rem;align-items:center}
  #session-note{font-size:.75rem;color:#6b7394}
  #flows{display:flex;gap:.15rem;background:#12151d;border:1px solid #232734;border-radius:7px;padding:.15rem}
  #flows button{border:none;background:none;border-radius:5px;padding:.25rem .6rem;font-size:.75rem;color:#6b7394}
  #flows button:hover{color:#9aa5ce}
  #flows button.active{background:#1d2c44;color:#e6e9ef}
  .offflow{display:none !important}
  .chip.flowchip{color:#c792ea;border-color:#3a2d4d}
  .chip.optchip{color:#6b7394;font-style:italic}
  .chip.stubchip{color:#e3b341;border-color:#4a3a1a}

  #banner{position:sticky;top:4rem;z-index:9;margin:.8rem 1.25rem 0;padding:.6rem .9rem;border-radius:8px;font-size:.85rem;border:1px solid;box-shadow:0 4px 14px #0008}
  #banner.err{background:#2a1215;border-color:#6e2a2f;color:#ffb4ad}
  #banner.ok{background:#11261a;border-color:#2b5e3c;color:#7ee787}
  #banner.info{background:#13233a;border-color:#33547e;color:#9ecbff}
  #banner .resume{margin-left:.6rem}

  main{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:0 1rem;align-items:start;padding:0 1.25rem 3rem}
  @media (max-width:1100px){main{grid-template-columns:minmax(0,1fr)}#rail{order:-1;margin-top:.8rem}}

  ul.steps{list-style:none;margin:.8rem 0 0;padding:0}
  ul.steps li{position:relative;border:1px solid #1b1f29;border-radius:10px;margin-bottom:.55rem;background:#0d1017}
  ul.steps li::before{content:"";position:absolute;left:1.62rem;top:-0.62rem;height:.62rem;width:2px;background:#1b1f29}
  ul.steps li:first-child::before{display:none}
  ul.steps li.s-ok{border-color:#1d3a28}
  ul.steps li.s-ok::before{background:#2b5e3c}
  ul.steps li.s-fail{border-color:#532a2e}
  ul.steps li.focused{box-shadow:0 0 0 2px #33547e}

  .row{display:flex;align-items:center;gap:.6rem;padding:.65rem .9rem;cursor:pointer;min-height:2.4rem}
  .dot{width:1.5rem;height:1.5rem;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#12151d;border:1px solid #2c3142;font-size:.8rem;color:#6b7394}
  .dot.ready{border-color:#33547e;color:#7aa2f7}
  .dot.ok{border-color:#2b5e3c;background:#11261a;color:#7ee787}
  .dot.fail{border-color:#6e2a2f;background:#2a1215;color:#ff7b72}
  .dot.run::before{content:"";width:.7rem;height:.7rem;border:2px solid #2c3142;border-top-color:#7aa2f7;border-radius:50%;animation:kspin .6s linear infinite}
  @keyframes kspin{to{transform:rotate(360deg)}}
  .num{color:#6b7394;font-size:.78rem;width:1.1rem;text-align:right;flex:none}
  .verb{font-weight:700;font-size:.68rem;letter-spacing:.03em;padding:.14rem .42rem;border-radius:4px;flex:none}
  .verb.POST{background:#13233a;color:#7aa2f7}.verb.GET{background:#11261a;color:#7ee787}
  .verb.PUT{background:#2d2410;color:#e3b341}.verb.PATCH{background:#2d2410;color:#e3b341}
  .verb.DELETE{background:#2a1215;color:#ff7b72}
  .path{font-family:ui-monospace,monospace;font-size:.88rem;white-space:nowrap}
  .opid{color:#4d5468;font-size:.72rem;font-family:ui-monospace,monospace;white-space:nowrap}
  .desc{color:#6b7394;font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chips{display:flex;gap:.3rem;min-width:0;overflow:hidden;flex-shrink:1}
  .chip{font-size:.68rem;font-family:ui-monospace,monospace;color:#9aa5ce;background:#12151d;border:1px solid #232734;border-radius:4px;padding:.08rem .35rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chip b{color:#7aa2f7;font-weight:600}
  .status-mini{margin-left:auto;font-size:.72rem;color:#6b7394;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;flex-shrink:1}
  .status-mini.fail{color:#ff7b72}
  .row .emulate{flex:none}

  .detail{display:none;padding:.1rem .9rem .9rem 3rem;border-top:1px solid #161a23}
  li.open .detail{display:block}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem;align-items:start}
  @media (max-width:900px){.cols{grid-template-columns:1fr}}
  .panel-head{font-size:.7rem;color:#6b7394;text-transform:uppercase;letter-spacing:.05em;margin:.75rem 0 .4rem;display:flex;align-items:center;gap:.5rem;min-height:1.4rem}
  .panel-head .mini{margin-left:auto}
  .addr{font-family:ui-monospace,monospace;font-size:.8rem;display:flex;gap:.5rem;align-items:baseline;background:#0e1117;border:1px solid #1b1f29;border-radius:6px;padding:.42rem .6rem;white-space:nowrap;overflow:hidden}
  .addr-verb{font-weight:700;font-size:.66rem;letter-spacing:.03em;flex:none}
  .addr-url{overflow:hidden;text-overflow:ellipsis}
  .addr-origin{color:#4d5468}
  .addr-path{color:#e6e9ef}
  .tabs{display:flex;align-items:center;margin:.45rem 0 0;border-bottom:1px solid #1b1f29}
  .tab{background:none;border:none;border-bottom:2px solid transparent;border-radius:0;color:#6b7394;font-size:.75rem;padding:.32rem .6rem;cursor:pointer}
  .tab:hover{color:#9aa5ce;border-color:transparent}
  .tab.active{color:#e6e9ef;border-bottom-color:#7aa2f7}
  .tab-dot{display:inline-block;width:.42rem;height:.42rem;border-radius:50%;margin-left:.3rem;vertical-align:1px;visibility:hidden}
  .tab-dot.ok{background:#7ee787;visibility:visible}
  .tab-dot.warn{background:#e3b341;visibility:visible}
  .tab-actions{margin-left:auto;display:flex;gap:.3rem;padding-bottom:.2rem}
  .tabpane{display:none;margin-top:.5rem}
  .tabpane.active{display:block}
  textarea{display:block;width:100%;min-height:4.6rem;background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:6px;font-family:ui-monospace,monospace;font-size:.82rem;line-height:1.5;padding:.55rem .6rem;resize:none;overflow:auto}
  textarea.bad{border-color:#6e2a2f}
  .json-err{color:#ff7b72;font-size:.74rem;margin-top:.25rem}
  .json-err:empty{display:none}
  .params{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.45rem}
  .params label{font-size:.72rem;color:#9aa5ce;display:flex;align-items:center;gap:.3rem}
  .params input{width:11rem;font-family:ui-monospace,monospace;font-size:.78rem}
  pre{background:#0e1117;border:1px solid #2c3142;border-radius:6px;padding:.55rem .6rem;overflow:auto;font-size:.78rem;line-height:1.5;margin:0;font-family:ui-monospace,monospace}
  pre.curl{white-space:pre-wrap;word-break:break-all}
  .resolved-note{font-size:.72rem;color:#e3b341;margin-top:.3rem}
  .resolved-note:empty{display:none}
  .pill{font-size:.7rem;font-weight:700;padding:.1rem .45rem;border-radius:99px;text-transform:none;letter-spacing:0;font-variant-numeric:tabular-nums}
  .pill.s2{background:#11261a;color:#7ee787}.pill.s3{background:#13233a;color:#9ecbff}
  .pill.s4{background:#2d2410;color:#e3b341}.pill.s5{background:#2a1215;color:#ff7b72}.pill.net{background:#2a1215;color:#ff7b72}
  .ms{font-size:.72rem;color:#6b7394;text-transform:none;font-variant-numeric:tabular-nums}
  .resp-empty{color:#4d5468;font-size:.78rem;font-style:italic;background:#0e1117;border:1px dashed #1b1f29;border-radius:6px;padding:.55rem .6rem}
  .captured-note{margin-top:.45rem;display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
  .captured-note .feeds-label{font-size:.7rem;color:#6b7394}
  .captured-note:empty{display:none}

  .j-key{color:#7aa2f7}.j-str{color:#a5d6a7}.j-num{color:#e3b341}.j-kw{color:#c792ea}
  .j-url{color:#9aa5ce}
  .j-miss{color:#ff7b72;background:#2a121540;border-radius:3px}

  #rail{position:sticky;top:4.4rem;margin-top:.8rem;display:flex;flex-direction:column;gap:.7rem}
  .railcard{border:1px solid #1b1f29;border-radius:10px;background:#0d1017;padding:.75rem .85rem}
  .railhead{font-size:.7rem;color:#6b7394;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem;display:flex;align-items:center}
  .railhead .mini{margin-left:auto}
  .progress{height:6px;background:#161a23;border-radius:3px;overflow:hidden;margin-bottom:.45rem}
  .progress-fill{height:100%;width:0;background:#2b5e3c;border-radius:3px;transition:width .25s}
  #progress-text{font-size:.78rem;color:#9aa5ce;font-variant-numeric:tabular-nums}
  .vargroup{margin-bottom:.55rem}
  .vargroup-head{font-size:.72rem;color:#6b7394;font-family:ui-monospace,monospace;margin:.3rem 0 .15rem}
  .var-row{display:flex;align-items:center;gap:.4rem;padding:.14rem 0;font-size:.76rem;font-family:ui-monospace,monospace}
  .var-name{color:#7aa2f7;cursor:pointer;white-space:nowrap}
  .var-name:hover{text-decoration:underline}
  .var-name.unset{color:#e3b341}
  .var-val{color:#a5d6a7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
  .var-row.flash .var-val{animation:kflash 1.2s}
  @keyframes kflash{0%{background:#2b5e3c66}100%{background:transparent}}
  .var-row input,.var-row select{flex:1;min-width:0;font-size:.74rem;font-family:ui-monospace,monospace;padding:.12rem .35rem}
  .var-row select{background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:5px}
  #vars .empty{font-size:.74rem;color:#4d5468;font-style:italic}
  .input-auto{font-size:.68rem;color:#6b7394;font-family:ui-monospace,monospace;margin:-.05rem 0 .3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #addvar{display:flex;gap:.35rem;margin-top:.5rem}
  #addvar input{flex:1;min-width:0;font-size:.74rem;font-family:ui-monospace,monospace}
  #addvar button{padding:.15rem .55rem}
  .hint{font-size:.7rem;color:#4d5468;margin-top:.45rem;line-height:1.45}
  .hint code{color:#6b7394;background:#12151d;padding:0 .25rem;border-radius:3px}
  kbd{font-size:.68rem;background:#161a23;border:1px solid #2c3142;border-bottom-width:2px;border-radius:4px;padding:0 .3rem;font-family:ui-monospace,monospace}
`;

export const emulatorClientJs: string = String.raw`
(function () {
  "use strict";
  var DATA = window.__KEEP_EMULATOR__;
  var EPS = DATA.endpoints;
  // Composed-app contract index for this module's $inputs: name -> "module:endpointId" of a
  // producer in another module whose output carries the same field name (server-computed).
  var PRODUCERS = DATA.producers || {};
  var byId = {};
  EPS.forEach(function (ep) { byId[ep.id] = ep; });

  // ── paths ──────────────────────────────────────────────────────────────────
  var pagePath = location.pathname.replace(/\/+$/, "");
  // App root: works standalone (/docs/<m>) and mounted under a prefix (/api/docs/<m>).
  var appRoot = location.origin + pagePath.replace(/\/docs\/[^/]+$/, "");
  document.getElementById("link-swagger").href = pagePath + "/swagger";
  // The sibling system map: /docs/<m> -> /docs/_map (the prefix-mounted form holds too).
  document.getElementById("link-map").href = pagePath.replace(/\/[^/]+$/, "/_map");
  var jsonLink = document.getElementById("link-json");
  jsonLink.href = pagePath + "/json";
  // The /json endpoint is token-gated for non-loopback callers; carry the stored token along.
  jsonLink.addEventListener("click", function () {
    var t = token();
    if (t) jsonLink.href = pagePath + "/json?token=" + encodeURIComponent(t);
  });

  function token() {
    try { return window.__danetDocs ? window.__danetDocs.token() : null; } catch (e) { return null; }
  }

  // ── session state (persisted per page path) ────────────────────────────────
  var KEY = "keep:emulator:" + pagePath;
  var state = freshState();
  var restoredAt = null;

  function freshState() {
    return { v: 1, status: {}, captured: {}, meta: {}, userVars: {}, bodies: {}, paramVals: {}, expanded: {}, savedAt: 0 };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) { state = parsed; restoredAt = parsed.savedAt || null; }
    } catch (e) { /* corrupted state is discarded */ }
  }

  // ── global scope (shared by every docs page on this origin) ────────────────
  // vars: the environment — user-defined values referenced as {{name}} or declared module
  // inputs ({{$name}}). captured: module-qualified endpoint outputs ("cake:driveToStore")
  // published on every successful run, referenced cross-module as {{cake:driveToStore.storeId}}.
  var GKEY = "keep:emulator:globals";
  var MODULE = DATA.title;
  var globals = { v: 1, vars: {}, captured: {} };
  function loadGlobals() {
    try {
      var raw = localStorage.getItem(GKEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) globals = parsed;
    } catch (e) { /* corrupted scope is discarded */ }
  }
  function saveGlobals() {
    try { localStorage.setItem(GKEY, JSON.stringify(globals)); } catch (e) { /* best effort */ }
  }
  // Another docs page ran a step or set a variable — pick it up live. (The storage event only
  // fires in OTHER tabs, so this can't fight an edit being typed here.)
  window.addEventListener("storage", function (e) {
    if (e.key !== GKEY) return;
    loadGlobals();
    updateAll();
  });
  var saveTimer = null;
  var resetting = false;
  function writeState() {
    state.savedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 150);
  }
  // Flush a pending debounced save when the page goes away, so a reload right after an action
  // (e.g. run-all finishing) can't lose it. Skipped while resetting — that must stay erased.
  window.addEventListener("pagehide", function () {
    if (resetting || !saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    writeState();
  });

  // ── reference resolution ({{step.field}} / {{userVar}}) ────────────────────
  var REF_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  var WHOLE_REF_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
  var REF_TEST = /\{\{[^{}]+\}\}/;   // stateless "contains a reference" check

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function walkPath(root, parts) {
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      if (cur !== null && typeof cur === "object" && parts[i] in cur) cur = cur[parts[i]];
      else return { found: false };
    }
    return { found: true, value: cur };
  }
  function lookupRef(ref) {
    // {{a.x || b.y}} — alternatives (the join after a branch): first resolvable wins.
    if (ref.indexOf("||") >= 0) {
      var alternatives = ref.split("||");
      for (var a = 0; a < alternatives.length; a++) {
        var r = lookupRef(alternatives[a].trim());
        if (r.found) return r;
      }
      return { found: false };
    }
    // {{$name}} — a declared external input. An explicit shared-environment value wins; when
    // it's unset (or cleared back to ""), the composed-app contract kicks in: a producer
    // endpoint in another module whose output carries this same field name (DATA.producers,
    // computed server-side) satisfies it from its shared capture.
    if (ref.charAt(0) === "$") {
      var name = ref.slice(1);
      if (hasOwn(globals.vars, name) && globals.vars[name] !== "") {
        return { found: true, value: globals.vars[name] };
      }
      var producerId = PRODUCERS[name];
      if (producerId && hasOwn(globals.captured, producerId)) {
        var cap = globals.captured[producerId];
        if (cap !== null && typeof cap === "object" && hasOwn(cap, name)) {
          return { found: true, value: cap[name] };
        }
      }
      return hasOwn(globals.vars, name) ? { found: true, value: globals.vars[name] } : { found: false };
    }
    // {{module:endpoint.field}} — another module's captured output (shared scope).
    if (ref.indexOf(":") >= 0) {
      var qparts = ref.split(".");
      if (!hasOwn(globals.captured, qparts[0])) return { found: false };
      return walkPath(globals.captured[qparts[0]], qparts.slice(1));
    }
    // {{name}} — environment variable…
    if (hasOwn(globals.vars, ref)) return { found: true, value: globals.vars[ref] };
    // …or {{endpoint.field}} — this page's captured outputs.
    var parts = ref.split(".");
    if (!hasOwn(state.captured, parts[0])) return { found: false };
    return walkPath(state.captured[parts[0]], parts.slice(1));
  }

  // Resolution is recursive (depth-capped): a variable's value may itself be a reference —
  // e.g. the environment var thingId = "{{alpha:create.id}}" tracks alpha's latest capture.
  function resolveString(s, missing, depth) {
    depth = depth || 0;
    var whole = s.match(WHOLE_REF_RE);
    if (whole) {
      var r = lookupRef(whole[1]);
      if (!r.found) { missing.push(whole[1]); return s; }
      if (typeof r.value === "string" && REF_TEST.test(r.value) && depth < 4) {
        return resolveString(r.value, missing, depth + 1);
      }
      return r.value;                          // typed: numbers/objects pass through intact
    }
    return s.replace(REF_RE, function (m, ref) {
      var r = lookupRef(ref);
      if (!r.found) { missing.push(ref); return m; }
      var v = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
      return REF_TEST.test(v) && depth < 4 ? String(resolveString(v, missing, depth + 1)) : v;
    });
  }

  function resolveValue(v, missing) {
    if (typeof v === "string") return resolveString(v, missing);
    if (Array.isArray(v)) return v.map(function (x) { return resolveValue(x, missing); });
    if (v !== null && typeof v === "object") {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = resolveValue(v[k], missing); });
      return out;
    }
    return v;
  }

  // ── request building ───────────────────────────────────────────────────────
  function hasBody(ep) { return ep.method !== "GET"; }

  function bindRefText(ref) {
    return Array.isArray(ref) ? ref.join(" || ") : ref;
  }
  function defaultBodyObj(ep) {
    var body = {};
    ep.inputSchema.forEach(function (f) {
      if (ep.bind[f.name]) {
        body[f.name] = "{{" + bindRefText(ep.bind[f.name]) + "}}";
      } else if (f.required) {
        body[f.name] = f.example;
      }
      // unbound OPTIONAL fields are omitted: zero-value placeholders (0, {})
      // fail the server's own validation (e.g. @IsPositive) or silently
      // distort the request (a placeholder filter matches nothing). Type a
      // value to opt in.
    });
    Object.keys(ep.bind).forEach(function (k) {
      if (!(k in body)) body[k] = "{{" + bindRefText(ep.bind[k]) + "}}";
    });
    return body;
  }
  function bodyText(ep) {
    return Object.prototype.hasOwnProperty.call(state.bodies, ep.id)
      ? state.bodies[ep.id]
      : JSON.stringify(defaultBodyObj(ep), null, 2);
  }
  // The schema knows each top-level field's type — after ref substitution,
  // coerce clean string forms to the declared type so "{{$qbId}}" arrives as
  // a number no matter how the value got here (typed input, capture, env).
  // Only unambiguous round-trips coerce; anything else is left for the
  // server's validation to name precisely.
  function coerceBySchema(ep, obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    ep.inputSchema.forEach(function (f) {
      var v = obj[f.name];
      if (typeof v !== "string") return;
      if (f.type === "integer" || f.type === "number") {
        if (v.trim() !== "" && !isNaN(Number(v))) obj[f.name] = Number(v);
      } else if (f.type === "boolean") {
        if (v === "true") obj[f.name] = true;
        else if (v === "false") obj[f.name] = false;
      } else if (f.type === "object" || f.type === "array") {
        try { obj[f.name] = JSON.parse(v); } catch (e) { /* leave as-is */ }
      }
    });
    return obj;
  }
  function resolveBody(ep) {
    var parsed;
    try { parsed = JSON.parse(bodyText(ep)); }
    catch (e) { return { error: "invalid JSON — " + e.message, missing: [] }; }
    var missing = [];
    return {
      value: coerceBySchema(ep, resolveValue(parsed, missing)),
      missing: missing,
    };
  }

  function paramVal(ep, name) { return (state.paramVals[ep.id] || {})[name] || ""; }
  function urlFor(ep, missing) {
    var p = ep.path;
    var query = [];
    ep.params.forEach(function (prm) {
      var resolved = resolveString(paramVal(ep, prm.name), missing);
      if (prm.in === "path") {
        var enc = encodeURIComponent(String(resolved));
        p = p.split("{" + prm.name + "}").join(enc);
        // Colon-style needs a word boundary so :id never eats into :idType.
        var colonRe = new RegExp(":" + prm.name.replace(/[^\w]/g, "\\$&") + "(?!\\w)", "g");
        p = p.replace(colonRe, function () { return enc; });
      } else if (resolved !== "" && resolved !== null && resolved !== undefined) {
        // Typed whole-ref values like 0 or false are real values — only blanks are omitted.
        query.push(encodeURIComponent(prm.name) + "=" + encodeURIComponent(String(resolved)));
      }
    });
    return appRoot + p + (query.length ? "?" + query.join("&") : "");
  }

  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function curlFor(ep) {
    var missing = [];
    var lines = ["curl -X " + ep.method + " " + shq(urlFor(ep, missing))];
    var t = token();
    if (t) lines.push("-H " + shq("authorization: Bearer " + t));
    if (hasBody(ep)) {
      lines.push("-H " + shq("content-type: application/json"));
      var r = resolveBody(ep);
      lines.push("-d " + shq(r.error ? bodyText(ep) : JSON.stringify(r.value)));
    }
    return lines.join(" \\" + "\n  ");
  }

  // ── data-flow maps ─────────────────────────────────────────────────────────
  // feeds[srcId] -> [{to, field, ref}] : who consumes this endpoint's outputs.
  var feeds = {};
  EPS.forEach(function (ep) {
    Object.keys(ep.bind).forEach(function (field) {
      var refs = Array.isArray(ep.bind[field]) ? ep.bind[field] : [ep.bind[field]];
      refs.forEach(function (ref) {
        if (ref.charAt(0) === "$") return;   // external inputs have no producer step
        var src = ref.split(".")[0];
        (feeds[src] = feeds[src] || []).push({ to: ep.id, field: field, ref: ref });
      });
    });
  });

  // ── flows (named branches through the process) ─────────────────────────────
  var FLOWS = [];
  EPS.forEach(function (ep) {
    (ep.flows || []).forEach(function (f) {
      if (FLOWS.indexOf(f) < 0) FLOWS.push(f);
    });
  });
  FLOWS.sort();
  function activeFlow() { return state.flow || ""; }
  // Untagged endpoints are part of every flow; tagged ones only of theirs.
  function inFlow(ep) {
    var flow = activeFlow();
    if (!flow) return true;
    return !ep.flows || ep.flows.length === 0 || ep.flows.indexOf(flow) >= 0;
  }
  function activeEPS() { return EPS.filter(inFlow); }
  var cycleMembers = {};
  (DATA.cycles || []).forEach(function (component) {
    component.forEach(function (id) { cycleMembers[id] = component; });
  });

  // A single dependency is satisfied when it passed (or is off-flow, so it doesn't gate).
  function depOk(d) {
    var dep = byId[d];
    if (dep && !inFlow(dep)) return true;
    return state.status[d] === "ok";
  }
  function ready(ep) {
    // A dependsOn entry that's an ARRAY is an OR-group: satisfied when ANY member is — so
    // "either enableRead or enableWrite unlocks select" is
    // dependsOn: [["enableRead", "enableWrite"]]. (Flow branches already OR-join via inFlow.)
    return ep.dependsOn.every(function (d) {
      return Array.isArray(d) ? d.some(depOk) : depOk(d);
    });
  }
  function blockers(ep) {
    var out = [];
    ep.dependsOn.forEach(function (d) {
      if (Array.isArray(d)) {
        if (!d.some(depOk)) out.push(d.join(" | "));
      } else if (!depOk(d)) out.push(d);
    });
    return out;
  }
  function stepLabel(ep) {
    return "step " + (EPS.indexOf(ep) + 1) + " (" + ep.method + " " + ep.path + ")";
  }

  // ── rendering helpers ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // Tokenize the RAW text first, then escape each piece — escaping first would turn the quotes
  // into &quot; and the string/key patterns could never match.
  function hlJson(text) {
    var re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) {
        out += '<span class="' + (m[2] ? "j-key" : "j-str") + '">' + esc(m[1]) + "</span>" + (m[2] || "");
      } else if (m[3] !== undefined) {
        out += '<span class="j-kw">' + m[3] + "</span>";
      } else {
        out += '<span class="j-num">' + m[0] + "</span>";
      }
      last = re.lastIndex;
    }
    return out + esc(text.slice(last));
  }
  function markMissing(html) {
    return html.replace(/\{\{[^{}]+\}\}/g, function (m) { return '<span class="j-miss">' + m + "</span>"; });
  }
  function agoText(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight + 2, 360) + "px";
  }
  function copyText(btn, text) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "copied ✓";
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* best effort */ }
      document.body.removeChild(ta);
      done();
    }
  }

  // ── banner ─────────────────────────────────────────────────────────────────
  var bannerEl = document.getElementById("banner");
  function banner(kind, html) {
    if (!kind) { bannerEl.hidden = true; return; }
    bannerEl.className = kind;
    bannerEl.innerHTML = html;
    bannerEl.hidden = false;
  }

  // ── step DOM ───────────────────────────────────────────────────────────────
  var rows = {};   // id -> li
  var listEl = document.getElementById("app");

  function bindChipsHtml(ep) {
    var chips = Object.keys(ep.bind).map(function (field) {
      var refText = Array.isArray(ep.bind[field]) ? ep.bind[field].join(" | ") : ep.bind[field];
      return '<span class="chip" title="autofilled from a captured response"><b>' +
        esc(field) + "</b> ← " + esc(refText) + "</span>";
    });
    (ep.flows || []).forEach(function (f) {
      chips.push('<span class="chip flowchip" title="only part of this flow">' + esc(f) + "</span>");
    });
    if (ep.optional) {
      chips.push('<span class="chip optchip" title="attempted but not required — its failure does not stop run-all">optional</span>');
    }
    if (ep.stub) {
      chips.push('<span class="chip stubchip" title="a generated stand-in endpoint minting placeholder values — not part of the real process">stub</span>');
    }
    return chips.join("");
  }

  function buildStep(ep, idx) {
    var li = document.createElement("li");
    li.dataset.id = ep.id;
    var feedsList = feeds[ep.id] || [];
    var feedsNote = feedsList.map(function (f) {
      return '<span class="chip" title="a captured output of this step autofills that field"><b>' +
        esc(f.to) + "." + esc(f.field) + "</b></span>";
    }).join("");
    li.innerHTML =
      '<div class="row" tabindex="0">' +
        '<span class="dot"></span>' +
        '<span class="num">' + (idx + 1) + "</span>" +
        '<span class="verb ' + esc(ep.method) + '">' + esc(ep.method) + "</span>" +
        '<span class="path">' + esc(ep.path) + "</span>" +
        '<span class="opid" title="endpoint id — what chips, variables and waiting-on labels refer to">' + esc(ep.id) + "</span>" +
        '<span class="desc">' + esc(ep.description || "") + "</span>" +
        '<span class="chips">' + bindChipsHtml(ep) + "</span>" +
        '<span class="status-mini"></span>' +
        '<button class="emulate">Run</button>' +
      "</div>" +
      '<div class="detail">' +
        '<div class="cols">' +
        '<div class="req">' +
          '<div class="panel-head">Request</div>' +
          '<div class="addr">' +
            '<span class="addr-verb verb ' + esc(ep.method) + '">' + esc(ep.method) + "</span>" +
            '<span class="addr-url"><span class="addr-origin"></span><span class="addr-path">' + esc(ep.path) + "</span></span>" +
          "</div>" +
          (ep.params.length
            ? '<div class="params">' +
              ep.params.map(function (prm) {
                return "<label>" + esc(prm.name) + (prm.required ? " *" : "") +
                  ' <input data-param="' + esc(prm.name) + '" placeholder="' + esc(prm.in) + '"></label>';
              }).join("") + "</div>"
            : "") +
          '<div class="tabs">' +
            (hasBody(ep) ? '<button class="tab" data-tab="body">Body</button>' : "") +
            '<button class="tab" data-tab="send">Will send<span class="tab-dot"></span></button>' +
            '<button class="tab" data-tab="curl">curl</button>' +
            '<span class="tab-actions">' +
              (hasBody(ep)
                ? '<button class="mini reset-body" data-for="body" title="restore the generated body">reset</button>'
                : "") +
              '<button class="mini copy-curl" data-for="curl">copy</button>' +
            "</span>" +
          "</div>" +
          (hasBody(ep)
            ? '<div class="tabpane" data-pane="body"><textarea spellcheck="false"></textarea><div class="json-err"></div></div>'
            : "") +
          '<div class="tabpane" data-pane="send"><pre class="resolved"></pre><div class="resolved-note"></div></div>' +
          '<div class="tabpane" data-pane="curl"><pre class="curl"></pre></div>' +
        "</div>" +
        '<div class="res">' +
          '<div class="panel-head">Response <span class="meta-pill"></span> <span class="ms"></span>' +
          '<button class="mini copy-resp">copy</button></div>' +
          '<pre class="resp" hidden></pre>' +
          '<div class="resp-empty">Not run yet — press <b>Run</b> to fire the real request.</div>' +
          '<div class="captured-note">' +
          (feedsNote ? '<span class="feeds-label">feeds</span>' + feedsNote : "") +
          "</div>" +
        "</div></div>" +
      "</div>";

    var row = li.querySelector(".row");
    var btn = li.querySelector(".emulate");
    row.addEventListener("click", function (e) {
      if (e.target.closest("button")) return;
      setFocusIdx(idx);   // keep the keyboard model in sync with the mouse
      toggleExpand(ep);
    });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target === row) { e.preventDefault(); toggleExpand(ep); }
    });
    btn.addEventListener("click", function (e) { e.stopPropagation(); send(ep); });

    // Request tabs: one content area, three views (Body / Will send / curl). Per-tab actions
    // (reset, copy) surface only with their tab. Panes stay in the DOM so previews keep updating.
    function activateTab(name) {
      li.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("active", t.dataset.tab === name);
      });
      li.querySelectorAll(".tabpane").forEach(function (p) {
        p.classList.toggle("active", p.dataset.pane === name);
      });
      li.querySelectorAll(".tab-actions .mini").forEach(function (b) {
        b.style.display = b.dataset.for === name ? "" : "none";
      });
    }
    li.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { activateTab(t.dataset.tab); });
    });
    activateTab(hasBody(ep) ? "body" : "send");
    li.querySelector(".addr-origin").textContent = appRoot;

    var ta = li.querySelector("textarea");
    if (ta) {
      ta.value = bodyText(ep);
      autosize(ta);
      ta.addEventListener("input", function () {
        state.bodies[ep.id] = ta.value;       // user text is sacred from the first keystroke
        autosize(ta);
        save();
        renderRequest(ep);
      });
      ta.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(ep); }
      });
      li.querySelector(".reset-body").addEventListener("click", function () {
        delete state.bodies[ep.id];
        ta.value = bodyText(ep);
        autosize(ta);
        save();
        renderRequest(ep);
      });
    }
    li.querySelectorAll(".params input").forEach(function (inp) {
      inp.value = paramVal(ep, inp.dataset.param);
      inp.addEventListener("input", function () {
        (state.paramVals[ep.id] = state.paramVals[ep.id] || {})[inp.dataset.param] = inp.value;
        save();
        renderRequest(ep);
      });
    });
    li.querySelector(".copy-curl").addEventListener("click", function (e) { copyText(e.target, curlFor(ep)); });
    li.querySelector(".copy-resp").addEventListener("click", function (e) {
      copyText(e.target, li.querySelector(".resp").textContent);
    });
    rows[ep.id] = li;
    return li;
  }

  function toggleExpand(ep, force) {
    var li = rows[ep.id];
    var open = force !== undefined ? force : !li.classList.contains("open");
    li.classList.toggle("open", open);
    if (open) {
      // The editor is unmeasurable while hidden — size it now that it's visible.
      var ta = li.querySelector("textarea");
      if (ta) autosize(ta);
    }
    state.expanded[ep.id] = open;
    save();
  }

  // ── per-step rendering ─────────────────────────────────────────────────────
  function renderRequest(ep) {
    var li = rows[ep.id];
    var resolvedEl = li.querySelector(".resolved");
    var noteEl = li.querySelector(".resolved-note");
    var errEl = li.querySelector(".json-err");
    var ta = li.querySelector("textarea");
    var dotEl = li.querySelector(".tab-dot");
    var hasRefs = REF_TEST.test(bodyText(ep)) ||
      ep.params.some(function (p) { return REF_TEST.test(paramVal(ep, p.name)); });
    var missing = [];
    // The URL line is escaped but not JSON-highlighted (ports would light up as numbers).
    var html = '<span class="j-url">' + esc(ep.method + " " + urlFor(ep, missing)) + "</span>";

    if (hasBody(ep)) {
      var r = resolveBody(ep);
      if (r.error) {
        if (ta) ta.classList.add("bad");
        if (errEl) errEl.textContent = r.error;
        resolvedEl.innerHTML = '<span class="j-miss">' + esc(r.error) + "</span>";
        if (dotEl) dotEl.className = "tab-dot warn";
        li.querySelector(".curl").textContent = curlFor(ep);
        return;
      }
      if (ta) ta.classList.remove("bad");
      if (errEl) errEl.textContent = "";
      missing = missing.concat(r.missing);
      html += "\n" + hlJson(JSON.stringify(r.value, null, 2));
    }
    resolvedEl.innerHTML = markMissing(html);
    noteEl.textContent = missing.length
      ? "waiting for " + missing.map(function (m) { return "{{" + m + "}}"; }).join(", ")
      : "";
    // The tab dot signals reference state at a glance: amber = something unresolved, green = all
    // references resolved, hidden = nothing to resolve.
    if (dotEl) {
      dotEl.className = "tab-dot" + (hasRefs ? (missing.length ? " warn" : " ok") : "");
    }
    li.querySelector(".curl").textContent = curlFor(ep);
  }

  function renderResponse(ep) {
    var li = rows[ep.id];
    var meta = state.meta[ep.id];
    var pill = li.querySelector(".meta-pill");
    var ms = li.querySelector(".ms");
    var resp = li.querySelector(".resp");
    var empty = li.querySelector(".resp-empty");
    if (!meta) {
      pill.innerHTML = "";
      ms.textContent = "";
      resp.textContent = "";
      resp.hidden = true;
      empty.hidden = false;
      return;
    }
    resp.hidden = false;
    empty.hidden = true;
    if (meta.http) {
      var cls = meta.http < 300 ? "s2" : meta.http < 400 ? "s3" : meta.http < 500 ? "s4" : "s5";
      pill.innerHTML = '<span class="pill ' + cls + '">HTTP ' + meta.http + "</span>";
    } else {
      pill.innerHTML = '<span class="pill net">network error</span>';
    }
    ms.textContent = meta.ms + " ms";
    resp.innerHTML = typeof meta.body === "string" ? esc(meta.body) : hlJson(JSON.stringify(meta.body, null, 2));
  }

  function updateRow(ep) {
    var li = rows[ep.id];
    var st = state.status[ep.id];
    var dot = li.querySelector(".dot");
    var btn = li.querySelector(".emulate");
    var mini = li.querySelector(".status-mini");
    var isReady = ready(ep);

    li.classList.toggle("offflow", !inFlow(ep));
    li.classList.toggle("s-ok", st === "ok");
    li.classList.toggle("s-fail", st === "fail");
    dot.className = "dot";
    if (st === "run") { dot.classList.add("run"); dot.textContent = ""; }
    else if (st === "ok") { dot.classList.add("ok"); dot.textContent = "✓"; }
    else if (st === "fail") { dot.classList.add("fail"); dot.textContent = "✗"; }
    else if (isReady) { dot.classList.add("ready"); dot.textContent = "●"; }
    else dot.textContent = "○";

    btn.disabled = !isReady || st === "run" || runningAll;
    var meta = state.meta[ep.id];
    mini.className = "status-mini" + (st === "fail" ? " fail" : "");
    if (st === "run") mini.textContent = "running…";
    else if (meta && (st === "ok" || st === "fail")) {
      mini.textContent = (meta.http ? "HTTP " + meta.http : "network error") + " · " + meta.ms + " ms";
    } else if (cycleMembers[ep.id] && !isReady) {
      mini.textContent = "dependency cycle: " + cycleMembers[ep.id].join(" → ") + " — fix dependsOn";
      mini.className = "status-mini fail";
    } else if (!isReady) {
      mini.textContent = "waiting on " + blockers(ep).join(", ");
    } else mini.textContent = "";
  }

  // ── variables panel ────────────────────────────────────────────────────────
  var varsEl = document.getElementById("vars");
  var lastVarValues = {};
  function renderVars() {
    // Never rebuild the panel out from under an actively-edited input (e.g. a run-all step
    // landing mid-keystroke) — the next state change re-renders it.
    if (varsEl.contains(document.activeElement)) return;
    var html = "";
    var newValues = {};
    EPS.forEach(function (ep) {
      if (!Object.prototype.hasOwnProperty.call(state.captured, ep.id)) return;
      var captured = state.captured[ep.id];
      html += '<div class="vargroup"><div class="vargroup-head">' + esc(ep.id) + "</div>";
      var entries = (captured !== null && typeof captured === "object" && !Array.isArray(captured))
        ? Object.keys(captured).map(function (k) { return { ref: ep.id + "." + k, value: captured[k] }; })
        : [{ ref: ep.id, value: captured }];
      entries.forEach(function (en) {
        var valText = typeof en.value === "string" ? en.value : JSON.stringify(en.value);
        newValues[en.ref] = valText;
        var flash = lastVarValues[en.ref] !== undefined && lastVarValues[en.ref] !== valText;
        html += '<div class="var-row' + (flash ? " flash" : "") + '">' +
          '<span class="var-name" data-ref="' + esc(en.ref) + '" title="click to copy {{' + esc(en.ref) + '}}">' + esc(en.ref) + "</span>" +
          '<span class="var-val" title="' + esc(valText) + '">' + esc(valText) + "</span>" +
          '<button class="mini copy-var" data-val="' + esc(valText) + '">copy</button>' +
        "</div>";
      });
      html += "</div>";
    });
    // Other modules' captured outputs (shared scope) — referenced as {{module:endpoint.field}}.
    var foreign = Object.keys(globals.captured).filter(function (key) {
      return key.indexOf(MODULE + ":") !== 0;
    }).sort();
    if (foreign.length) {
      html += '<div class="vargroup"><div class="vargroup-head">other modules</div>';
      foreign.forEach(function (key) {
        var captured = globals.captured[key];
        var entries = (captured !== null && typeof captured === "object" && !Array.isArray(captured))
          ? Object.keys(captured).map(function (k) { return { ref: key + "." + k, value: captured[k] }; })
          : [{ ref: key, value: captured }];
        entries.forEach(function (en) {
          var valText = typeof en.value === "string" ? en.value : JSON.stringify(en.value);
          newValues[en.ref] = valText;
          var flash = lastVarValues[en.ref] !== undefined && lastVarValues[en.ref] !== valText;
          html += '<div class="var-row' + (flash ? " flash" : "") + '">' +
            '<span class="var-name" data-ref="' + esc(en.ref) + '" title="click to copy {{' + esc(en.ref) + '}}">' + esc(en.ref) + "</span>" +
            '<span class="var-val" title="' + esc(valText) + '">' + esc(valText) + "</span>" +
            '<button class="mini copy-var" data-val="' + esc(valText) + '">copy</button>' +
          "</div>";
        });
      });
      html += "</div>";
    }
    // The environment: user-defined variables, shared by every docs page on this origin.
    var userNames = Object.keys(globals.vars).sort();
    if (userNames.length) {
      html += '<div class="vargroup"><div class="vargroup-head">environment</div>';
      userNames.forEach(function (name) {
        html += '<div class="var-row">' +
          '<span class="var-name" data-ref="' + esc(name) + '" title="click to copy {{' + esc(name) + '}}">' + esc(name) + "</span>" +
          '<input data-uservar="' + esc(name) + '" value="' + esc(globals.vars[name]) + '">' +
          '<button class="mini del-var" data-name="' + esc(name) + '">×</button>' +
        "</div>";
      });
      html += "</div>";
    }
    if (!html) html = '<div class="empty">Run a step to capture its outputs here.</div>';
    varsEl.innerHTML = html;
    lastVarValues = newValues;

    varsEl.querySelectorAll(".var-name").forEach(function (el) {
      el.addEventListener("click", function () { copyText(el, "{{" + el.dataset.ref + "}}"); });
    });
    varsEl.querySelectorAll(".copy-var").forEach(function (el) {
      el.addEventListener("click", function () { copyText(el, el.dataset.val); });
    });
    varsEl.querySelectorAll("input[data-uservar]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        globals.vars[inp.dataset.uservar] = inp.value;
        saveGlobals();
        // Re-render requests only — rebuilding the panel would destroy this input mid-keystroke.
        refreshRequests();
      });
    });
    varsEl.querySelectorAll(".del-var").forEach(function (el) {
      el.addEventListener("click", function () {
        delete globals.vars[el.dataset.name];
        el.blur();   // the focus guard would otherwise skip the rebuild and leave the row visible
        saveGlobals();
        updateAll();
      });
    });
  }

  // ── module inputs (declared $name binds) ───────────────────────────────────
  // moduleInputs: varName -> [endpoint ids that need it], from every bind whose value is "$name".
  var moduleInputs = {};
  var moduleInputTypes = {};   // $name -> { schemaType: true } across all its consumer fields
  EPS.forEach(function (ep) {
    var typeOfField = {};
    ep.inputSchema.forEach(function (f) { typeOfField[f.name] = f.type; });
    Object.keys(ep.bind).forEach(function (field) {
      var refs = Array.isArray(ep.bind[field]) ? ep.bind[field] : [ep.bind[field]];
      refs.forEach(function (ref) {
        if (ref.charAt(0) !== "$") return;
        var name = ref.slice(1);
        (moduleInputs[name] = moduleInputs[name] || []).push(ep.id);
        var t = typeOfField[field];
        if (t) (moduleInputTypes[name] = moduleInputTypes[name] || {})[t] = true;
      });
    });
  });
  // The card knows each $input's consumers — so it knows the type. Render a number widget (and
  // store a number) when every consumer that declares a type agrees it's numeric; the type is
  // knowable, so a plain text box would be the lie. Mixed/unknown inputs stay text and lean on
  // send-time coercion.
  function inputKind(name) {
    var ts = Object.keys(moduleInputTypes[name] || {});
    if (ts.length === 0) return "text";
    if (ts.every(function (t) { return t === "integer" || t === "number"; })) return "number";
    if (ts.every(function (t) { return t === "boolean"; })) return "boolean";
    return "text";
  }

  var inputsEl = document.getElementById("inputs");
  function renderInputs() {
    var names = Object.keys(moduleInputs).sort();
    document.getElementById("inputs-card").hidden = names.length === 0;
    if (!names.length) return;
    // Same rule as the variables panel: never rebuild under an actively-edited input.
    if (inputsEl.contains(document.activeElement)) return;
    inputsEl.innerHTML = names.map(function (name) {
      var set = hasOwn(globals.vars, name) && globals.vars[name] !== "";
      // No explicit value but a composed producer exists: the input is satisfied automatically
      // from that producer's capture — dim "auto" note, not the amber unset treatment. Typing a
      // value overrides; clearing it returns to auto.
      var auto = !set && hasOwn(PRODUCERS, name);
      var kind = inputKind(name);
      var cur = hasOwn(globals.vars, name) ? globals.vars[name] : "";
      var widget;
      if (kind === "boolean") {
        // A boolean $input is a 3-state select (unset / true / false) that stores a real boolean.
        var bopt = function (v, label) {
          return '<option value="' + v + '"' +
            (String(cur) === v ? " selected" : "") + ">" + label + "</option>";
        };
        widget = '<select data-gvar="' + esc(name) + '" data-kind="boolean">' +
          bopt("", auto ? "auto" : "—") + bopt("true", "true") + bopt("false", "false") +
          "</select>";
      } else {
        widget = '<input' + (kind === "number" ? ' type="number"' : "") +
          ' data-gvar="' + esc(name) + '" data-kind="' + kind + '" placeholder="' +
          (auto ? "auto" : "not set") + '" value="' + esc(cur) + '">';
      }
      return '<div class="var-row">' +
        '<span class="var-name' + (set || auto ? "" : " unset") + '" data-ref="$' + esc(name) +
        '" title="needed by ' + esc(moduleInputs[name].join(", ")) + ' — click to copy {{$' + esc(name) + '}}">' +
        esc(name) + "</span>" +
        widget +
      "</div>" +
      (auto
        ? '<div class="input-auto" title="another module\'s endpoint outputs this field — its capture fills the input; type a value to override">auto: ' +
          esc(PRODUCERS[name]) + "." + esc(name) + "</div>"
        : "");
    }).join("");
    inputsEl.querySelectorAll(".var-name").forEach(function (el) {
      el.addEventListener("click", function () { copyText(el, "{{" + el.dataset.ref + "}}"); });
    });
    inputsEl.querySelectorAll("input[data-gvar]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var raw = inp.value;
        // Numeric widgets store a real number into the shared scope so cross-page refs and the
        // "Will send" preview are typed at the source (send-time coercion still backs it up).
        globals.vars[inp.dataset.gvar] =
          (inp.dataset.kind === "number" && raw !== "" && !isNaN(Number(raw)))
            ? Number(raw)
            : raw;
        saveGlobals();
        refreshRequests();   // not renderInputs — that would destroy this input mid-keystroke
      });
    });
    inputsEl.querySelectorAll("select[data-gvar]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var v = sel.value;
        globals.vars[sel.dataset.gvar] = v === "true" ? true : v === "false" ? false : "";
        saveGlobals();
        refreshRequests();
      });
    });
  }

  // ── global refresh ─────────────────────────────────────────────────────────
  function updateProgress() {
    var list = activeEPS();
    var ok = list.filter(function (ep) { return state.status[ep.id] === "ok"; }).length;
    var fail = list.filter(function (ep) { return state.status[ep.id] === "fail"; }).length;
    document.querySelector(".progress-fill").style.width = (list.length ? (ok / list.length) * 100 : 0) + "%";
    document.getElementById("progress-text").textContent =
      ok + "/" + list.length + " passed" + (fail ? " · " + fail + " failed" : "") +
      (activeFlow() ? " · flow: " + activeFlow() : "");
  }
  var flowsEl = document.getElementById("flows");
  function renderFlows() {
    if (!FLOWS.length) return;
    flowsEl.hidden = false;
    var names = [""].concat(FLOWS);
    flowsEl.innerHTML = names.map(function (f) {
      return '<button data-flow="' + esc(f) + '"' +
        (activeFlow() === f ? ' class="active"' : "") + ">" + esc(f || "All") + "</button>";
    }).join("");
    flowsEl.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.flow = b.dataset.flow;
        save();
        banner(null);
        updateAll();
      });
    });
  }
  function refreshRequests() {
    EPS.forEach(function (ep) { renderRequest(ep); });
  }
  function refreshDerived() {
    refreshRequests();
    renderVars();
    renderInputs();
  }
  function allStepsGreen() {
    var list = activeEPS();
    return list.length > 0 && list.every(function (ep) { return state.status[ep.id] === "ok"; });
  }
  function updateAll() {
    EPS.forEach(function (ep) { updateRow(ep); renderResponse(ep); });
    refreshDerived();
    updateProgress();
    renderFlows();
    var runallBtn = document.getElementById("runall");
    runallBtn.disabled = runningAll;
    if (allStepsGreen()) {
      runallBtn.textContent = "Re-run all from scratch";
      runallBtn.title = "All steps passed — runs the whole chain again; each step's captured outputs are replaced as it re-passes (nothing is wiped up front)";
    } else {
      runallBtn.textContent = "Run all in order";
      runallBtn.title = "Walk the chain from the first step that hasn't passed; stops on the first failure";
    }
  }

  // ── send + run-all ─────────────────────────────────────────────────────────
  function send(ep, fromRunAll) {
    // One gate for every entry point (button, ⌘Enter, run-all): no double-fire of an in-flight
    // step, no manual pokes during a run-all walk, and locked steps explain themselves.
    if (state.status[ep.id] === "run") return Promise.resolve({ ok: false });
    if (!fromRunAll) {
      if (runningAll) return Promise.resolve({ ok: false });
      banner(null);   // a manual run invalidates any stale "all passed"/"stopped at" banner
      if (!ready(ep)) {
        banner("err", esc(stepLabel(ep)) + " is waiting on " + esc(blockers(ep).join(", ")) + " — run those first.");
        toggleExpand(ep, true);
        return Promise.resolve({ ok: false });
      }
    }
    var li = rows[ep.id];
    function blocked(reason) {
      toggleExpand(ep, true);
      renderRequest(ep);
      if (!fromRunAll) banner("err", "Cannot send " + esc(stepLabel(ep)) + " — " + esc(reason) + ".");
      return Promise.resolve({ blocked: reason });
    }
    var missing = [];
    var init = { method: ep.method, headers: {} };
    if (hasBody(ep)) {
      var r = resolveBody(ep);
      if (r.error) return blocked("its request body is " + r.error);
      missing = r.missing.slice();
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(r.value);
    }
    var url = urlFor(ep, missing);
    if (missing.length) {
      var who = missing.map(function (m) { return "{{" + m + "}}"; }).join(", ");
      return blocked(who + " cannot be resolved yet — run the step that produces it, or set it as a variable");
    }
    var t = token();
    if (t) init.headers["authorization"] = "Bearer " + t;

    state.status[ep.id] = "run";
    updateRow(ep);
    var t0 = performance.now();
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        state.meta[ep.id] = { http: res.status, ms: Math.round(performance.now() - t0), body: parsed };
        if (res.ok) {
          state.status[ep.id] = "ok";
          if (parsed !== null && typeof parsed === "object") {
            state.captured[ep.id] = parsed;
            // Publish to the shared scope so other modules' pages can reference it as
            // {{module:endpoint.field}}.
            globals.captured[MODULE + ":" + ep.id] = parsed;
            saveGlobals();
          }
        } else {
          state.status[ep.id] = "fail";
        }
        save();
        updateAll();
        return { ok: res.ok };
      });
    }).catch(function (err) {
      state.meta[ep.id] = { http: 0, ms: Math.round(performance.now() - t0), body: "ERROR " + (err && err.message ? err.message : String(err)) };
      state.status[ep.id] = "fail";
      save();
      updateAll();
      return { ok: false };
    });
  }

  var runningAll = false;
  function runAll() {
    if (runningAll) return;
    // A partial chain resumes from the first non-green step; a fully green chain re-runs from the
    // top. To re-run we only clear the ACTIVE flow's statuses (so step() doesn't skip every step
    // as already-ok) — captured outputs and response metas are kept and each step's send()
    // overwrites its own as it re-passes, so a failed re-run never destroys previous results.
    if (allStepsGreen()) {
      activeEPS().forEach(function (ep) { delete state.status[ep.id]; });
      save();
    }
    runningAll = true;
    banner(null);
    updateAll();
    var list = activeEPS();
    var optionalFailed = [];
    var i = 0;
    function done() { runningAll = false; updateAll(); }
    function step() {
      if (i >= list.length) {
        var passed = list.length - optionalFailed.length;
        banner("ok", "All " + passed + " required steps passed." + (optionalFailed.length
          ? " Optional failed: " + esc(optionalFailed.join(", ")) + "."
          : ""));
        return done();
      }
      var ep = list[i++];
      if (state.status[ep.id] === "ok") return step();
      if (!ready(ep)) {
        banner("err", "Stopped — " + esc(stepLabel(ep)) + " is waiting on " + esc(blockers(ep).join(", ")) + ".");
        toggleExpand(ep, true);
        rows[ep.id].scrollIntoView({ behavior: "smooth", block: "center" });
        return done();
      }
      return send(ep, true).then(function (result) {
        if (result.ok || ep.optional) {
          if (!result.ok) optionalFailed.push(ep.id);
          return step();   // optional steps report but never stop the walk
        }
        if (result.blocked) {
          banner("err", "Stopped at " + esc(stepLabel(ep)) + " — " + esc(result.blocked) + ".");
        } else {
          var meta = state.meta[ep.id];
          banner("err", "Stopped at " + esc(stepLabel(ep)) + " — " +
            esc(meta && meta.http ? "HTTP " + meta.http : "network error") +
            ". Fix it and press <b>Run all in order</b> to resume from here.");
        }
        toggleExpand(ep, true);
        rows[ep.id].scrollIntoView({ behavior: "smooth", block: "center" });
        return done();
      });
    }
    step();
  }

  // ── header actions ─────────────────────────────────────────────────────────
  document.getElementById("runall").addEventListener("click", runAll);
  document.getElementById("reset").addEventListener("click", function () {
    if (!confirm("Reset this module's session? Statuses, captured outputs and edited bodies will be cleared. Environment variables are shared across modules and stay.")) return;
    resetting = true;   // neither the debounced save nor the pagehide flush may resurrect the session
    if (saveTimer) clearTimeout(saveTimer);
    // This module's published captures are stale once its run state is gone.
    Object.keys(globals.captured).forEach(function (key) {
      if (key.indexOf(MODULE + ":") === 0) delete globals.captured[key];
    });
    saveGlobals();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  document.getElementById("addvar").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = e.target.elements.varname.value.trim();
    var value = e.target.elements.varvalue.value;
    if (!name || /[{}]/.test(name)) return;
    if (name.charAt(0) === "$") name = name.slice(1);   // tolerate "$tenantId" — stored unprefixed
    globals.vars[name] = value;
    e.target.reset();
    saveGlobals();
    updateAll();
  });

  // ── keyboard navigation ────────────────────────────────────────────────────
  var focusIdx = -1;
  function setFocusIdx(idx) {
    if (focusIdx >= 0 && EPS[focusIdx]) rows[EPS[focusIdx].id].classList.remove("focused");
    focusIdx = idx;
    rows[EPS[idx].id].classList.add("focused");
  }
  function focusStep(idx) {
    if (idx < 0 || idx >= EPS.length) return;
    setFocusIdx(idx);
    var li = rows[EPS[idx].id];
    li.querySelector(".row").focus();
    li.scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input") return;
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); focusStep(focusIdx < 0 ? 0 : focusIdx + 1); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); focusStep(focusIdx < 0 ? 0 : focusIdx - 1); }
    else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && focusIdx >= 0) {
      e.preventDefault();
      send(EPS[focusIdx]);
    }
  });

  // ── boot ───────────────────────────────────────────────────────────────────
  loadState();
  loadGlobals();
  // Migrate: user variables used to live per page — they are the environment now.
  if (state.userVars && Object.keys(state.userVars).length) {
    Object.keys(state.userVars).forEach(function (name) {
      if (!hasOwn(globals.vars, name)) globals.vars[name] = state.userVars[name];
    });
    state.userVars = {};
    saveGlobals();
    save();
  }
  EPS.forEach(function (ep, i) { listEl.appendChild(buildStep(ep, i)); });
  EPS.forEach(function (ep) {
    if (state.expanded[ep.id]) {
      rows[ep.id].classList.add("open");
      var ta = rows[ep.id].querySelector("textarea");
      if (ta) autosize(ta);
    }
    if (state.status[ep.id] === "run") delete state.status[ep.id];   // a reload mid-flight is not running
  });
  if (restoredAt) {
    var note = document.getElementById("session-note");
    note.textContent = "session restored · " + agoText(restoredAt);
    note.hidden = false;
  }
  updateAll();
  // Deep link from the system map (or a shared URL): #<endpointId> expands that step and
  // scrolls it into view.
  var hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hashId && byId[hashId]) {
    toggleExpand(byId[hashId], true);
    setFocusIdx(EPS.indexOf(byId[hashId]));
    rows[hashId].scrollIntoView({ block: "center" });
  }
  if ((DATA.cycles || []).length) {
    banner("err", "Dependency cycle — " + esc(DATA.cycles.map(function (c) {
      return c.join(" → ");
    }).join("; ")) + ". These steps wait on each other and can never unlock; fix their dependsOn.");
  }
})();
`;

/**
 * The dev-mode live-reload poller, injected only when the page is built with `opts.dev` (i.e.
 * the server booted under `KEEP_DEV` — `rune dev`). Polls the sibling `_dev` endpoint (relative,
 * so it resolves to `/docs/_dev` standalone and stays correct under a path-prefix mount) for
 * `{ bootId, ok?, errors?, at? }`: a changed bootId means the app restarted → reload the page
 * (session state lives in localStorage and survives); spec-check errors surface in `#banner`.
 *
 * Banner ownership: the emulator's own script also writes `#banner` (run-all "Stopped at…").
 * This script only ever clears/overwrites a banner it wrote itself — tracked by remembering the
 * exact HTML it set and re-checking before touching the element — so it can never clobber an
 * emulator message. Same String.raw rule as above: no backtick, no dollar-brace inside.
 */
export const devReloadJs: string = String.raw`
(function () {
  "use strict";
  var bannerEl = document.getElementById("banner");
  if (!bannerEl) return;
  var NORMAL_MS = 1500;
  var TIGHT_MS = 500;
  var ownedHtml = null;   // the exact HTML this script last wrote — ownership proof
  var ownedKind = null;
  function ownsBanner() {
    return ownedHtml !== null && !bannerEl.hidden && bannerEl.innerHTML === ownedHtml;
  }
  function devBanner(kind, html) {
    // A visible banner this script did not write belongs to the emulator (e.g. a run-all
    // "Stopped at step …") — never overwrite it.
    if (!bannerEl.hidden && !ownsBanner()) return;
    bannerEl.className = kind;
    bannerEl.innerHTML = html;
    bannerEl.hidden = false;
    ownedHtml = html;
    ownedKind = kind;
  }
  function clearOwned() {
    if (!ownsBanner()) return;
    bannerEl.hidden = true;
    ownedHtml = null;
    ownedKind = null;
  }
  function escText(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var bootId = null;
  var failures = 0;
  var delay = NORMAL_MS;
  var stopped = false;
  function schedule() {
    if (stopped) return;
    setTimeout(tick, delay);
  }
  function tick() {
    if (stopped) return;
    // Poll only while the tab is actually visible — keep checking visibility cheaply meanwhile.
    if (document.visibilityState !== "visible") { schedule(); return; }
    fetch("_dev").then(function (res) {
      if (res.status === 404) { stopped = true; return null; }   // not a dev server — stand down
      return res.json();
    }).then(function (data) {
      if (stopped || !data) return;
      failures = 0;
      delay = NORMAL_MS;
      if (bootId === null) {
        bootId = data.bootId;
      } else if (data.bootId !== bootId) {
        location.reload();   // a NEW process is serving — pick up its pages
        return;
      }
      // Back in contact (same boot): a "server restarting…" notice is obsolete.
      if (ownedKind === "info") clearOwned();
      if (data.errors && data.errors.length) {
        devBanner("err", data.errors.map(escText).join("<br>"));
      } else if (data.ok) {
        clearOwned();   // only a banner this script owns — never an emulator message
      }
      schedule();
    }).catch(function () {
      if (stopped) return;
      failures += 1;
      delay = TIGHT_MS;   // the server is likely restarting — watch closely for the new boot
      if (failures >= 2) devBanner("info", "server restarting…");
      schedule();
    });
  }
  schedule();
})();
`;
