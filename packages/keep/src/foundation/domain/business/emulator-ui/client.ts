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
  /* minmax(0,…): without it a long unwrapped response line expands the
     column past the viewport and slides under the side rail */
  .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.1rem;align-items:start}
  @media (max-width:900px){.cols{grid-template-columns:1fr}}
  .panel-head{font-size:.7rem;color:#6b7394;text-transform:uppercase;letter-spacing:.05em;margin:.75rem 0 .4rem;display:flex;align-items:center;gap:.5rem;min-height:1.4rem}
  .panel-head .mini{margin-left:auto}
  .addr{font-family:ui-monospace,monospace;font-size:.8rem;display:flex;gap:.5rem;align-items:center;background:#0e1117;border:1px solid #1b1f29;border-radius:6px;padding:.42rem .6rem;white-space:nowrap;overflow:hidden}
  .addr-verb{font-weight:700;font-size:.66rem;letter-spacing:.03em;flex:none}
  .addr-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .addr .copy-route{flex:none;margin-left:.25rem}
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
  /* long single-line error messages wrap instead of forcing a scroll/blowout */
  pre.resp{white-space:pre-wrap;overflow-wrap:anywhere}
  pre.curl{white-space:pre-wrap;word-break:break-all}
  .resolved-note{font-size:.72rem;color:#e3b341;margin-top:.3rem}
  .resolved-note:empty{display:none}
  .pill{font-size:.7rem;font-weight:700;padding:.1rem .45rem;border-radius:99px;text-transform:none;letter-spacing:0;font-variant-numeric:tabular-nums}
  .pill.s2{background:#11261a;color:#7ee787}.pill.s3{background:#13233a;color:#9ecbff}
  .pill.s4{background:#2d2410;color:#e3b341}.pill.s5{background:#2a1215;color:#ff7b72}.pill.net{background:#2a1215;color:#ff7b72}
  .ms{font-size:.72rem;color:#6b7394;text-transform:none;font-variant-numeric:tabular-nums}
  .resp-empty{color:#4d5468;font-size:.78rem;font-style:italic;background:#0e1117;border:1px dashed #1b1f29;border-radius:6px;padding:.55rem .6rem}
  .heal{margin-top:.55rem;background:#1d180c;border:1px solid #5e4a2b;border-radius:6px;padding:.5rem .6rem}
  .heal-head{font-size:.7rem;color:#e3b341;letter-spacing:.05em;text-transform:uppercase;margin-bottom:.3rem;display:flex;align-items:center;gap:.5rem}
  .heal-head .mini{margin-left:auto}
  .heal-item{display:flex;gap:.5rem;align-items:baseline;font-size:.78rem;color:#e6e9ef;padding:.16rem 0;flex-wrap:wrap}
  .heal-item .why{color:#9aa5ce}
  .heal-item select{max-width:15rem;background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:5px;font-size:.75rem}
  .heal-item .mini{flex:none}
  .heal-claude{margin-top:.45rem;border-top:1px dashed #5e4a2b;padding-top:.45rem;font-size:.78rem;color:#cdd3e0;white-space:pre-wrap;overflow-wrap:anywhere}
  .dot.warn{border-color:#5e4a2b;background:#e3b341;color:#1d180c}
  li.skipped .row{opacity:.45}
  li.skipped .row .skipbtn{opacity:1}
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
  .var-row .persist{flex:none;display:inline-flex;align-items:center;gap:.2rem;font-size:.66rem;color:#6b7394;font-family:system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  .var-row .persist input{flex:none;width:auto;min-width:0;margin:0;cursor:pointer}
  #vars .empty{font-size:.74rem;color:#4d5468;font-style:italic}

  #setup .empty{font-size:.74rem;color:#4d5468;font-style:italic}
  .setup-row{display:flex;align-items:center;gap:.4rem;padding:.16rem 0;font-size:.76rem;font-family:ui-monospace,monospace;flex-wrap:wrap}
  .setup-row.missing{opacity:.5}
  .setup-num{color:#6b7394;width:1rem;text-align:right;flex:none}
  .setup-name{color:#7aa2f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
  .setup-actions{display:flex;gap:.2rem;flex:none}
  .setup-body{width:100%;color:#6b7394;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:1.4rem}
  .su-dot{width:.5rem;height:.5rem;border-radius:50%;flex:none;background:#12151d;border:1px solid #2c3142}
  .su-dot.ok{background:#7ee787;border-color:#2b5e3c}
  .su-dot.fail{background:#ff7b72;border-color:#6e2a2f}
  .su-dot.run{background:#7aa2f7;border-color:#33547e;animation:kpulse .9s ease-in-out infinite}
  @keyframes kpulse{0%,100%{opacity:.45}50%{opacity:1}}
  .setup-edit{width:100%;padding-left:1.4rem}
  .setup-edit textarea{min-height:3rem;font-size:.74rem}
  .setup-edit .params input{width:8rem}
  #setup-add{display:block;width:100%;margin-top:.5rem;background:#0e1117;color:#9aa5ce;border:1px solid #2c3142;border-radius:5px;font-size:.74rem;padding:.25rem .35rem}
  #run-setup{margin-top:.5rem}

  #scenarios .empty{font-size:.74rem;color:#4d5468;font-style:italic}
  .scen-row{display:flex;align-items:center;gap:.4rem;padding:.16rem 0;font-size:.76rem;font-family:ui-monospace,monospace}
  .scen-name{color:#7aa2f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
  .scen-actions{display:flex;gap:.2rem;flex:none}
  #save-scenario{display:flex;gap:.35rem;margin-top:.5rem}
  #save-scenario input{flex:1;min-width:0;font-size:.74rem;font-family:ui-monospace,monospace}
  #save-scenario button{padding:.15rem .55rem}

  .expects{margin-top:.55rem;border:1px dashed #1b1f29;border-radius:6px;padding:.4rem .55rem}
  .expects-head{font-size:.7rem;color:#6b7394;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:.5rem}
  .expects-head .mini{margin-left:auto}
  .a-status-label{display:inline-flex;align-items:center;gap:.3rem;text-transform:none;letter-spacing:0;font-family:ui-monospace,monospace}
  .a-status{width:5.5rem;font-size:.72rem;font-family:ui-monospace,monospace;padding:.1rem .35rem}
  .a-row{display:flex;align-items:center;gap:.35rem;margin-top:.35rem;font-size:.74rem;font-family:ui-monospace,monospace}
  .a-row input{font-size:.74rem;font-family:ui-monospace,monospace;padding:.12rem .35rem}
  .a-path{flex:1;min-width:0}
  .a-val{flex:1;min-width:0}
  .a-row select{background:#0e1117;color:#e6e9ef;border:1px solid #2c3142;border-radius:5px;font-size:.72rem;font-family:ui-monospace,monospace}
  .a-verdict{font-size:.76rem;font-family:ui-monospace,monospace;padding:.12rem 0}
  .a-verdict.pass{color:#7ee787}
  .a-verdict.fail{color:#ff7b72}
  .a-verdict .a-got{color:#9aa5ce}
  .assert-results:empty{display:none}

  .diff{margin-top:.45rem}
  .diff:empty{display:none}
  .diff-head{font-size:.7rem;color:#e3b341;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.2rem}
  .diff-row{font-size:.74rem;font-family:ui-monospace,monospace;padding:.08rem 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .diff-path{color:#7aa2f7}
  .diff-from{color:#ff7b72}
  .diff-to{color:#7ee787}
  .diff-same{font-size:.72rem;color:#4d5468;font-style:italic}
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
  // Every endpoint in the composed app (any module) — the Module-setup picker's universe.
  var APP_EPS = DATA.appEndpoints || [];
  var appByKey = {};
  APP_EPS.forEach(function (ae) { appByKey[ae.module + ":" + ae.id] = ae; });

  // ── paths ──────────────────────────────────────────────────────────────────
  var pagePath = location.pathname.replace(/\/+$/, "");
  // Mount prefix ("" standalone, "/api" under Fresh) — other modules' session keys carry it.
  var pathPrefix = pagePath.replace(/\/docs\/[^/]+$/, "");
  // App root: works standalone (/docs/<m>) and mounted under a prefix (/api/docs/<m>).
  var appRoot = location.origin + pathPrefix;
  document.getElementById("link-swagger").href = pagePath + "/swagger";
  // The sibling system map: /docs/<m> -> /docs/_map (the prefix-mounted form holds too).
  document.getElementById("link-map").href = pagePath.replace(/\/[^/]+$/, "/_map");
  // The sibling request-trace waterfall: /docs/<m> -> /docs/_trace.
  document.getElementById("link-trace").href = pagePath.replace(/\/[^/]+$/, "/_trace");
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
    return { v: 1, status: {}, captured: {}, meta: {}, userVars: {}, bodies: {}, paramVals: {}, expanded: {}, skips: {}, setup: [], asserts: {}, prev: {}, savedAt: 0 };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) { state = parsed; restoredAt = parsed.savedAt || null; }
      if (!state.skips) state.skips = {};     // sessions saved before skip toggles existed
      if (!state.setup) state.setup = [];     // sessions saved before module setup existed
      if (!state.asserts) state.asserts = {}; // sessions saved before expectations existed
      if (!state.prev) state.prev = {};       // sessions saved before response diffing existed
    } catch (e) { /* corrupted state is discarded */ }
  }

  // ── global scope (shared by every docs page on this origin) ────────────────
  // vars: the environment — user-defined values referenced as {{name}} or declared module
  // inputs ({{$name}}). captured: module-qualified endpoint outputs ("cake:driveToStore")
  // published on every successful run, referenced cross-module as {{cake:driveToStore.storeId}}.
  var GKEY = "keep:emulator:globals";
  var MODULE = DATA.title;
  // persist: which environment variables (by name) are written to fixtures/cake.json — the
  // durable artifact. Shared across pages like the rest of the scope.
  var globals = { v: 1, vars: {}, captured: {}, persist: {} };
  function loadGlobals() {
    try {
      var raw = localStorage.getItem(GKEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) globals = parsed;
      if (!globals.persist) globals.persist = {};   // scope saved before persist flags existed
    } catch (e) { /* corrupted scope is discarded */ }
  }
  function saveGlobals() {
    try { localStorage.setItem(GKEY, JSON.stringify(globals)); } catch (e) { /* best effort */ }
  }
  // Another docs page ran a step or set a variable — pick it up live. (The storage event only
  // fires in OTHER tabs, so this can't fight an edit being typed here.)
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) {
      // Another tab wrote THIS module's session (the map's Run all, a cross-module setup
      // step). Merge the runner-owned slices into memory so the page shows it live and the
      // next local save can't clobber it. Page-local edits (bodies, params, asserts, setup,
      // skips, flow, expanded) always win from memory.
      try {
        var remote = JSON.parse(e.newValue);
        if (remote && remote.v === 1) {
          ["status", "meta", "captured", "prev"].forEach(function (k) {
            if (remote[k]) state[k] = remote[k];
          });
          updateAll();
        }
      } catch (err) { /* unreadable write — ignore */ }
      return;
    }
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
  function fieldFrom(obj, name) {
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj) && hasOwn(obj, name)) {
      return { found: true, value: obj[name] };
    }
    return { found: false };
  }
  // The plural half of the composition contract: a capture's name+"s" array supplies the
  // value for $name via its first scalar element (tableNames[0] -> $tableName).
  function pluralFrom(obj, name) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return { found: false };
    var arr = obj[name + "s"];
    if (Array.isArray(arr) && arr.length) {
      var v = arr[0];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return { found: true, value: v };
      }
    }
    return { found: false };
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
    // endpoint whose output carries this field name — exactly, or as a name+"s" collection
    // whose first element supplies the value (the plural half of the contract). The declared
    // producer (DATA.producers, computed server-side) is checked first, then every capture in
    // scope: exact fields anywhere beat plural fallbacks anywhere.
    if (ref.charAt(0) === "$") {
      var name = ref.slice(1);
      if (hasOwn(globals.vars, name) && globals.vars[name] !== "") {
        return { found: true, value: globals.vars[name] };
      }
      var producerId = PRODUCERS[name];
      if (producerId && hasOwn(globals.captured, producerId)) {
        var hit = fieldFrom(globals.captured[producerId], name);
        if (!hit.found) hit = pluralFrom(globals.captured[producerId], name);
        if (hit.found) return hit;
      }
      var entries = allCaptureEntries();
      for (var ei = 0; ei < entries.length; ei++) {
        var exact = fieldFrom(entries[ei].obj, name);
        if (exact.found) return exact;
      }
      for (var pi = 0; pi < entries.length; pi++) {
        var plural = pluralFrom(entries[pi].obj, name);
        if (plural.found) return plural;
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
  // overrideText (a setup step's frozen body) replaces the live editor text when present.
  function resolveBody(ep, overrideText) {
    var text = overrideText !== undefined ? overrideText : bodyText(ep);
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { error: "invalid JSON — " + e.message, missing: [] }; }
    var missing = [];
    return {
      value: coerceBySchema(ep, resolveValue(parsed, missing)),
      missing: missing,
    };
  }

  // overrideParams (a setup step's frozen params) replaces the live param state when present.
  function paramVal(ep, name, overrideParams) {
    return ((overrideParams || state.paramVals[ep.id]) || {})[name] || "";
  }
  function urlFor(ep, missing, overrideParams) {
    var p = ep.path;
    var query = [];
    ep.params.forEach(function (prm) {
      var resolved = resolveString(paramVal(ep, prm.name, overrideParams), missing);
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
  function flowLabel(f) { return f === "" ? "All" : f === "__main" ? "main" : f; }
  // Untagged endpoints are part of every flow; tagged ones only of theirs.
  // "__main" is the untagged-only pseudo-flow — the DEFAULT when flows exist,
  // so destructive branches (teardown) never run unless explicitly selected.
  function inFlow(ep) {
    var flow = activeFlow();
    if (!flow) return true;
    if (flow === "__main") return !ep.flows || ep.flows.length === 0;
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

  // ── expectations (per-step asserts) ─────────────────────────────────────────
  // A step is green only when the response also MEETS ITS PINNED EXPECTATIONS: an exact status
  // (optional; default any 2xx) plus body checks (path op value, values may hold {{refs}}).
  // Persisted with the session and into fixtures/cake.json — the committable contract-test layer.
  function assertSpec(ep) {
    var s = state.asserts[ep.id];
    if (!s) return null;
    var hasStatus = s.status !== undefined && s.status !== "";
    var checks = (s.checks || []).filter(function (c) { return c.path; });
    if (!hasStatus && !checks.length) return null;
    return { status: hasStatus ? String(s.status) : "", checks: checks };
  }
  function evalAsserts(ep, http, body) {
    var spec = assertSpec(ep);
    if (!spec) return null;
    var out = [];
    if (spec.status) {
      out.push({ desc: "status == " + spec.status, pass: String(http) === spec.status, got: String(http) });
    }
    spec.checks.forEach(function (c) {
      var r = walkPath(body, String(c.path).split("."));
      var missing = [];
      var expected = resolveString(String(c.value === undefined ? "" : c.value), missing);
      var expS = typeof expected === "string" ? expected : JSON.stringify(expected);
      var gotS = r.found ? (typeof r.value === "string" ? r.value : JSON.stringify(r.value)) : undefined;
      var pass;
      if (c.op === "exists") pass = r.found;
      else if (!r.found) pass = false;
      else if (c.op === "==") pass = gotS === expS || String(r.value) === expS;
      else if (c.op === "!=") pass = !(gotS === expS || String(r.value) === expS);
      else if (c.op === "contains") pass = String(gotS).indexOf(expS) >= 0;
      else pass = false;   // an unknown op fails closed — a typo must be visible, not silently green
      out.push({
        desc: c.path + " " + c.op + (c.op === "exists" ? "" : " " + expS),
        pass: pass,
        got: r.found ? gotS : "(missing)",
      });
    });
    return out;
  }
  function firstAssertFailure(meta) {
    if (!meta || !meta.asserts) return null;
    for (var i = 0; i < meta.asserts.length; i++) {
      if (!meta.asserts[i].pass) return meta.asserts[i];
    }
    return null;
  }

  // ── response diff (vs the previous run) ─────────────────────────────────────
  // Changed/added/removed paths between two parsed bodies, capped in count and depth so a huge
  // payload can't melt the page. Scalars-vs-objects and deeper-than-cap subtrees report as one
  // "changed" entry at their path.
  function diffJson(a, b, path, out, depth) {
    if (out.length >= 60 || a === b) return;
    var aObj = a !== null && typeof a === "object";
    var bObj = b !== null && typeof b === "object";
    if (aObj && bObj && Array.isArray(a) === Array.isArray(b) && (depth || 0) < 5) {
      var keys = {};
      Object.keys(a).forEach(function (k) { keys[k] = true; });
      Object.keys(b).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).forEach(function (k) {
        var p = path ? path + "." + k : k;
        if (!(k in b)) out.push({ path: p, kind: "removed", from: a[k] });
        else if (!(k in a)) out.push({ path: p, kind: "added", to: b[k] });
        else diffJson(a[k], b[k], p, out, (depth || 0) + 1);
      });
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path: path || "(response)", kind: "changed", from: a, to: b });
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
        '<button class="mini skipbtn" title="exclude this step from Run all (state stays where you parked it)">skip</button>' +
        '<button class="emulate">Run</button>' +
      "</div>" +
      '<div class="detail">' +
        '<div class="cols">' +
        '<div class="req">' +
          '<div class="panel-head">Request <span class="tab-actions">' +
            '<button class="mini add-setup" title="snapshot this request as a module setup step (runs before the process)">+ setup</button>' +
            '<button class="mini run-from" title="clear this and every later step, then run all from here">run from here</button>' +
          "</span></div>" +
          '<div class="addr">' +
            '<span class="addr-verb verb ' + esc(ep.method) + '">' + esc(ep.method) + "</span>" +
            '<span class="addr-url"><span class="addr-origin"></span><span class="addr-path">' + esc(ep.path) + "</span></span>" +
            '<button class="mini copy-route" title="copy this route\'s full URL">copy route</button>' +
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
          '<div class="assert-results"></div>' +
          '<div class="diff"></div>' +
          '<div class="expects">' +
            '<div class="expects-head">Expect' +
              '<label class="a-status-label">status <input class="a-status" placeholder="any 2xx" title="exact HTTP status this step must return — empty accepts any 2xx"></label>' +
              '<button class="mini add-check" title="pin a body expectation: the step only goes green when it holds">+ check</button>' +
            "</div>" +
            '<div class="a-rows"></div>' +
          "</div>" +
          '<div class="captured-note">' +
          (feedsNote ? '<span class="feeds-label">feeds</span>' + feedsNote : "") +
          "</div>" +
          '<div class="heal" hidden></div>' +
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
    li.querySelector(".skipbtn").addEventListener("click", function (e) {
      e.stopPropagation();
      if (state.skips[ep.id]) delete state.skips[ep.id];
      else state.skips[ep.id] = true;
      save();
      updateAll();
    });
    li.querySelector(".run-from").addEventListener("click", function (e) {
      e.stopPropagation();
      runAll(ep.id);
    });
    li.querySelector(".add-setup").addEventListener("click", function (e) {
      e.stopPropagation();
      // Snapshot THIS step's current request (body + params) as a setup step. The body keeps any
      // {{refs}} — they resolve when the setup step fires.
      state.setup = state.setup || [];
      state.setup.push({
        id: ep.id,
        body: hasBody(ep) ? bodyText(ep) : undefined,
        params: Object.assign({}, state.paramVals[ep.id] || {}),
      });
      save();
      renderSetup();
      var b = e.target;
      var old = b.textContent;
      b.textContent = "added ✓";
      setTimeout(function () { b.textContent = old; }, 1200);
    });

    // Request tabs: one content area, three views (Body / Will send / curl). Per-tab actions
    // (reset, copy) surface only with their tab. Panes stay in the DOM so previews keep updating.
    // Scope the per-tab show/hide to the TABS row only — the panel-head actions (run-from,
    // + setup) live in their own .tab-actions and must stay visible regardless of the active tab.
    function activateTab(name) {
      li.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("active", t.dataset.tab === name);
      });
      li.querySelectorAll(".tabpane").forEach(function (p) {
        p.classList.toggle("active", p.dataset.pane === name);
      });
      li.querySelectorAll(".tabs .tab-actions .mini").forEach(function (b) {
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
    li.querySelector(".copy-route").addEventListener("click", function (e) {
      e.stopPropagation();
      copyText(e.target, urlFor(ep, []));
    });
    li.querySelector(".copy-resp").addEventListener("click", function (e) {
      copyText(e.target, li.querySelector(".resp").textContent);
    });

    // Expectations editor: status pin + body checks. Rows rebuild only on explicit add/remove
    // (and fixtures load), never inside updateAll — so typing in them is never interrupted.
    var aStatus = li.querySelector(".a-status");
    aStatus.value = (state.asserts[ep.id] && state.asserts[ep.id].status) || "";
    aStatus.addEventListener("input", function () {
      ensureAssert(ep).status = aStatus.value.trim();
      save();
    });
    li.querySelector(".add-check").addEventListener("click", function (e) {
      e.stopPropagation();
      ensureAssert(ep).checks.push({ path: "", op: "==", value: "" });
      save();
      renderAssertEditor(ep);
    });
    rows[ep.id] = li;
    renderAssertEditor(ep);
    return li;
  }

  function ensureAssert(ep) {
    if (!state.asserts[ep.id]) state.asserts[ep.id] = { status: "", checks: [] };
    if (!state.asserts[ep.id].checks) state.asserts[ep.id].checks = [];
    return state.asserts[ep.id];
  }
  function renderAssertEditor(ep) {
    var li = rows[ep.id];
    if (!li) return;
    var holder = li.querySelector(".a-rows");
    if (!holder) return;
    var checks = (state.asserts[ep.id] && state.asserts[ep.id].checks) || [];
    holder.innerHTML = checks.map(function (c, i) {
      return '<div class="a-row" data-i="' + i + '">' +
        '<input class="a-path" placeholder="path e.g. status" value="' + esc(c.path || "") + '">' +
        '<select class="a-op">' + ["==", "!=", "contains", "exists"].map(function (op) {
          return "<option" + (c.op === op ? " selected" : "") + ">" + op + "</option>";
        }).join("") + "</select>" +
        '<input class="a-val" placeholder="value or {{ref}}" value="' + esc(c.value === undefined ? "" : c.value) + '"' + (c.op === "exists" ? " disabled" : "") + ">" +
        '<button class="mini a-del" title="remove this expectation">×</button>' +
      "</div>";
    }).join("");
    holder.querySelectorAll(".a-row").forEach(function (row) {
      var i = Number(row.dataset.i);
      var check = ensureAssert(ep).checks[i];
      row.querySelector(".a-path").addEventListener("input", function (e) { check.path = e.target.value.trim(); save(); });
      row.querySelector(".a-op").addEventListener("change", function (e) {
        check.op = e.target.value;
        row.querySelector(".a-val").disabled = check.op === "exists";
        save();
      });
      row.querySelector(".a-val").addEventListener("input", function (e) { check.value = e.target.value; save(); });
      row.querySelector(".a-del").addEventListener("click", function () {
        ensureAssert(ep).checks.splice(i, 1);
        save();
        renderAssertEditor(ep);
      });
    });
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

  // Keep the step the walk is on in view — collapsed — so you can follow run-all without
  // boxes auto-expanding under you. Only scrolls when the row isn't already comfortably in
  // the viewport below the sticky header (so already-visible steps don't jump).
  function ensureRowVisible(ep) {
    var li = rows[ep.id];
    if (!li) return;
    var header = document.querySelector("header");
    var top = header ? header.getBoundingClientRect().bottom : 0;
    var rect = li.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top >= top + 8 && rect.bottom <= vh - 8) return;
    li.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── self-healing: rules first, Claude for the long tail ────────────────────
  // Every failure here is STRUCTURED: an unresolved {{$input}}, a 422 whose
  // body names path+constraint, a spec-declared fault slug, or a cycle. The
  // rules below turn those into one-click fixes; the Ask Claude button sends
  // the same bundle to the server's /docs/_heal proxy for everything rules
  // can't name (cross-module causality, implementation bugs, ambiguity).
  var healCache = {};

  function allCaptureEntries() {
    var out = [];
    Object.keys(state.captured).forEach(function (id) {
      out.push({ ref: id, obj: state.captured[id] });
    });
    Object.keys(globals.captured).forEach(function (key) {
      out.push({ ref: key, obj: globals.captured[key] });
    });
    return out;
  }

  function capturesWithField(name) {
    var hits = [];
    allCaptureEntries().forEach(function (en) {
      if (en.obj && typeof en.obj === "object" && !Array.isArray(en.obj) && en.obj[name] !== undefined) {
        hits.push({ ref: en.ref + "." + name, value: en.obj[name] });
      }
    });
    return hits;
  }

  // singular input ↔ plural capture: tableName ← tableNames[i]
  function pluralOptions(name) {
    var opts = [];
    allCaptureEntries().forEach(function (en) {
      if (!en.obj || typeof en.obj !== "object") return;
      var arr = en.obj[name + "s"];
      if (!Array.isArray(arr)) return;
      arr.slice(0, 30).forEach(function (v) {
        if ((typeof v === "string" || typeof v === "number") && opts.indexOf(v) < 0) opts.push(v);
      });
    });
    return opts;
  }

  // scalar options out of an exactly-named array field in any capture ("tableNames" → its items)
  function pluralOptionsFrom(fieldName) {
    var opts = [];
    allCaptureEntries().forEach(function (en) {
      if (!en.obj || typeof en.obj !== "object") return;
      var arr = en.obj[fieldName];
      if (!Array.isArray(arr)) return;
      arr.slice(0, 30).forEach(function (v) {
        if ((typeof v === "string" || typeof v === "number") && opts.indexOf(v) < 0) opts.push(v);
      });
    });
    return opts;
  }

  function depIds(ep) {
    var ids = [];
    (ep.dependsOn || []).forEach(function (d) {
      (Array.isArray(d) ? d : [d]).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    });
    return ids;
  }

  function sgRun(id, why) {
    return { label: "Run " + id, why: why, action: { kind: "run-step", target: id } };
  }
  function sgInput(name, value, why) {
    return { label: "Set " + name + " = " + (typeof value === "string" ? value : JSON.stringify(value)), why: why, action: { kind: "set-input", target: name, value: value } };
  }
  function sgPick(name, options, why) {
    return { label: "Set " + name + " from", why: why, action: { kind: "pick", target: name, options: options } };
  }

  function diagnoseMissingRef(ep, ref, out) {
    var isInput = ref.charAt(0) === "$";
    var name = isInput ? ref.slice(1) : ref;
    // a step in this module produces the field — run it
    var producer = null;
    EPS.forEach(function (o) {
      if (!producer && o.id !== ep.id && (o.outputFields || []).indexOf(name) >= 0) producer = o;
    });
    if (producer && state.status[producer.id] !== "ok") {
      out.push(sgRun(producer.id, "it outputs " + name));
    }
    // an existing capture (any module) already holds the value
    capturesWithField(name).slice(0, 3).forEach(function (hit) {
      if (typeof hit.value === "string" || typeof hit.value === "number") {
        out.push(sgInput(name, hit.value, "from {{" + hit.ref + "}}"));
      }
    });
    // a PLURAL capture holds candidates — element picker
    var opts = pluralOptions(name);
    if (opts.length) out.push(sgPick(name, opts, "pick one of " + name + "s"));
    if (!out.length) {
      out.push({ label: "Type a value for " + name + " in Module inputs", why: "nothing in any session produces it", action: { kind: "focus-input", target: name } });
    }
  }

  function diagnoseAssert(ep, failures, out) {
    failures.forEach(function (f) {
      var fieldName = String(f.path || "").split(".")[0];
      var schemaField = null;
      (ep.inputSchema || []).forEach(function (sf) { if (sf.name === fieldName) schemaField = sf; });
      if (schemaField && !schemaField.required) {
        out.push({
          label: "Remove optional \"" + fieldName + "\" from the body",
          why: f.message || f.constraint,
          action: { kind: "remove-key", target: fieldName },
        });
        return;
      }
      if (/should not exist/.test(String(f.message || ""))) {
        var nearest = null;
        (ep.inputSchema || []).forEach(function (sf) {
          if (!nearest && (sf.name.indexOf(fieldName) >= 0 || fieldName.indexOf(sf.name) >= 0)) nearest = sf.name;
        });
        out.push({
          label: nearest ? "Did you mean \"" + nearest + "\"?" : "Remove unknown \"" + fieldName + "\"",
          why: "the DTO has no field " + fieldName,
          action: { kind: "remove-key", target: fieldName },
        });
        return;
      }
      // required and unsatisfiable inline → same machinery as a missing ref
      diagnoseMissingRef(ep, "$" + fieldName, out);
    });
  }

  var SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$|^(timeout|unauthorized)$/;

  // ── project heal rules (fixtures/heal-rules.json) ───────────────────────────
  // Slug diagnosis is project vocabulary, not framework knowledge: which endpoint un-blocks
  // "not-enabled" is this app's business. Projects declare it declaratively (rune generates a
  // starter from spec fault slugs); keep just executes the rules. Fetched once at boot through
  // the localhost-only /docs/_heal-rules door; absent file ⇒ generic tier only.
  var PROJECT_HEAL = { slugs: {} };
  function loadHealRules() {
    fetch(appRoot + "/docs/_heal-rules", { headers: { "accept": "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (v) {
        if (v && v.slugs && typeof v.slugs === "object") PROJECT_HEAL = v;
      })
      .catch(function () { /* remote caller or no rules file — generic tier still applies */ });
  }
  // "/re/flags" → RegExp; a bare string matches as a substring (escaped).
  function ruleRegex(spec) {
    var m = String(spec).match(/^\/(.*)\/([a-z]*)$/);
    try {
      return m ? new RegExp(m[1], m[2]) : new RegExp(String(spec).replace(/[^\w]/g, "\\$&"));
    } catch (e) { return null; }
  }
  function applyHealRule(ep, r, out) {
    if (!r || typeof r !== "object" || typeof r.kind !== "string") return;
    if (r.kind === "run-step") {
      if (r.target && byId[r.target]) {
        if (state.status[r.target] !== "ok") out.push(sgRun(r.target, r.why));
      } else if (r.match) {
        var re = ruleRegex(r.match);
        if (re) {
          EPS.forEach(function (o) {
            if (re.test(o.id) && o.id !== ep.id && state.status[o.id] !== "ok") out.push(sgRun(o.id, r.why));
          });
        }
      }
    } else if (r.kind === "set-input" && r.target) {
      out.push(sgInput(r.target, r.value, r.why));
    } else if (r.kind === "pick" && r.target && r.fromPlural) {
      var opts = pluralOptionsFrom(r.fromPlural);
      if (opts.length) out.push(sgPick(r.target, opts, r.why));
    } else if (r.kind === "remove-key" && r.target) {
      out.push({ label: "Remove \"" + r.target + "\" from the body", why: r.why, action: { kind: "remove-key", target: r.target } });
    } else if (r.kind === "set-body-field" && r.target) {
      out.push({ label: "Set body." + r.target + " = " + JSON.stringify(r.value), why: r.why, action: { kind: "set-body-field", target: r.target, value: r.value } });
    } else if (r.kind === "retry") {
      out.push({ label: "Retry " + ep.id, why: r.why, action: { kind: "retry" } });
    } else if (r.kind === "note" && r.label) {
      out.push({ label: r.label, why: r.why });
      if (r.retryAfter) out.push({ label: "Retry " + ep.id, why: "after the above", action: { kind: "retry" } });
    }
    // unknown kinds are ignored — forward compatibility with newer rule files
  }
  function diagnoseSlug(ep, slug, out) {
    // Project rules own the slug when they exist; the generic tier is only the fallback.
    var rules = (PROJECT_HEAL.slugs || {})[slug];
    if (Array.isArray(rules) && rules.length) {
      rules.forEach(function (r) { applyHealRule(ep, r, out); });
      return;
    }
    if (slug === "timeout" || slug === "unauthorized" || slug === "rate-limited") {
      out.push({
        label: "Retry " + ep.id,
        why: slug === "unauthorized"
          ? "upstream rejected the credentials — check the configured tokens"
          : slug === "rate-limited"
          ? "upstream rate limit — wait a moment"
          : "upstream timed out — transient, or the upstream is down",
        action: { kind: "retry" },
      });
      return;
    }
    depIds(ep).filter(function (id) { return byId[id] && state.status[id] !== "ok"; })
      .forEach(function (id) { out.push(sgRun(id, "declared dependency not green")); });
  }

  function diagnose(ep) {
    var meta = state.meta[ep.id];
    if (!meta) return [];
    var out = [];
    if (meta.missing && meta.missing.length) {
      meta.missing.forEach(function (ref) { diagnoseMissingRef(ep, ref, out); });
      return out;
    }
    var body = meta.body;
    if (body && typeof body === "object") {
      if (body.name === "RuneAssertError" && Array.isArray(body.failures)) {
        diagnoseAssert(ep, body.failures, out);
        return out;
      }
      var msg = typeof body.message === "string" ? body.message : "";
      if (SLUG_RE.test(msg)) {
        diagnoseSlug(ep, msg, out);
        return out;
      }
    }
    return out;
  }

  function applySuggestion(ep, sg, selectEl) {
    var a = sg.action;
    if (!a) return;
    if (a.kind === "run-step") {
      var dep = byId[a.target];
      if (dep) send(dep);
    } else if (a.kind === "set-input") {
      globals.vars[a.target] = String(a.value);
      saveGlobals();
      updateAll();
    } else if (a.kind === "pick") {
      if (selectEl && selectEl.value !== "") {
        globals.vars[a.target] = selectEl.value;
        saveGlobals();
        updateAll();
      }
    } else if (a.kind === "remove-key" || a.kind === "set-body-field") {
      try {
        var parsed = JSON.parse(bodyText(ep));
        if (a.kind === "remove-key") delete parsed[a.target];
        else parsed[a.target] = a.value;
        state.bodies[ep.id] = JSON.stringify(parsed, null, 2);
        var ta = rows[ep.id].querySelector("textarea");
        if (ta) { ta.value = state.bodies[ep.id]; autosize(ta); }
        save();
        renderRequest(ep);
        send(ep);
      } catch (e) { /* unparseable body — leave it to the human */ }
    } else if (a.kind === "retry") {
      send(ep);
    } else if (a.kind === "focus-input") {
      var box = document.querySelector('[data-gvar="' + a.target + '"]');
      if (box) { box.focus(); box.scrollIntoView({ block: "center" }); }
    }
  }

  function renderHeal(ep) {
    var li = rows[ep.id];
    var el = li.querySelector(".heal");
    if (!el) return;
    var st = state.status[ep.id];
    var suggestions = healCache[ep.id] || [];
    if (st !== "fail") { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    var html = '<div class="heal-head">⚠ heal' +
      '<button class="mini ask-claude" title="send the failure + session context to the configured private Claude for a diagnosis">Ask Claude</button></div>';
    suggestions.forEach(function (sg, i) {
      html += '<div class="heal-item"><span>' + esc(sg.label) + "</span>" +
        (sg.why ? '<span class="why">— ' + esc(sg.why) + "</span>" : "");
      if (sg.action && sg.action.kind === "pick") {
        html += '<span class="heal-actions"><select data-sg="' + i + '">' +
          '<option value="">choose…</option>' +
          sg.action.options.map(function (o) { return "<option>" + esc(String(o)) + "</option>"; }).join("") +
          "</select><button class=\"mini apply-sg\" data-sg=\"" + i + "\">Apply</button></span>";
      } else if (sg.action) {
        html += '<span class="heal-actions"><button class="mini apply-sg" data-sg="' + i + '">Apply</button></span>';
      }
      html += "</div>";
    });
    html += '<div class="heal-claude" hidden></div>';
    el.innerHTML = html;
    el.querySelectorAll(".apply-sg").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var i = Number(b.dataset.sg);
        var sel = el.querySelector('select[data-sg="' + i + '"]');
        applySuggestion(ep, suggestions[i], sel);
      });
    });
    el.querySelector(".ask-claude").addEventListener("click", function (e) {
      e.stopPropagation();
      askClaude(ep, el.querySelector(".heal-claude"));
    });
  }

  function pruneForClaude(v, depth) {
    depth = depth || 0;
    if (depth > 3) return "…";
    if (Array.isArray(v)) return v.slice(0, 10).map(function (x) { return pruneForClaude(x, depth + 1); });
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).slice(0, 40).forEach(function (k) { o[k] = pruneForClaude(v[k], depth + 1); });
      return o;
    }
    if (typeof v === "string" && v.length > 300) return v.slice(0, 300) + "…";
    return v;
  }

  function askClaude(ep, outEl) {
    var meta = state.meta[ep.id] || {};
    var resolved = hasBody(ep) ? resolveBody(ep) : { value: null };
    var bundle = {
      module: MODULE,
      endpoint: { id: ep.id, method: ep.method, path: ep.path, dependsOn: ep.dependsOn, bind: ep.bind, flows: ep.flows },
      request: { body: pruneForClaude(resolved.value) },
      response: { http: meta.http, body: pruneForClaude(meta.body) },
      missing: meta.missing || [],
      moduleInputs: globals.vars,
      statuses: state.status,
      captured: pruneForClaude(globals.captured),
      rulesTried: (healCache[ep.id] || []).map(function (sg) { return sg.label; }),
    };
    outEl.hidden = false;
    outEl.textContent = "Asking Claude… (this can take a minute)";
    fetch(appRoot + "/docs/_heal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bundle),
    }).then(function (res) {
      return res.json().then(function (v) { return { res: res, v: v }; });
    }).then(function (r) {
      if (!r.res.ok) {
        outEl.textContent = r.v && r.v.error ? r.v.error : "heal request failed (HTTP " + r.res.status + ")";
        return;
      }
      var v = r.v;
      var html = esc(v.diagnosis || "(no diagnosis)");
      var claudeSgs = [];
      (v.suggestions || []).forEach(function (sg) {
        var mapped = null;
        if (sg.kind === "set-input") mapped = { label: "Set " + sg.target + " = " + sg.value, why: sg.why, action: { kind: "set-input", target: sg.target, value: sg.value } };
        else if (sg.kind === "run-step-first") mapped = { label: "Run " + sg.target, why: sg.why, action: { kind: "run-step", target: sg.target } };
        else if (sg.kind === "edit-body") mapped = { label: "Set body." + sg.target + " = " + JSON.stringify(sg.value), why: sg.why, action: { kind: "set-body-field", target: sg.target, value: sg.value } };
        else mapped = { label: (sg.kind || "suggestion") + (sg.target ? ": " + sg.target : ""), why: sg.why };
        claudeSgs.push(mapped);
      });
      outEl.innerHTML = "<div>" + html + "</div>";
      claudeSgs.forEach(function (sg, i) {
        var div = document.createElement("div");
        div.className = "heal-item";
        div.innerHTML = "<span>" + esc(sg.label) + "</span>" + (sg.why ? '<span class="why">— ' + esc(sg.why) + "</span>" : "") +
          (sg.action ? '<span class="heal-actions"><button class="mini">Apply</button></span>' : "");
        var b = div.querySelector("button");
        if (b) b.addEventListener("click", function () { applySuggestion(ep, sg, null); });
        outEl.appendChild(div);
      });
    }).catch(function (err) {
      outEl.textContent = "heal request failed — " + (err && err.message ? err.message : String(err));
    });
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
    var verdicts = li.querySelector(".assert-results");
    var diffEl = li.querySelector(".diff");
    if (!meta) {
      pill.innerHTML = "";
      ms.textContent = "";
      resp.textContent = "";
      resp.hidden = true;
      empty.hidden = false;
      if (verdicts) verdicts.innerHTML = "";
      if (diffEl) diffEl.innerHTML = "";
      var healEl0 = li.querySelector(".heal");
      if (healEl0) { healEl0.hidden = true; healEl0.innerHTML = ""; }
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
    // Pinned-expectation verdicts from the run that produced this response.
    if (verdicts) {
      verdicts.innerHTML = (meta.asserts || []).map(function (a) {
        return '<div class="a-verdict ' + (a.pass ? "pass" : "fail") + '">' +
          (a.pass ? "✓ " : "✗ ") + esc(a.desc) +
          (a.pass ? "" : ' <span class="a-got">got ' + esc(a.got === undefined ? "(missing)" : a.got) + "</span>") +
        "</div>";
      }).join("");
    }
    // What this run changed vs the previous one.
    if (diffEl) {
      var prev = state.prev[ep.id];
      if (prev && prev.body !== undefined && meta.body !== undefined) {
        var changes = [];
        diffJson(prev.body, meta.body, "", changes, 0);
        if (!changes.length) {
          diffEl.innerHTML = '<span class="diff-same">unchanged vs previous run</span>';
        } else {
          var clip = function (v) {
            var s = v === undefined ? "" : JSON.stringify(v);
            return s.length > 60 ? s.slice(0, 60) + "…" : s;
          };
          diffEl.innerHTML = '<div class="diff-head">changed vs previous run (' + changes.length + ")</div>" +
            changes.slice(0, 20).map(function (d) {
              return '<div class="diff-row"><span class="diff-path">' + esc(d.path) + "</span> " +
                (d.kind === "added"
                  ? '<span class="diff-to">+ ' + esc(clip(d.to)) + "</span>"
                  : d.kind === "removed"
                  ? '<span class="diff-from">− ' + esc(clip(d.from)) + "</span>"
                  : '<span class="diff-from">' + esc(clip(d.from)) + '</span> → <span class="diff-to">' + esc(clip(d.to)) + "</span>") +
              "</div>";
            }).join("") +
            (changes.length > 20 ? '<div class="diff-row">…and ' + (changes.length - 20) + " more</div>" : "");
        }
      } else diffEl.innerHTML = "";
    }
    renderHeal(ep);
  }

  function updateRow(ep) {
    var li = rows[ep.id];
    var st = state.status[ep.id];
    var dot = li.querySelector(".dot");
    var btn = li.querySelector(".emulate");
    var mini = li.querySelector(".status-mini");
    var isReady = ready(ep);

    li.classList.toggle("offflow", !inFlow(ep));
    li.classList.toggle("skipped", !!state.skips[ep.id]);
    var skipBtn = li.querySelector(".skipbtn");
    if (skipBtn) skipBtn.textContent = state.skips[ep.id] ? "skipped" : "skip";
    li.classList.toggle("s-ok", st === "ok");
    li.classList.toggle("s-fail", st === "fail");
    healCache[ep.id] = st === "fail" ? diagnose(ep) : [];
    dot.className = "dot";
    if (st === "run") { dot.classList.add("run"); dot.textContent = ""; }
    else if (st === "ok") { dot.classList.add("ok"); dot.textContent = "✓"; }
    else if (st === "fail" && healCache[ep.id].length) { dot.classList.add("warn"); dot.textContent = "⚠"; }
    else if (st === "fail") { dot.classList.add("fail"); dot.textContent = "✗"; }
    else if (isReady) { dot.classList.add("ready"); dot.textContent = "●"; }
    else dot.textContent = "○";

    btn.disabled = !isReady || st === "run" || runningAll;
    var meta = state.meta[ep.id];
    mini.className = "status-mini" + (st === "fail" ? " fail" : "");
    if (st === "run") mini.textContent = "running…";
    else if (meta && (st === "ok" || st === "fail")) {
      mini.textContent = (meta.http ? "HTTP " + meta.http : "network error") + " · " + meta.ms + " ms" +
        (firstAssertFailure(meta) ? " · expect ✗" : "");
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
        var persisted = !!(globals.persist && globals.persist[name]);
        html += '<div class="var-row">' +
          '<span class="var-name" data-ref="' + esc(name) + '" title="click to copy {{' + esc(name) + '}}">' + esc(name) + "</span>" +
          '<input data-uservar="' + esc(name) + '" value="' + esc(globals.vars[name]) + '">' +
          '<label class="persist" title="save this variable to fixtures/cake.json on Save fixtures">' +
            '<input type="checkbox" data-persist="' + esc(name) + '"' + (persisted ? " checked" : "") + ">persist</label>" +
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
        delete (globals.persist || {})[el.dataset.name];
        el.blur();   // the focus guard would otherwise skip the rebuild and leave the row visible
        saveGlobals();
        updateAll();
      });
    });
    varsEl.querySelectorAll("input[data-persist]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (!globals.persist) globals.persist = {};
        if (cb.checked) globals.persist[cb.dataset.persist] = true;
        else delete globals.persist[cb.dataset.persist];
        saveGlobals();   // a checkbox toggle can't fight a text edit, so no rebuild needed
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
        ? '<div class="input-auto" title="a composed endpoint outputs this field (exactly, or as its plural collection) — its capture fills the input; type a value to override">auto: ' +
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
      (activeFlow() ? " · flow: " + flowLabel(activeFlow()) : "");
  }
  var flowsEl = document.getElementById("flows");
  function renderFlows() {
    if (!FLOWS.length) return;
    flowsEl.hidden = false;
    var names = ["__main", ""].concat(FLOWS);
    flowsEl.innerHTML = names.map(function (f) {
      return '<button data-flow="' + esc(f) + '"' +
        (activeFlow() === f ? ' class="active"' : "") + ">" + esc(flowLabel(f)) + "</button>";
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
  // ── module setup panel ──────────────────────────────────────────────────────
  // Setup steps may target ANY composed module's endpoint (s.module qualifies; absent = this
  // module) — setup's job is putting the whole app in a known state, not just this page.
  var setupEl = document.getElementById("setup");
  var setupRun = {};    // transient per-load: index -> "run" | "ok" | "fail"
  var setupOpen = {};   // transient: index -> frozen-request editor expanded
  // The endpoint a setup step targets: this page's full endpoint for local steps, the slim
  // app-index entry for foreign ones. Null = the endpoint no longer exists anywhere.
  function setupEndpointFor(s) {
    if (s.module && s.module !== MODULE) return appByKey[s.module + ":" + s.id] || null;
    return byId[s.id] || null;
  }
  function setupLabel(s) {
    var ae = setupEndpointFor(s);
    var qualifier = s.module && s.module !== MODULE ? s.module + ": " : "";
    return ae ? qualifier + ae.method + " " + ae.path : qualifier + s.id;
  }
  function renderSetup() {
    var steps = state.setup || [];
    var runBtn = document.getElementById("run-setup");
    if (runBtn) runBtn.disabled = runningAll || steps.length === 0;
    var saveBtn = document.getElementById("save-fixtures");
    if (saveBtn) saveBtn.disabled = runningAll;
    if (!setupEl) return;
    // Never rebuild the rows out from under an actively-edited frozen request.
    if (setupEl.contains(document.activeElement)) return;
    if (!steps.length) {
      setupEl.innerHTML = '<div class="empty">No setup steps yet. Pick any endpoint below (any module), or press <b>+ setup</b> in a step’s Request panel.</div>';
      return;
    }
    setupEl.innerHTML = steps.map(function (s, i) {
      var ae = setupEndpointFor(s);
      var missing = !ae;
      var st = setupRun[i] || "";
      var hasParams = !!(ae && (ae.params || []).length);
      var editable = s.body !== undefined || hasParams;
      var preview = (s.body || "").replace(/\s+/g, " ").trim().slice(0, 80);
      return '<div class="setup-row' + (missing ? " missing" : "") + '" data-i="' + i + '">' +
        '<span class="su-dot' + (st ? " " + st : "") + '"></span>' +
        '<span class="setup-num">' + (i + 1) + "</span>" +
        '<span class="setup-name" title="' + esc((s.module ? s.module + ":" : "") + s.id) + (missing ? " — endpoint no longer exists" : "") + '">' + esc(setupLabel(s)) + "</span>" +
        '<span class="setup-actions">' +
          '<button class="mini su-up"' + (i === 0 ? " disabled" : "") + ' title="move earlier">▲</button>' +
          '<button class="mini su-down"' + (i === steps.length - 1 ? " disabled" : "") + ' title="move later">▼</button>' +
          (editable ? '<button class="mini su-edit" title="edit this step’s frozen request">' + (setupOpen[i] ? "close" : "edit") + "</button>" : "") +
          '<button class="mini su-run"' + (missing || runningAll ? " disabled" : "") + ' title="run this setup step now">run</button>' +
          '<button class="mini su-del" title="remove from setup">×</button>' +
        "</span>" +
        (setupOpen[i]
          ? '<div class="setup-edit">' +
            (hasParams
              ? '<div class="params">' + ae.params.map(function (prm) {
                return "<label>" + esc(prm.name) + (prm.required ? " *" : "") +
                  ' <input data-suparam="' + esc(prm.name) + '" value="' + esc((s.params || {})[prm.name] || "") + '" placeholder="' + esc(prm.in) + '"></label>';
              }).join("") + "</div>"
              : "") +
            (s.body !== undefined ? '<textarea class="su-body" spellcheck="false"></textarea>' : "") +
            "</div>"
          : (preview ? '<span class="setup-body" title="' + esc(s.body || "") + '">' + esc(preview) + "</span>" : "")) +
      "</div>";
    }).join("");
    setupEl.querySelectorAll(".setup-row").forEach(function (row) {
      var i = Number(row.dataset.i);
      var up = row.querySelector(".su-up");
      var down = row.querySelector(".su-down");
      var run = row.querySelector(".su-run");
      var del = row.querySelector(".su-del");
      var edit = row.querySelector(".su-edit");
      if (up) up.addEventListener("click", function () { swapSetup(i, i - 1); });
      if (down) down.addEventListener("click", function () { swapSetup(i, i + 1); });
      if (del) {
        del.addEventListener("click", function () {
          state.setup.splice(i, 1);
          setupRun = {};   // indices shifted — transient UI state restarts clean
          setupOpen = {};
          save();
          renderSetup();
        });
      }
      if (run) run.addEventListener("click", function () { runOneSetup(i); });
      if (edit) edit.addEventListener("click", function () { setupOpen[i] = !setupOpen[i]; renderSetup(); });
      var ta = row.querySelector(".su-body");
      if (ta) {
        ta.value = state.setup[i].body || "";
        autosize(ta);
        ta.addEventListener("input", function () {
          state.setup[i].body = ta.value;   // edits save without re-render — focus is sacred
          autosize(ta);
          save();
        });
      }
      row.querySelectorAll("input[data-suparam]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          (state.setup[i].params = state.setup[i].params || {})[inp.dataset.suparam] = inp.value;
          save();
        });
      });
    });
  }
  function swapSetup(a, b) {
    var s = state.setup;
    if (!s || b < 0 || b >= s.length) return;
    var tmp = s[a]; s[a] = s[b]; s[b] = tmp;
    setupRun = {};
    setupOpen = {};
    save();
    renderSetup();
  }
  // The picker: every endpoint in the composed app, grouped by module. Choosing one appends a
  // setup step with a generated body whose bind refs are module-qualified (a foreign step's
  // "create.id" must read {{thatmodule:create.id}} from the shared scope, not this page's).
  function setupDefaultBody(ae) {
    function qualify(ref) {
      if (ref.charAt(0) === "$") return ref;
      return ae.module === MODULE ? ref : ae.module + ":" + ref;
    }
    function refText(v) {
      var refs = Array.isArray(v) ? v : [v];
      return "{{" + refs.map(qualify).join(" || ") + "}}";
    }
    var body = {};
    (ae.inputSchema || []).forEach(function (f) {
      if (ae.bind && ae.bind[f.name]) body[f.name] = refText(ae.bind[f.name]);
      else if (f.required) body[f.name] = f.example;
    });
    Object.keys(ae.bind || {}).forEach(function (k) {
      if (!(k in body)) body[k] = refText(ae.bind[k]);
    });
    return body;
  }
  function populateSetupPicker() {
    var sel = document.getElementById("setup-add");
    if (!sel) return;
    if (!APP_EPS.length) { sel.hidden = true; return; }
    var byModule = {};
    APP_EPS.forEach(function (ae) { (byModule[ae.module] = byModule[ae.module] || []).push(ae); });
    var html = '<option value="">+ add step from app…</option>';
    Object.keys(byModule).sort().forEach(function (m) {
      html += '<optgroup label="' + esc(m) + '">' + byModule[m].map(function (ae) {
        return '<option value="' + esc(ae.module + ":" + ae.id) + '">' + esc(ae.method + " " + ae.path) + "</option>";
      }).join("") + "</optgroup>";
    });
    sel.innerHTML = html;
    sel.addEventListener("change", function () {
      var ae = appByKey[sel.value];
      sel.value = "";
      if (!ae) return;
      state.setup = state.setup || [];
      var step = { id: ae.id };
      if (ae.module !== MODULE) step.module = ae.module;
      if (ae.method !== "GET") step.body = JSON.stringify(setupDefaultBody(ae), null, 2);
      state.setup.push(step);
      save();
      renderSetup();
    });
  }
  function runOneSetup(i) {
    var s = (state.setup || [])[i];
    if (!s || runningAll || !setupEndpointFor(s)) return;
    runningAll = true;
    banner(null);
    setupRun[i] = "run";
    updateAll();
    runSetupStep(s).then(function (r) {
      setupRun[i] = r.ok ? "ok" : "fail";
      runningAll = false;
      updateAll();
      if (r.ok) banner("ok", "Setup step ran — " + esc(setupLabel(s)) + ".");
      else banner("err", "Setup step failed — " + esc(setupLabel(s)) + " — " + esc(r.why) + ".");
    });
  }

  // ── fixtures artifact (fixtures/cake.json) ──────────────────────────────────
  // The durable counterpart to localStorage: setup steps (this module's slice) plus the
  // environment variables marked persist, written through the localhost-only /docs/_fixtures door.
  function persistedVars() {
    var out = {};
    Object.keys(globals.persist || {}).forEach(function (name) {
      if (globals.persist[name] && hasOwn(globals.vars, name)) out[name] = globals.vars[name];
    });
    return out;
  }
  // Only non-empty expectation specs travel into the artifact.
  function assertsForSave() {
    var out = {};
    EPS.forEach(function (ep) {
      var spec = assertSpec(ep);
      if (spec) out[ep.id] = { status: spec.status || undefined, checks: spec.checks };
    });
    return out;
  }
  function saveFixtures() {
    if (runningAll) return;
    var vars = persistedVars();
    var asserts = assertsForSave();
    var patch = { module: MODULE, setup: state.setup || [], asserts: asserts, variables: vars };
    var saveBtn = document.getElementById("save-fixtures");
    if (saveBtn) saveBtn.disabled = true;
    fetch(appRoot + "/docs/_fixtures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(function (res) {
      return res.json().then(function (v) { return { res: res, v: v }; }, function () { return { res: res, v: {} }; });
    }).then(function (r) {
      if (saveBtn) saveBtn.disabled = runningAll;
      if (!r.res.ok) {
        banner("err", "Save failed — " + esc(r.v && r.v.error ? r.v.error : "HTTP " + r.res.status) + ".");
        return;
      }
      banner("ok", "Saved fixtures/cake.json — " + patch.setup.length + " setup step(s), " + Object.keys(asserts).length + " expectation(s), " + Object.keys(vars).length + " variable(s).");
    }).catch(function (err) {
      if (saveBtn) saveBtn.disabled = runningAll;
      banner("err", "Save failed — " + esc(err && err.message ? err.message : String(err)) + ".");
    });
  }
  // On load, the saved artifact is the baseline: its persisted variables and this module's setup
  // override the local session for the keys it carries (the saved config wins).
  function applyFixtures(fx) {
    if (!fx || typeof fx !== "object") return;
    if (fx.variables && typeof fx.variables === "object") {
      if (!globals.persist) globals.persist = {};
      Object.keys(fx.variables).forEach(function (name) {
        globals.vars[name] = fx.variables[name];
        globals.persist[name] = true;
      });
      saveGlobals();
    }
    var mod = fx.modules && fx.modules[MODULE];
    if (mod && Array.isArray(mod.setup)) {
      state.setup = mod.setup;
      save();
    }
    if (mod && mod.asserts && typeof mod.asserts === "object") {
      Object.keys(mod.asserts).forEach(function (id) {
        if (!byId[id]) return;
        state.asserts[id] = {
          status: mod.asserts[id].status || "",
          checks: (mod.asserts[id].checks || []).slice(),
        };
        renderAssertEditor(byId[id]);
        var st = rows[id] && rows[id].querySelector(".a-status");
        if (st) st.value = state.asserts[id].status || "";
      });
      save();
    }
    updateAll();
  }
  function loadFixtures() {
    fetch(appRoot + "/docs/_fixtures", { headers: { "accept": "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (fx) { if (fx) applyFixtures(fx); })
      .catch(function () { /* fixtures unavailable (remote caller, or server lacks write perms) */ });
  }

  // ── scenarios (fixtures/scenarios/<name>.json) ──────────────────────────────
  // A scenario freezes THE WHOLE WALK — flow, every step's body text and params, skips — under a
  // name. Loading applies it over the page (editor state is overwritten); running is load + Run
  // all. CI replays one headlessly: POST /docs/_run {"scenario":"<name>"}.
  var SCENARIOS = [];
  var scenariosEl = document.getElementById("scenarios");
  function renderScenarios() {
    if (!scenariosEl) return;
    var mine = SCENARIOS.filter(function (s) { return s.module === MODULE; });
    if (!mine.length) {
      scenariosEl.innerHTML = '<div class="empty">None yet — set up a walk, then save it under a name.</div>';
      return;
    }
    scenariosEl.innerHTML = mine.map(function (s, i) {
      return '<div class="scen-row" data-i="' + i + '">' +
        '<span class="scen-name" title="' + esc(s.name) + (s.flow ? " · flow: " + esc(s.flow) : "") + '">' + esc(s.name) + "</span>" +
        '<span class="scen-actions">' +
          '<button class="mini scen-load" title="apply this scenario\'s bodies, params and flow to the page">load</button>' +
          '<button class="mini scen-run" title="load, then Run all">run</button>' +
        "</span>" +
      "</div>";
    }).join("");
    scenariosEl.querySelectorAll(".scen-row").forEach(function (row) {
      var s = mine[Number(row.dataset.i)];
      row.querySelector(".scen-load").addEventListener("click", function () {
        applyScenario(s);
        banner("info", "Scenario \"" + esc(s.name) + "\" loaded — bodies, params and flow applied.");
      });
      row.querySelector(".scen-run").addEventListener("click", function () {
        applyScenario(s);
        runAll();
      });
    });
  }
  function applyScenario(s) {
    state.flow = s.flow || "";
    (s.steps || []).forEach(function (st) {
      var ep = byId[st.id];
      if (!ep) return;   // the scenario predates a spec change — apply what still exists
      if (st.body !== undefined) {
        state.bodies[st.id] = st.body;
        var ta = rows[st.id].querySelector("textarea");
        if (ta) { ta.value = st.body; autosize(ta); }
      }
      if (st.params) {
        state.paramVals[st.id] = Object.assign({}, st.params);
        rows[st.id].querySelectorAll(".params input").forEach(function (inp) {
          inp.value = st.params[inp.dataset.param] || "";
        });
      }
      if (st.skip) state.skips[st.id] = true;
      else delete state.skips[st.id];
    });
    save();
    updateAll();
  }
  function loadScenarios() {
    fetch(appRoot + "/docs/_scenarios", { headers: { "accept": "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (v) {
        if (v && Array.isArray(v.scenarios)) { SCENARIOS = v.scenarios; renderScenarios(); }
      })
      .catch(function () { /* unavailable (remote caller) — the card just stays empty */ });
  }
  function saveScenario(name) {
    var steps = EPS.map(function (ep) {
      var st = { id: ep.id };
      if (hasBody(ep)) st.body = bodyText(ep);
      var pv = state.paramVals[ep.id];
      if (pv && Object.keys(pv).length) st.params = Object.assign({}, pv);
      if (state.skips[ep.id]) st.skip = true;
      return st;
    });
    var payload = { v: 1, name: name, module: MODULE, flow: activeFlow() || undefined, steps: steps };
    fetch(appRoot + "/docs/_scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (v) { return { res: res, v: v }; }, function () { return { res: res, v: {} }; });
    }).then(function (r) {
      if (!r.res.ok) {
        banner("err", "Scenario save failed — " + esc(r.v && r.v.error ? r.v.error : "HTTP " + r.res.status) + ".");
        return;
      }
      banner("ok", "Scenario \"" + esc(name) + "\" saved to fixtures/scenarios/.");
      loadScenarios();
    }).catch(function (err) {
      banner("err", "Scenario save failed — " + esc(err && err.message ? err.message : String(err)) + ".");
    });
  }

  function refreshRequests() {
    EPS.forEach(function (ep) { renderRequest(ep); });
  }
  function refreshDerived() {
    refreshRequests();
    renderVars();
    renderInputs();
    renderSetup();
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
  // override (a setup step's snapshot: { body, params }) replaces the live editor body/params for
  // this one send — so a setup call fires its frozen request, not whatever the panel shows now.
  function send(ep, fromRunAll, override) {
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
      // A manual run opens the box to show the problem inline; a run-all leaves boxes collapsed
      // (the walk scrolls the stopped step into view and the banner names the reason).
      if (!fromRunAll) toggleExpand(ep, true);
      renderRequest(ep);
      if (!fromRunAll) banner("err", "Cannot send " + esc(stepLabel(ep)) + " — " + esc(reason) + ".");
      return Promise.resolve({ blocked: reason });
    }
    var missing = [];
    var init = { method: ep.method, headers: {} };
    if (hasBody(ep)) {
      var r = resolveBody(ep, override && override.body);
      if (r.error) return blocked("its request body is " + r.error);
      missing = r.missing.slice();
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(r.value);
    }
    var url = urlFor(ep, missing, override && override.params);
    if (missing.length) {
      var who = missing.map(function (m) { return "{{" + m + "}}"; }).join(", ");
      // record the failure shape so the heal rules can diagnose it
      state.meta[ep.id] = { http: 0, ms: 0, body: "unresolved: " + who, missing: missing.slice() };
      state.status[ep.id] = "fail";
      save();
      updateAll();
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
        // Keep the previous response so the diff can show what this run changed.
        if (state.meta[ep.id] && state.meta[ep.id].body !== undefined) {
          state.prev[ep.id] = { http: state.meta[ep.id].http, body: state.meta[ep.id].body };
        }
        var assertResults = evalAsserts(ep, res.status, parsed);
        var pass = res.ok && (!assertResults || assertResults.every(function (a) { return a.pass; }));
        state.meta[ep.id] = { http: res.status, ms: Math.round(performance.now() - t0), body: parsed, asserts: assertResults || undefined };
        if (res.ok && parsed !== null && typeof parsed === "object") {
          // Capture on HTTP success even when an expectation failed — the data came back and is
          // useful for diagnosing; dependents stay gated on the fail status regardless.
          state.captured[ep.id] = parsed;
          // Publish to the shared scope so other modules' pages can reference it as
          // {{module:endpoint.field}}.
          globals.captured[MODULE + ":" + ep.id] = parsed;
          saveGlobals();
        }
        state.status[ep.id] = pass ? "ok" : "fail";
        save();
        updateAll();
        return { ok: pass };
      });
    }).catch(function (err) {
      state.meta[ep.id] = { http: 0, ms: Math.round(performance.now() - t0), body: "ERROR " + (err && err.message ? err.message : String(err)) };
      state.status[ep.id] = "fail";
      save();
      updateAll();
      return { ok: false };
    });
  }

  // ── module setup: pre-run calls that put the WHOLE APP in a known state ─────
  // A step targeting this module fires through send() (main row updates as usual). A step
  // targeting another module fires directly and writes its result into THAT module's session +
  // the shared capture scope (same write-back shape as the system map's Run all), so every page
  // agrees on what happened.
  function writeForeignResult(module, id, st, meta) {
    var key = "keep:emulator:" + pathPrefix + "/docs/" + module;
    var session = null;
    try {
      var parsed = JSON.parse(localStorage.getItem(key));
      if (parsed && parsed.v === 1) session = parsed;
    } catch (e) { /* corrupted session is replaced */ }
    if (!session) session = freshState();
    ["status", "captured", "meta"].forEach(function (k) { if (!session[k]) session[k] = {}; });
    session.status[id] = st;
    session.meta[id] = meta;
    if (st === "ok" && meta.body !== null && typeof meta.body === "object") {
      session.captured[id] = meta.body;
      globals.captured[module + ":" + id] = meta.body;
      saveGlobals();
    }
    session.savedAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(session)); } catch (e) { /* storage full */ }
  }
  function sendForeign(s, ae) {
    var missing = [];
    var init = { method: ae.method, headers: {} };
    if (ae.method !== "GET" && s.body !== undefined) {
      var parsed;
      try { parsed = JSON.parse(s.body); }
      catch (e) { return Promise.resolve({ ok: false, why: "its request body is invalid JSON — " + e.message }); }
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(resolveValue(parsed, missing));
    }
    var p = ae.path;
    var query = [];
    (ae.params || []).forEach(function (prm) {
      var v = resolveString((s.params || {})[prm.name] || "", missing);
      if (prm.in === "path") {
        var enc = encodeURIComponent(String(v));
        p = p.split("{" + prm.name + "}").join(enc);
        var colonRe = new RegExp(":" + prm.name.replace(/[^\w]/g, "\\$&") + "(?!\\w)", "g");
        p = p.replace(colonRe, function () { return enc; });
      } else if (v !== "" && v !== null && v !== undefined) {
        query.push(encodeURIComponent(prm.name) + "=" + encodeURIComponent(String(v)));
      }
    });
    if (missing.length) {
      return Promise.resolve({
        ok: false,
        why: missing.map(function (m) { return "{{" + m + "}}"; }).join(", ") + " cannot be resolved yet",
      });
    }
    var t = token();
    if (t) init.headers["authorization"] = "Bearer " + t;
    var t0 = performance.now();
    return fetch(appRoot + p + (query.length ? "?" + query.join("&") : ""), init).then(function (res) {
      return res.text().then(function (text) {
        var body;
        try { body = JSON.parse(text); } catch (e) { body = text; }
        writeForeignResult(ae.module, ae.id, res.ok ? "ok" : "fail", {
          http: res.status,
          ms: Math.round(performance.now() - t0),
          body: body,
        });
        return { ok: res.ok, why: res.ok ? "" : "HTTP " + res.status };
      });
    }).catch(function (err) {
      return { ok: false, why: err && err.message ? err.message : String(err) };
    });
  }
  // Run ONE setup step wherever it lives. -> Promise<{ ok, why? }>.
  function runSetupStep(s) {
    var ae = setupEndpointFor(s);
    if (!ae) return Promise.resolve({ ok: true, skipped: true });   // stale step — never blocks
    if (s.module && s.module !== MODULE) return sendForeign(s, ae);
    ensureRowVisible(ae);
    return send(ae, true, { body: s.body, params: s.params }).then(function (r) {
      if (r.ok) return { ok: true };
      var meta = state.meta[ae.id];
      return {
        ok: false,
        why: r.blocked ? r.blocked : (meta && meta.http ? "HTTP " + meta.http : "network error"),
      };
    });
  }
  // Walk the setup steps in order, stopping at the first failure. cb({ ok }) when done.
  // Callers own the runningAll lock and the final banner.
  function runSetupSteps(cb) {
    var steps = (state.setup || []).slice();
    var j = 0;
    function next() {
      if (j >= steps.length) return cb({ ok: true });
      var idx = j;
      var s = steps[j++];
      if (!setupEndpointFor(s)) return next();
      setupRun[idx] = "run";
      renderSetup();
      return runSetupStep(s).then(function (r) {
        setupRun[idx] = r.ok ? "ok" : "fail";
        renderSetup();
        if (r.ok) return next();
        banner("err", "Stopped in setup — " + esc(setupLabel(s)) + " — " + esc(r.why) + ".");
        return cb({ ok: false });
      });
    }
    next();
  }
  // "Run setup" on its own — establish state without walking the process.
  function runSetupOnly() {
    if (runningAll || !(state.setup || []).length) return;
    runningAll = true;
    banner(null);
    updateAll();
    runSetupSteps(function (sr) {
      runningAll = false;
      updateAll();
      if (sr.ok) banner("ok", "Setup complete — " + state.setup.length + " step(s) ran.");
    });
  }

  var runningAll = false;
  function runAll(fromId) {
    if (fromId && typeof fromId !== "string") fromId = null;   // header click passes the event
    if (runningAll) return;
    // Skipped steps are excluded from the walk entirely — their state stays
    // exactly where you parked it.
    var walkList = activeEPS().filter(function (ep) { return !state.skips[ep.id]; });
    // "Run from here": clear this and every later step in the walk, then the
    // normal resume-from-first-non-green logic starts at exactly that step.
    if (fromId) {
      var fromIdx = walkList.findIndex(function (ep) { return ep.id === fromId; });
      if (fromIdx < 0) return;
      walkList.slice(fromIdx).forEach(function (ep) { delete state.status[ep.id]; });
      save();
    }
    // A partial chain resumes from the first non-green step; a fully green chain re-runs from the
    // top. To re-run we only clear the ACTIVE flow's statuses (so step() doesn't skip every step
    // as already-ok) — captured outputs and response metas are kept and each step's send()
    // overwrites its own as it re-passes, so a failed re-run never destroys previous results.
    if (!fromId && allStepsGreen()) {
      walkList.forEach(function (ep) { delete state.status[ep.id]; });
      save();
    }
    runningAll = true;
    banner(null);
    updateAll();
    var list = walkList;
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
        ensureRowVisible(ep);
        return done();
      }
      // Follow the walk: bring the step about to run into view (collapsed — not expanded).
      ensureRowVisible(ep);
      return send(ep, true).then(function (result) {
        if (result.ok || ep.optional) {
          if (!result.ok) optionalFailed.push(ep.id);
          return step();   // optional steps report but never stop the walk
        }
        if (result.blocked) {
          banner("err", "Stopped at " + esc(stepLabel(ep)) + " — " + esc(result.blocked) + ".");
        } else {
          var meta = state.meta[ep.id];
          var af = firstAssertFailure(meta);
          banner("err", "Stopped at " + esc(stepLabel(ep)) + " — " +
            (af
              ? "expectation failed: " + esc(af.desc) + " (got " + esc(af.got === undefined ? "(missing)" : af.got) + ")"
              : esc(meta && meta.http ? "HTTP " + meta.http : "network error")) +
            ". Fix it and press <b>Run all in order</b> to resume from here.");
        }
        // Bring the failed step into view but leave it collapsed — open it yourself to inspect.
        ensureRowVisible(ep);
        return done();
      });
    }
    // Setup first — establish system state — then walk the process. Empty setup is a no-op.
    runSetupSteps(function (sr) {
      if (!sr.ok) return done();   // setup stopped the run; its banner already explains why
      step();
    });
  }

  // ── header actions ─────────────────────────────────────────────────────────
  document.getElementById("runall").addEventListener("click", runAll);
  var runSetupBtn = document.getElementById("run-setup");
  if (runSetupBtn) runSetupBtn.addEventListener("click", runSetupOnly);
  var saveFixturesBtn = document.getElementById("save-fixtures");
  if (saveFixturesBtn) saveFixturesBtn.addEventListener("click", saveFixtures);
  var scenForm = document.getElementById("save-scenario");
  if (scenForm) {
    scenForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = e.target.elements.scenname.value.trim();
      if (!name) return;
      saveScenario(name);
      e.target.reset();
    });
  }
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
  // Flows exist and no explicit choice yet → default to the untagged-only
  // walk; teardown-style branches are opt-in, never part of the default run.
  if (FLOWS.length && state.flow === undefined) state.flow = "__main";
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
  populateSetupPicker();
  // Pull the saved artifact (fixtures/cake.json) and apply its setup + persisted variables, the
  // project heal rules, and the saved scenarios. Async, localhost-only; remote fetches no-op.
  loadFixtures();
  loadHealRules();
  loadScenarios();
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
