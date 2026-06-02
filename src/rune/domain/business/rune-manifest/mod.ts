// Rune manifest: walk a parsed rune AST, compute files to scaffold, render
// templates, return a plan. Idempotent — never produces a plan entry for a path
// that already exists in the project file set.

import {
  type CseNode,
  type DtoNode,
  type EntNode,
  parse,
  type PlyNode,
  type ReqNode,
  type StepLike,
  type TypNode,
} from "@rune/domain/business/rune-parse/mod.ts";
import {
  applyCase,
  type Binding,
  bindings,
  moduleFromSpecPath,
  processName,
  transformName,
} from "@rune/domain/business/rune-bindings/mod.ts";
import {
  collectNounMethods,
  type MethodSig,
  renderImpl,
  renderParams,
  renderSig,
  toPascal,
} from "@rune/domain/business/rune-sig/mod.ts";
import type { Artifact } from "@rune/domain/business/artifact/mod.ts";

export interface FilePlan {
  path: string;
  content: string;
}

export interface ManifestPlan {
  module: string;
  rune: string;
  toCreate: FilePlan[];
  // Spec-owned files (sig.ts) rewritten on every run, even if they already exist.
  toRegenerate: FilePlan[];
  toSkip: string[];
  errors: string[];
}

/** How a generated file behaves across re-runs. */
export type Lifecycle =
  | "regenerate" // spec-owned: rewritten in full every run (the contract, e.g. sig.ts)
  | "create-once"; // dev-owned: written once, then never overwritten (your bodies)

/** Per-role policy. `role` keys are template names (DEFAULT_TEMPLATES) plus the
 * two signature roles "business-sig"/"adapter-sig". Registry-driven (WO-8) so the
 * regenerate-vs-protect-vs-prune behaviour is describable in the Studio, not
 * hard-coded here. */
export interface TemplatePolicy {
  lifecycle?: Lifecycle;
  /** Whether `sync --prune` may delete this role's slot when the spec drops it. */
  prunable?: boolean;
}

/** Optional artifact-driven overrides (WO-4a/4b). When omitted, the engine's
 * static defaults apply — so existing callers and the L3 goldens are unchanged. */
export interface ManifestOptions {
  /** Layout bindings (placeholder -> rune element), e.g. from artifact.bindings. */
  bindings?: Record<string, Binding>;
  /** Codegen body templates keyed by name (see DEFAULT_TEMPLATES), e.g. from
   * artifact.codegen.templates. Merged over the defaults, so a partial map only
   * overrides the keys it provides. */
  codegen?: Record<string, string>;
  /** Per-role lifecycle/prune policy, e.g. from artifact.codegen.policies.
   * Merged over DEFAULT_POLICIES; defaults preserve current behavior. */
  policies?: Record<string, TemplatePolicy>;
}

/** Map a loaded artifact to the engine's options: layout bindings, codegen
 * templates, and per-role lifecycle/prune policies. Lets the CLI (manifest/sync)
 * drive generation from an edited keywords.json — the same artifact the Studio
 * edits — instead of the static engine defaults. */
export function artifactToOptions(artifact: Artifact): ManifestOptions {
  return {
    bindings: artifact.bindings as ManifestOptions["bindings"],
    codegen: artifact.codegen?.templates,
    policies: artifact.codegen?.policies as ManifestOptions["policies"],
  };
}

/** A file the spec no longer declares, classified by who owns it. `spec`-owned
 * files (regenerated contracts) are safe to prune; `dev`-owned files hold
 * hand-written bodies and need an explicit --force. */
export interface DeletePlan {
  path: string;
  owned: "spec" | "dev";
}

// Plan a manifest run. Pure: no I/O. The caller decides whether to actually write.
export function planManifest(
  runePath: string,
  runeText: string,
  existingFiles: Set<string>,
  opts: ManifestOptions = {},
): ManifestPlan {
  // The DTO file-name slot is resolved from the artifact when supplied; falling
  // back to the engine's static binding keeps generated output byte-identical
  // (L3 holds) until a caller deliberately mutates the artifact (L6).
  const nameBinding = opts.bindings?.["<name>"] ?? bindings["<name>"];
  // Codegen templates come from the artifact when supplied, else the engine
  // defaults — merged so a partial override only changes the keys it names.
  // Set on a module-level slot read by the (synchronous) render helpers below.
  activeTemplates = opts.codegen
    ? { ...DEFAULT_TEMPLATES, ...opts.codegen }
    : DEFAULT_TEMPLATES;
  // Per-role policy: registry overrides merged over the engine defaults. Set on a
  // module-level slot so the (synchronous) adders + resolvePolicy() can read it.
  activePolicies = opts.policies ?? null;
  const ast = parse(runeText);
  const module = ast.module ?? moduleFromSpecPath(runePath);
  const errors: string[] = ast.errors.map((e) =>
    `${runePath}:${e.line + 1}: ${e.message}`
  );
  const plan: ManifestPlan = {
    module: module ?? "",
    rune: runePath,
    toCreate: [],
    toRegenerate: [],
    toSkip: [],
    errors,
  };
  if (!module) {
    plan.errors.push(
      `${runePath}: no [MOD] directive and could not derive module name`,
    );
    return plan;
  }

  const wantedFiles = new Map<string, string>(); // create-if-absent (lifecycle: create-once)
  const regenFiles = new Map<string, string>(); // spec-owned, always (re)written (lifecycle: regenerate)
  const emitted = new Set<string>(); // first writer wins — replaces the per-adder de-dupe guards
  const nounMethods = collectNounMethods(ast);

  // Route an emitted file into create-once vs regenerate by its role's policy.
  const emit: Emit = (role, path, content) => {
    if (emitted.has(path)) return;
    emitted.add(path);
    if (resolvePolicy(role).lifecycle === "regenerate") {
      regenFiles.set(path, content);
    } else wantedFiles.set(path, content);
  };

  // All faults declared on each noun's boundary steps, so one data adapter's
  // smk.test covers every boundary fault (not just the first step's).
  const boundaryFaults = collectBoundaryFaults(ast);

  // Collect intended files by element type.
  const polyNouns = new Set<string>();
  for (const req of ast.reqs) {
    addCoordinator(emit, module, req, runePath, nameBinding);
    walkStepsForFiles(
      req.steps,
      module,
      emit,
      nounMethods,
      polyNouns,
      runePath,
      boundaryFaults,
    );
  }
  for (const dto of ast.dtos) addDto(emit, module, dto, runePath, nameBinding);
  for (const typ of ast.typs) addTyp(emit, module, typ, runePath);
  for (const ent of ast.ents) addEntrypoint(emit, module, ent, runePath);
  if (ast.reqs.length > 0) addModRoot(emit, module, ast.reqs, runePath);

  // Split into toCreate / toSkip based on existence; regenerate-lifecycle files always (re)write.
  for (const [path, content] of wantedFiles) {
    if (existingFiles.has(path)) plan.toSkip.push(path);
    else plan.toCreate.push({ path, content });
  }
  for (const [path, content] of regenFiles) {
    plan.toRegenerate.push({ path, content });
  }
  // Stable ordering for output.
  plan.toCreate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toRegenerate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toSkip.sort();

  return plan;
}

// ---- step traversal ----

/** Emit a generated file under its role's lifecycle policy. First writer per
 * path wins (replaces the old per-adder `out.has(...)` de-dupe guards). */
type Emit = (role: string, path: string, content: string) => void;

function walkStepsForFiles(
  steps: StepLike[] | CseNode["steps"],
  module: string,
  emit: Emit,
  nounMethods: Map<string, MethodSig[]>,
  polyNouns: Set<string>,
  runePath: string,
  boundaryFaults: Map<string, string[]>,
): void {
  for (const step of steps) {
    if (step.kind === "step") {
      // Untagged step → business feature (unless the noun is also a [PLY]).
      if (!polyNouns.has(step.noun)) {
        addBusinessFeature(
          emit,
          module,
          step.noun,
          nounMethods.get(step.noun) ?? [],
          runePath,
        );
      }
    } else if (step.kind === "boundary") {
      addAdapter(
        emit,
        module,
        step,
        nounMethods.get(step.noun) ?? [],
        runePath,
        boundaryFaults.get(step.noun) ?? step.faults,
      );
    } else if (step.kind === "ply") {
      polyNouns.add(step.noun);
      addPolyFeature(emit, module, step, runePath);
      for (const cse of step.cases) {
        walkStepsForFiles(
          cse.steps,
          module,
          emit,
          nounMethods,
          polyNouns,
          runePath,
          boundaryFaults,
        );
      }
    }
  }
}

// ---- per-element adders ----

function addCoordinator(
  emit: Emit,
  module: string,
  req: ReqNode,
  runePath: string,
  nameBinding: Binding,
): void {
  const dir = `src/${module}/domain/coordinators/${
    processName(req.noun, req.verb)
  }`;
  // Scaffold imports for the input/output DTOs so the stub type-checks out of the
  // box; a [REQ] whose input/output isn't a DTO contributes none.
  const imports = dtoImports([req.input, req.output], nameBinding);
  emit(
    "coordinator-mod",
    `${dir}/mod.ts`,
    render(tpl("coordinator-mod"), { req, module, runePath, imports }),
  );
  emit(
    "coordinator-int-test",
    `${dir}/int.test.ts`,
    render(tpl("coordinator-int-test"), {
      req,
      runePath,
      faults: collectAllFaults(req),
    }),
  );
}

function addBusinessFeature(
  emit: Emit,
  module: string,
  noun: string,
  methods: MethodSig[],
  runePath: string,
): void {
  const kebab = applyCase(noun, "kebab");
  const dir = `src/${module}/domain/business/${kebab}`;
  emit("business-sig", `${dir}/sig.ts`, renderSig(noun, methods));
  emit("business-impl", `${dir}/mod.ts`, renderImpl(noun, methods));
  emit(
    "business-test",
    `${dir}/test.ts`,
    render(tpl("business-test"), { noun: toPascal(noun), runePath }),
  );
}

function addPolyFeature(
  emit: Emit,
  module: string,
  ply: PlyNode,
  runePath: string,
): void {
  const noun = applyCase(ply.noun, "kebab");
  const dir = `src/${module}/domain/business/${noun}`;
  // Render the poly signature the same way the sig/impl split does: PascalCase
  // class identifiers, params typed `name: unknown`, and an `unknown` return —
  // so the generated base + variants type-check (method presence is the contract;
  // DTO parity is enforced separately). Templates read these off `ply` unchanged.
  const typedPly = {
    ...ply,
    noun: toPascal(ply.noun),
    params: renderParams(ply.params),
    output: "unknown",
  };
  emit(
    "poly-base-mod",
    `${dir}/base/mod.ts`,
    render(tpl("poly-base-mod"), { ply: typedPly, runePath }),
  );
  emit(
    "poly-base-test",
    `${dir}/base/test.ts`,
    render(tpl("poly-base-test"), { ply: typedPly, runePath }),
  );
  const firstVariant = ply.cases[0]?.name ?? "";
  emit(
    "poly-mod",
    `${dir}/poly-mod.ts`,
    render(tpl("poly-mod"), {
      ply: typedPly,
      runePath,
      firstVariant: applyCase(firstVariant, "kebab"),
    }),
  );
  // @-aliased import from a variant up to its base — variants live two levels
  // below `dir` (implementations/<variant>/), so a relative import would be
  // "../../base/…" which the import-aliases rule forbids.
  const baseImport = `@/${dir}/base/mod.ts`;
  for (const cse of ply.cases) {
    const caseDir = `${dir}/implementations/${applyCase(cse.name, "kebab")}`;
    const typedCse = { ...cse, name: toPascal(cse.name) };
    emit(
      "poly-impl-mod",
      `${caseDir}/mod.ts`,
      render(tpl("poly-impl-mod"), {
        ply: typedPly,
        cse: typedCse,
        runePath,
        baseImport,
      }),
    );
    emit(
      "poly-impl-test",
      `${caseDir}/test.ts`,
      render(tpl("poly-impl-test"), { ply: typedPly, cse: typedCse, runePath }),
    );
  }
}

function addAdapter(
  emit: Emit,
  module: string,
  step: { tag: string; noun: string; faults: string[]; line: number },
  methods: MethodSig[],
  runePath: string,
  faults: string[],
): void {
  const kebab = applyCase(step.noun, "kebab");
  const dir = `src/${module}/domain/data/${kebab}`;
  emit("adapter-sig", `${dir}/sig.ts`, renderSig(step.noun, methods));
  emit("adapter-impl", `${dir}/mod.ts`, renderImpl(step.noun, methods));
  // Cover every fault declared on ANY boundary step for this noun, not just the
  // first one — one adapter serves all of the noun's boundary calls, and
  // rune-fault-coverage expects a test for each declared fault.
  emit(
    "adapter-smk-test",
    `${dir}/smk.test.ts`,
    render(tpl("adapter-smk-test"), { step, runePath, faults }),
  );
}

function addDto(
  emit: Emit,
  module: string,
  dto: DtoNode,
  runePath: string,
  nameBinding: Binding,
): void {
  const fileName = transformName(dto.name, nameBinding);
  const dir = dto.isCore ? "src/core/dto" : `src/${module}/dto`;
  emit("dto", `${dir}/${fileName}.ts`, render(tpl("dto"), { dto, runePath }));
}

function addTyp(
  emit: Emit,
  module: string,
  typ: TypNode,
  runePath: string,
): void {
  const fileName = applyCase(typ.name, "kebab");
  const dir = typ.isCore ? "src/core/dto" : `src/${module}/dto`;
  // A [DTO] may have already produced this path; emit() keeps the first writer.
  emit("typ", `${dir}/${fileName}.ts`, render(tpl("typ"), { typ, runePath }));
}

function addEntrypoint(
  emit: Emit,
  module: string,
  ent: EntNode,
  runePath: string,
): void {
  const surface = applyCase(ent.surface, "kebab");
  const dir = `src/${module}/entrypoints/${surface}`;
  emit(
    "entrypoint-mod",
    `${dir}/mod.ts`,
    render(tpl("entrypoint-mod"), { ent, runePath }),
  );
  emit(
    "entrypoint-e2e",
    `${dir}/e2e.test.ts`,
    render(tpl("entrypoint-e2e"), { ent, runePath }),
  );
}

function addModRoot(
  emit: Emit,
  module: string,
  reqs: ReqNode[],
  runePath: string,
): void {
  emit(
    "mod-root",
    `src/${module}/mod-root.ts`,
    render(tpl("mod-root"), {
      reqs: reqs.map((r) => ({
        verb: r.verb,
        processFile: processName(r.noun, r.verb),
      })),
      module,
      runePath,
    }),
  );
}

/** Dedup'd `{ type, file }` import descriptors for the DTO-typed names, each
 * file resolved via the same <name> binding the dto/ files use. */
function dtoImports(
  names: (string | undefined)[],
  nameBinding: Binding,
): { type: string; file: string }[] {
  const seen = new Set<string>();
  const out: { type: string; file: string }[] = [];
  for (const name of names) {
    if (!name || !/Dto$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ type: name, file: transformName(name, nameBinding) });
  }
  return out;
}

/** Map each noun to the union of faults on all its boundary steps (across every
 * [REQ] and [CSE]), in first-seen order. One data adapter serves all of a noun's
 * boundary calls, so its smk.test must cover all their faults. */
function collectBoundaryFaults(
  ast: ReturnType<typeof parse>,
): Map<string, string[]> {
  const byNoun = new Map<string, string[]>();
  const walk = (steps: StepLike[] | CseNode["steps"]) => {
    for (const step of steps) {
      if (step.kind === "boundary") {
        const list = byNoun.get(step.noun) ?? [];
        for (const f of step.faults) if (!list.includes(f)) list.push(f);
        byNoun.set(step.noun, list);
      } else if (step.kind === "ply") {
        for (const cse of step.cases) walk(cse.steps);
      }
    }
  };
  for (const req of ast.reqs) walk(req.steps);
  return byNoun;
}

function collectAllFaults(req: ReqNode): string[] {
  const out = new Set<string>();
  const walk = (steps: StepLike[] | CseNode["steps"]) => {
    for (const step of steps) {
      if (step.kind === "step" || step.kind === "boundary") {
        for (const f of step.faults) out.add(f);
      } else if (step.kind === "ply") {
        for (const cse of step.cases) walk(cse.steps);
      }
    }
  };
  walk(req.steps);
  return [...out];
}

// ---- template engine ----

function render(template: string, ctx: Record<string, unknown>): string {
  let out = template;
  // {{#each items}}...{{/each}} (no nesting in v1)
  out = out.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, listPath: string, body: string) => {
      const list = resolvePath(ctx, listPath);
      if (!Array.isArray(list)) return "";
      return list.map((item) => substitute(body, { ...ctx, this: item })).join(
        "",
      );
    },
  );
  // Bare {{var}}
  return substitute(out, ctx);
}

function substitute(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
    const v = resolvePath(ctx, path);
    return v == null ? "" : String(v);
  });
}

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ---- inline templates ----

const HEADER = `// Generated by rune manifest from {{runePath}}.
// Edit the body. Re-running manifest will not overwrite this file.\n`;

const COORDINATOR_MOD_TPL = `${HEADER}
{{#each imports}}${"import"} type { {{this.type}} } ${"from"} "@/src/{{module}}/dto/{{this.file}}.ts";
{{/each}}
// Coordinator for [REQ] {{req.noun}}.{{req.verb}}({{req.input}}): {{req.output}}.

export async function {{req.verb}}(input: {{req.input}}): Promise<{{req.output}}> {
  // TODO: implement the flow as declared in the rune.
  throw new Error("not implemented");
}
`;

const COORDINATOR_INT_TEST_TPL = `${HEADER}
import { {{req.verb}} } from "./mod.ts";

Deno.test("{{req.verb}} — happy path", async () => {
  // TODO: implement happy path test
});
{{#each faults}}

Deno.test("{{this}}", async () => {
  // TODO: assert this fault path
});
{{/each}}
`;

const BUSINESS_TEST_TPL = `${HEADER}
import { {{noun}} } from "./mod.ts";

Deno.test("{{noun}} — placeholder", () => {
  // TODO: implement unit tests
});
`;

const POLY_BASE_MOD_TPL = `${HEADER}
// Polymorphic base for "{{ply.noun}}". Variants extend this.

export abstract class {{ply.noun}}Base {
  abstract {{ply.verb}}({{ply.params}}): {{ply.output}};
}
`;

const POLY_BASE_TEST_TPL = `${HEADER}
Deno.test("{{ply.noun}} base — placeholder", () => {
  // TODO: tests against the base abstraction
});
`;

// Note: Some templates use ${"keyword"} to break up import/export tokens so the
// linter regexes for barrel-discipline and import-aliases don't false-positive
// on literal template text inside this source file.

const POLY_MOD_TPL = `${HEADER}
// Polymorphic barrel for "{{ply.noun}}". Re-exports the active variant.
${"export"} { default } from "./implementations/{{firstVariant}}/mod.ts";
`;

const POLY_IMPL_MOD_TPL = `${HEADER}
${"import"} { {{ply.noun}}Base } ${"from"} "{{baseImport}}";

// Variant: {{cse.name}}

export default class {{ply.noun}}{{cse.name}} extends {{ply.noun}}Base {
  {{ply.verb}}({{ply.params}}): {{ply.output}} {
    throw new Error("not implemented");
  }
}
`;

const POLY_IMPL_TEST_TPL = `${HEADER}
import {{ply.noun}}{{cse.name}} from "./mod.ts";

Deno.test("{{ply.noun}}/{{cse.name}} — placeholder", () => {
  // TODO: variant-specific tests
});
`;

const ADAPTER_SMK_TEST_TPL = `${HEADER}
Deno.test("{{step.noun}} — connectivity", () => {
  // TODO: smoke test that verifies the boundary is reachable
});
{{#each faults}}

Deno.test("{{this}}", async () => {
  // TODO: assert this fault path
});
{{/each}}
`;

const DTO_TPL = `${HEADER}
import { z } from "#zod";

// {{dto.description}}
export const {{dto.name}}Schema = z.object({
{{#each dto.properties}}
  {{this}}: z.unknown(), // TODO: tighten
{{/each}}
});

export type {{dto.name}} = z.infer<typeof {{dto.name}}Schema>;
`;

const TYP_TPL = `${HEADER}
import { z } from "#zod";

// {{typ.description}}
// rune declares: [TYP] {{typ.name}}: {{typ.typeName}}
export const {{typ.name}}Schema = z.unknown(); // TODO: tighten to {{typ.typeName}}
export type {{typ.name}} = z.infer<typeof {{typ.name}}Schema>;
`;

const ENTRYPOINT_MOD_TPL = `${HEADER}
// Entrypoint surface: {{ent.surface}}.

export async function {{ent.action}}(input: {{ent.input}}): Promise<{{ent.output}}> {
  // TODO: dispatch to the corresponding [REQ] coordinator.
  throw new Error("not implemented");
}
`;

const ENTRYPOINT_E2E_TPL = `${HEADER}
import { {{ent.action}} } from "./mod.ts";

Deno.test("{{ent.action}} — e2e placeholder", async () => {
  // TODO: implement end-to-end test
});
`;

const MOD_ROOT_TPL = `${HEADER}
// Public API surface for module "{{module}}".
{{#each reqs}}
${"export"} { {{this.verb}} } from "./domain/coordinators/{{this.processFile}}/mod.ts";
{{/each}}
`;

// ---- artifact-driven codegen templates (WO-4b) ----
//
// The engine's codegen bodies, keyed by name. These ARE the canonical templates
// (mirrored into the artifact's codegen.templates by scripts/gen-codegen-templates.ts).
// planManifest reads the artifact's overrides when given (opts.codegen), else
// these — so generated output is byte-identical until a template is deliberately
// edited in the artifact (L3 holds; mutate-to-prove L6). The signature files
// (sig.ts + business/data mod.ts) come from rune-sig and are not yet templated.
export const DEFAULT_TEMPLATES: Record<string, string> = {
  "coordinator-mod": COORDINATOR_MOD_TPL,
  "coordinator-int-test": COORDINATOR_INT_TEST_TPL,
  "business-test": BUSINESS_TEST_TPL,
  "poly-base-mod": POLY_BASE_MOD_TPL,
  "poly-base-test": POLY_BASE_TEST_TPL,
  "poly-mod": POLY_MOD_TPL,
  "poly-impl-mod": POLY_IMPL_MOD_TPL,
  "poly-impl-test": POLY_IMPL_TEST_TPL,
  "adapter-smk-test": ADAPTER_SMK_TEST_TPL,
  "dto": DTO_TPL,
  "typ": TYP_TPL,
  "entrypoint-mod": ENTRYPOINT_MOD_TPL,
  "entrypoint-e2e": ENTRYPOINT_E2E_TPL,
  "mod-root": MOD_ROOT_TPL,
};

// Templates active for the current (synchronous) planManifest call.
let activeTemplates: Record<string, string> = DEFAULT_TEMPLATES;

function tpl(key: string): string {
  return activeTemplates[key] ?? DEFAULT_TEMPLATES[key];
}

// ---- role lifecycle / prune policy (WO-8) ----
//
// The engine's default policy: only the signature contracts regenerate; every
// other role is dev-owned (create-once) and prunable. The artifact can override
// any role via codegen.policies — so the regenerate/protect/prune behaviour is
// describable in the Studio rather than hard-coded. Defaults below reproduce the
// previous (pre-WO-8) behaviour exactly, so the L3 goldens are unchanged.
export const DEFAULT_POLICIES: Record<string, TemplatePolicy> = {
  "business-sig": { lifecycle: "regenerate", prunable: true },
  "adapter-sig": { lifecycle: "regenerate", prunable: true },
  "business-impl": { lifecycle: "create-once", prunable: true },
  "adapter-impl": { lifecycle: "create-once", prunable: true },
  "business-test": { lifecycle: "create-once", prunable: true },
  "adapter-smk-test": { lifecycle: "create-once", prunable: true },
  "coordinator-mod": { lifecycle: "create-once", prunable: true },
  "coordinator-int-test": { lifecycle: "create-once", prunable: true },
  "poly-base-mod": { lifecycle: "create-once", prunable: true },
  "poly-base-test": { lifecycle: "create-once", prunable: true },
  "poly-mod": { lifecycle: "create-once", prunable: true },
  "poly-impl-mod": { lifecycle: "create-once", prunable: true },
  "poly-impl-test": { lifecycle: "create-once", prunable: true },
  "dto": { lifecycle: "create-once", prunable: true },
  "typ": { lifecycle: "create-once", prunable: true },
  "entrypoint-mod": { lifecycle: "create-once", prunable: true },
  "entrypoint-e2e": { lifecycle: "create-once", prunable: true },
  "mod-root": { lifecycle: "create-once", prunable: true },
};

// Policies active for the current planManifest call; null → engine defaults.
// rune-sync reads this (via resolvePolicy) immediately after calling planManifest.
let activePolicies: Record<string, TemplatePolicy> | null = null;

/** Resolve a role's effective policy: artifact override → engine default →
 * universal fallback (create-once, prunable). Always returns both fields set. */
export function resolvePolicy(role: string): Required<TemplatePolicy> {
  const override = activePolicies?.[role];
  const base = DEFAULT_POLICIES[role];
  return {
    lifecycle: override?.lifecycle ?? base?.lifecycle ?? "create-once",
    prunable: override?.prunable ?? base?.prunable ?? true,
  };
}

/** Map a prunable file path to the role that governs whether it may be pruned,
 * and whether it is spec- or dev-owned. Used by rune-sync's prune pass so the
 * delete decision honours the same registry policy as generation.
 * `kind` mirrors rune-sync's slot classification: feature dirs vs dto files. */
export function pruneRoleFor(
  slot: {
    kind: "dir";
    category: "business" | "data" | "coordinators" | "entrypoints";
  } | { kind: "file" },
): { role: string; owned: "spec" | "dev" } {
  if (slot.kind === "file") return { role: "dto", owned: "spec" };
  switch (slot.category) {
    case "business":
      return { role: "business-impl", owned: "dev" };
    case "data":
      return { role: "adapter-impl", owned: "dev" };
    case "coordinators":
      return { role: "coordinator-mod", owned: "dev" };
    case "entrypoints":
      return { role: "entrypoint-mod", owned: "dev" };
  }
}
