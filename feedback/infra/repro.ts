// Self-contained repro for three rune 3.0.0 codegen issues found while adding
// a noun to an EXISTING green module (infra's access module, 2026-07-01).
//
//   BUG 1  — generated coordinator drops the leading scalar arg on multi-arg
//            kv WRITE seams (`kv:widget.set(widgetId, WidgetDto)` → the call
//            site passes only the DTO), while the SAME sync generates the
//            adapter with the correct 2-arg signature. Tree fails deno check.
//   BUG 2  — incremental sync: when a spec GROWS a new `log:audit.*` step and
//            the audit adapter already exists (create-once), sync generates a
//            coordinator that CALLS the new method but neither appends a stub
//            to the create-once file nor prints any warning. Tree fails check.
//   BUG 3  — for allow/attach-shaped recipes, the mid-recipe kv MUTATION is
//            emitted inside the "reads" block, BEFORE the position where
//            authority/cross-app guards belong — a naive fill lands an
//            escalating write before the 403. (Security-relevant; matches the
//            hand-fixed `token-mint` "DRIFT FIX" and the guard-reorder the
//            role-allow/role-deny fill had to do by hand.)
//
// Usage:  deno run -A repro.ts
// Exit 0 = all three fixed. Exit 1 = at least one still reproduces.
// Requires: `rune` on PATH (3.x), deno. Writes only to a temp directory.

const td = new TextDecoder();

function run(
  cmd: string[],
  cwd: string,
): { code: number; out: string } {
  const r = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  return { code: r.code, out: td.decode(r.stdout) + td.decode(r.stderr) };
}

const tmp = Deno.makeTempDirSync({ prefix: "rune-repro-" });
console.log(`[setup] temp project root: ${tmp}`);

// ── 1. fresh project ─────────────────────────────────────────────────────────
const init = run(["rune", "init", "proj"], tmp);
console.log(`[setup] rune init → exit ${init.code}`);
if (init.code !== 0) {
  console.log(init.out);
  console.log("cannot scaffold a fresh project — aborting");
  Deno.exit(2);
}
const proj = `${tmp}/proj`;
console.log(`[setup] scaffolded tree:`);
console.log(run(["find", ".", "-maxdepth", "3", "-not", "-path", "*/.git*"], proj).out);

// [SRV] declarations mirror infra's core.rune so `kv:`/`log:` steps resolve.
Deno.mkdirSync(`${proj}/src/core`, { recursive: true });
Deno.writeTextFileSync(
  `${proj}/src/core/core.rune`,
  `[MOD] core

[SRV] (SIDECAR)kv: KV_PATH
    deno kv, the datastore for every record
    @docs https://docs.deno.com/deploy/kv/manual
[SRV] (SIDECAR)log: AUDIT_LOG
    append-only audit log of every mutating request
    @docs https://docs.deno.com/deploy/kv/manual
`,
);
// Sync core first so the shared kv/log service clients exist — keeps the final
// deno check output free of environmental TS2307s; only the real drift remains.
const syncCore = run(["rune", "sync", "src/core/core.rune"], proj);
console.log(`[setup] rune sync core → exit ${syncCore.code}`);

// ── 2. phase-1 spec: ONE noun, ONE audit event ───────────────────────────────
// widget.define mirrors infra's role.define — the exact BUG 1 shape:
// a pure core mints the id + dto, then `kv:widget.set(widgetId, WidgetDto)`.
const SPEC_V1 = `[MOD] widgets

[REQ] widget.define(DefineWidgetDto): WidgetDto
    widget::newId(): widgetId
    widget::build(DefineWidgetDto, widgetId): WidgetDto
    kv:widget.set(widgetId, WidgetDto): void
      timeout
    log:audit.widgetDefined(WidgetDto): void
    [RET] WidgetDto


[ENT] widgets.widgetDefine(DefineWidgetDto): WidgetDto


[TYP] widgetId: string
    unique identifier of a widget
[TYP:example=gizmo] name: string
    human-facing name of the widget
[TYP] createdAt: string
    ISO 8601 timestamp when the record was created
[TYP] updatedAt: string
    ISO 8601 timestamp when the record was last updated

[DTO] WidgetDto: widgetId, name, createdAt, updatedAt
    a stored widget record
[DTO] DefineWidgetDto: name
    input to define a new widget

[NON] widget
    builds and persists widget records
[NON] audit
    writes audit-log entries for mutating requests
`;

Deno.mkdirSync(`${proj}/src/widgets`, { recursive: true });
Deno.writeTextFileSync(`${proj}/src/widgets/widgets.rune`, SPEC_V1);

const check1 = run(["rune", "check", "src/widgets/widgets.rune"], proj);
console.log(`[phase 1] rune check → exit ${check1.code}`);
if (check1.code !== 0) {
  console.log(check1.out);
  console.log("phase-1 spec is not check-clean — aborting (repro authoring bug)");
  Deno.exit(2);
}

const sync1 = run(["rune", "sync", "src/widgets/widgets.rune"], proj);
console.log(`[phase 1] rune sync → exit ${sync1.code}`);
if (sync1.code !== 0) {
  console.log(sync1.out);
  Deno.exit(2);
}

// ── 3. phase-2 spec: GROW the module (new REQ + NEW audit event) ─────────────
// widget.attach mirrors infra's role.allow — the exact BUG 3 shape (reads,
// then a mid-recipe kv mutation) and, because audit/mod.ts now already exists
// from phase 1 (create-once), the exact BUG 2 shape (a NEW audit method).
const SPEC_V2 = SPEC_V1.replace(
  `[ENT] widgets.widgetDefine(DefineWidgetDto): WidgetDto`,
  `[REQ] widget.attach(WidgetPartDto): WidgetDto
    kv:widget.get(widgetId): WidgetDto
      not-found
    kv:part.get(partId): PartDto
      not-found
    kv:widget.addPart(widgetId, partId): WidgetDto
      timeout
    log:audit.widgetPartAttached(WidgetDto): void
    [RET] WidgetDto


[ENT] widgets.widgetDefine(DefineWidgetDto): WidgetDto
[ENT] widgets.widgetAttach(WidgetPartDto): WidgetDto`,
).replace(
  `[TYP] widgetId: string`,
  `[TYP] partId: string
    unique identifier of a widget part
[TYP] widgetId: string`,
).replace(
  `[DTO] DefineWidgetDto: name`,
  `[DTO] PartDto: partId, name
    a stored widget part record
[DTO] WidgetPartDto: widgetId, partId
    input attaching a part to a widget
[DTO] DefineWidgetDto: name`,
).replace(
  `[NON] widget
    builds and persists widget records`,
  `[NON] widget
    builds and persists widget records
[NON] part
    read-only access to stored parts`,
);

Deno.writeTextFileSync(`${proj}/src/widgets/widgets.rune`, SPEC_V2);

const check2 = run(["rune", "check", "src/widgets/widgets.rune"], proj);
console.log(`[phase 2] rune check → exit ${check2.code}`);
if (check2.code !== 0) {
  console.log(check2.out);
  Deno.exit(2);
}

const sync2 = run(["rune", "sync", "src/widgets/widgets.rune"], proj);
console.log(`[phase 2] rune sync (incremental growth) → exit ${sync2.code}`);
console.log("──── sync #2 output (verbatim) ────");
console.log(sync2.out.trim());
console.log("───────────────────────────────────");

// ── 4. type-check the generated tree ─────────────────────────────────────────
const check = run(["deno", "check"], proj);
console.log(`\n[verify] deno check → exit ${check.code}`);

// ── 5. verdicts ───────────────────────────────────────────────────────────────
const defineMod = Deno.readTextFileSync(
  `${proj}/src/widgets/domain/coordinators/widget-define/mod.ts`,
);
const attachMod = Deno.readTextFileSync(
  `${proj}/src/widgets/domain/coordinators/widget-attach/mod.ts`,
);
const auditMod = Deno.readTextFileSync(
  `${proj}/src/widgets/domain/data/audit/mod.ts`,
);
const widgetData = Deno.readTextFileSync(
  `${proj}/src/widgets/domain/data/widget/mod.ts`,
);

// BUG 1 — adapter takes (widgetId, widgetDto) but the coordinator call site
// passes a single argument.
const adapterTwoArg = /set\s*\(\s*widgetId\s*:\s*string\s*,/.test(widgetData);
const callSite = defineMod.match(/widgetData\.set\(([^;]*)\);/s)?.[1] ?? "";
const callOneArg = callSite.length > 0 && !callSite.includes(",") ||
  // an assert(...) wrapper is one argument even though it contains commas —
  // detect "no second top-level argument" by checking it does not reference
  // the minted id seam alongside the dto.
  (callSite.startsWith("assert(") && !/^\s*out\./.test(callSite) &&
    !callSite.match(/\)\s*,/));
const bug1 = adapterTwoArg && callOneArg;
console.log(`\nBUG 1 (dropped leading scalar on multi-arg write seam): ${
  bug1 ? "REPRODUCED" : "not reproduced (fixed?)"
}`);
console.log(`  adapter signature two-arg: ${adapterTwoArg}`);
console.log(`  generated call site      : widgetData.set(${callSite.trim()})`);

// BUG 2 — coordinator calls audit.widgetPartAttached but the create-once audit
// adapter (from phase 1) was not extended, and sync #2 printed no warning.
const coordCallsNewAudit = attachMod.includes("widgetPartAttached");
const auditHasNewMethod = auditMod.includes("widgetPartAttached");
const syncWarned = /widgetPartAttached|audit/.test(
  sync2.out.replace(/updated deno\.json[^\n]*/g, ""),
);
const bug2 = coordCallsNewAudit && !auditHasNewMethod && !syncWarned;
console.log(`\nBUG 2 (silent create-once drift on incremental growth): ${
  bug2 ? "REPRODUCED" : "not reproduced (fixed?)"
}`);
console.log(`  coordinator calls audit.widgetPartAttached : ${coordCallsNewAudit}`);
console.log(`  create-once audit adapter has the method   : ${auditHasNewMethod}`);
console.log(`  sync #2 warned about the missing method    : ${syncWarned}`);

// BUG 3 — the kv mutation (addPart) is emitted in the reads block, before the
// pure core (the position where guards belong is between the reads and the
// mutation; the generated shell leaves no such position).
const addPartIdx = attachMod.indexOf(".addPart(");
const coreIdx = attachMod.search(/\/\/ core\b/);
const bug3 = addPartIdx !== -1 && coreIdx !== -1 && addPartIdx < coreIdx;
console.log(`\nBUG 3 (mid-recipe kv mutation emitted in the reads block): ${
  bug3 ? "REPRODUCED" : "not reproduced (fixed?)"
}`);
console.log(
  `  .addPart( at offset ${addPartIdx}, "// core" marker at offset ${coreIdx}` +
    ` → mutation ${addPartIdx < coreIdx ? "PRECEDES" : "follows"} the core/guard position`,
);

// deno check corroboration (bugs 1+2 are type errors by construction)
if (check.code !== 0) {
  const lines = check.out.split("\n").filter((l) =>
    /error|TS\d+|Expected \d+ arguments|does not exist/.test(l)
  ).slice(0, 12);
  console.log(`\n[verify] deno check errors (corroborating bugs 1+2):`);
  for (const l of lines) console.log(`  ${l}`);
} else {
  console.log(`\n[verify] deno check is CLEAN — generated tree type-checks.`);
}

const reproduced = [bug1, bug2, bug3].filter(Boolean).length;
console.log(
  `\n=== ${reproduced}/3 issues reproduce (rune ${
    run(["rune", "--version"], tmp).out.split("\n")[0].trim()
  }) ===`,
);
Deno.exit(reproduced > 0 ? 1 : 0);
