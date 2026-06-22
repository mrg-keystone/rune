// Rune sync planner: one reconcile pass over a .rune spec against the project
// file set. Pure — no I/O. Combines scaffold (reuse planManifest) with prune of
// rune-managed slots the spec no longer declares.
//
//   toCreate  — new files the spec predicts that don't exist yet (from manifest)
//   toSkip    — predicted files that already exist (preserved, never clobbered)
//   toPrune   — folders/files in rune slots no element predicts (orphans)
//
// The prune prediction mirrors rune-extra-files: feature/coordinator/adapter/
// entrypoint slots are pruned at the folder level; dto/ at the file level.

import {
  type CseNode,
  parse,
  type StepLike,
} from "@rune/domain/business/rune-parse/mod.ts";
import {
  applyCase,
  bindings,
  processName,
  transformName,
} from "@rune/domain/business/rune-bindings/mod.ts";
import {
  type FilePlan,
  type ManifestOptions,
  planManifest,
  pruneRoleFor,
  resolvePolicy,
} from "@rune/domain/business/rune-manifest/mod.ts";
import type { SrvNode } from "@rune/domain/business/rune-parse/mod.ts";

export interface SyncPlan {
  module: string;
  rune: string;
  toCreate: FilePlan[];
  toRegenerate: FilePlan[];
  /** Every orphan the spec no longer declares that policy allows pruning. */
  toPrune: string[];
  /** The subset of toPrune that holds hand-written bodies (dev-owned). The
   * entrypoint requires --force to delete these; spec-owned orphans (dto files)
   * prune without it. */
  toPruneOwned: string[];
  toSkip: FilePlan[];
  errors: string[];
}

interface Predictions {
  dirs: Set<string>;
  files: Set<string>;
}

// Plan a sync run. Pure: the caller decides whether to write/delete. `opts`
// (artifact bindings/codegen/policies) flow into planManifest AND govern prune:
// a role with prunable:false is never deleted, and dev-owned orphans are split
// into toPruneOwned so the caller can gate them behind --force.
export function planSync(
  runePath: string,
  runeText: string,
  existingFiles: Set<string>,
  opts: ManifestOptions = {},
  // The project's shared `[SRV]` set from src/core/core.rune, forwarded to
  // planManifest so a module's adapters resolve their backing services.
  sharedSrvs?: Map<string, SrvNode>,
): SyncPlan {
  const manifest = planManifest(
    runePath,
    runeText,
    existingFiles,
    opts,
    sharedSrvs,
  );
  const plan: SyncPlan = {
    module: manifest.module,
    rune: runePath,
    toCreate: manifest.toCreate,
    toRegenerate: manifest.toRegenerate,
    toPrune: [],
    toPruneOwned: [],
    toSkip: manifest.toSkip,
    errors: manifest.errors,
  };
  if (manifest.errors.length > 0 || !manifest.module) return plan;

  const module = manifest.module;
  const ast = parse(runeText);
  const predicted = predictPaths(ast, module);

  // activePolicies is set by the planManifest call above; resolvePolicy reads it.
  const prune = new Set<string>();
  const owned = new Set<string>();
  const consider = (target: string, slot: Slot) => {
    const { role, owned: who } = pruneRoleFor(
      slot.kind === "dir"
        ? { kind: "dir", category: slot.category }
        : { kind: "file" },
    );
    if (!resolvePolicy(role).prunable) return; // policy forbids deleting this role
    prune.add(target);
    if (who === "dev") owned.add(target);
  };

  for (const file of existingFiles) {
    const slot = classify(file, module);
    if (!slot) continue;
    if (slot.kind === "dir") {
      if (!predicted.dirs.has(slot.dir)) consider(slot.dir, slot);
    } else if (!predicted.files.has(file)) {
      consider(file, slot);
    }
  }

  plan.toPrune = [...prune].sort();
  plan.toPruneOwned = [...owned].sort();
  return plan;
}

// ---- prediction: every rune-managed dir/file the spec declares ----

function predictPaths(
  ast: ReturnType<typeof parse>,
  module: string,
): Predictions {
  const dirs = new Set<string>();
  const files = new Set<string>();
  const dtoBinding = bindings["<name>"];

  for (const req of ast.reqs) {
    dirs.add(
      `src/${module}/domain/coordinators/${processName(req.noun, req.verb)}`,
    );
    walkSteps(req.steps, module, dirs);
  }
  for (const dto of ast.dtos) {
    const name = transformName(dto.name, dtoBinding);
    const scope = dto.isCore ? "core" : module;
    files.add(`src/${scope}/dto/${name}.ts`);
  }
  for (const typ of ast.typs) {
    const name = applyCase(typ.name, "kebab");
    const scope = typ.isCore ? "core" : module;
    files.add(`src/${scope}/dto/${name}.ts`);
  }
  for (const ent of ast.ents) {
    dirs.add(`src/${module}/entrypoints/${applyCase(ent.surface, "kebab")}`);
  }

  return { dirs, files };
}

function walkSteps(
  steps: StepLike[] | CseNode["steps"],
  module: string,
  dirs: Set<string>,
): void {
  for (const step of steps) {
    if (step.kind === "step") {
      dirs.add(
        `src/${module}/domain/business/${applyCase(step.noun, "kebab")}`,
      );
    } else if (step.kind === "boundary") {
      dirs.add(`src/${module}/domain/data/${applyCase(step.noun, "kebab")}`);
    } else if (step.kind === "ply") {
      const featureDir =
        `src/${module}/domain/business/${applyCase(step.noun, "kebab")}`;
      dirs.add(featureDir);
      for (const cse of step.cases) {
        // Predict each DECLARED variant folder so only a REMOVED [CSE] arm's
        // implementations/<case>/ becomes an orphan (classify keys these at the
        // case-folder level rather than collapsing them to the feature dir).
        dirs.add(
          `${featureDir}/implementations/${applyCase(cse.name, "kebab")}`,
        );
        walkSteps(cse.steps, module, dirs);
      }
    }
  }
}

// ---- classify an existing path into a prunable rune slot ----

type SlotCategory = "business" | "data" | "coordinators" | "entrypoints";
type Slot = { kind: "dir"; dir: string; category: SlotCategory } | {
  kind: "file";
};

function classify(path: string, module: string): Slot | null {
  const prefix = `src/${module}/`;
  if (!path.startsWith(prefix)) return null;
  const parts = path.split("/"); // ["src", module, ...]

  // src/<module>/domain/business/<noun>/implementations/<case>/... — a [PLY] variant folder.
  // Keyed at the case-folder level (not collapsed to the feature dir) so a removed [CSE] arm is
  // an orphan even though its parent [PLY] feature dir is still predicted. Must precede the
  // general business branch below.
  if (
    parts[2] === "domain" && parts[3] === "business" &&
    parts[5] === "implementations" && parts.length >= 7
  ) {
    return {
      kind: "dir",
      dir: parts.slice(0, 7).join("/"),
      category: "business",
    };
  }
  // src/<module>/domain/(business|data|coordinators)/<feature>/...
  if (
    parts[2] === "domain" &&
    (parts[3] === "business" || parts[3] === "data" ||
      parts[3] === "coordinators") &&
    parts.length >= 6
  ) {
    return {
      kind: "dir",
      dir: parts.slice(0, 5).join("/"),
      category: parts[3] as SlotCategory,
    };
  }
  // src/<module>/entrypoints/<surface>/...
  if (parts[2] === "entrypoints" && parts.length >= 5) {
    return {
      kind: "dir",
      dir: parts.slice(0, 4).join("/"),
      category: "entrypoints",
    };
  }
  // src/<module>/dto/<name>.ts
  if (parts[2] === "dto" && parts.length === 4 && path.endsWith(".ts")) {
    return { kind: "file" };
  }
  return null;
}

// ---- poly-mod barrel staleness (the sync entrypoint reads the file + does the I/O) ----

/** The variant a generated poly-mod barrel re-exports, e.g.
 * `export { default } from "./implementations/wyn/mod.ts";` → "wyn". Returns null when
 * the barrel has been hand-rewritten into a shape we can't statically read (a runtime
 * switch, several re-exports) — the caller then skips it rather than warn falsely. */
export function parseBarrelTarget(barrelContent: string): string | null {
  // Strip comments first so a dev who rewrote the barrel into a runtime switch but kept the old
  // generated line as a comment doesn't get the commented-out path read as the live re-export
  // (which would fire a false staleness warning). No `//` appears in the re-export path itself.
  const live = barrelContent
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const m = live.match(
    /from\s+["']\.\/implementations\/([A-Za-z0-9_-]+)\/mod\.ts["']/,
  );
  return m ? m[1] : null;
}

/** The warning when a create-once poly-mod barrel points at a variant the spec no
 * longer declares, OR whose folder is gone (e.g. a --force prune just removed the
 * arm). `variantExists` is the caller's on-disk check. null when the barrel is fine.
 * The barrel is dev-owned/create-once, so sync never rewrites it — it tells the dev to
 * repoint it (same posture as the stale heal-rules note). */
export function polyBarrelNote(
  dir: string,
  target: string,
  declaredCases: Set<string>,
  variantExists: boolean,
): string | null {
  if (!variantExists) {
    return `${dir}/poly-mod.ts re-exports ./implementations/${target}/mod.ts which no longer exists ` +
      `— repoint the barrel by hand to a current variant`;
  }
  if (!declaredCases.has(target)) {
    return `${dir}/poly-mod.ts re-exports ./implementations/${target} which no [CSE] declares ` +
      `— repoint the barrel by hand`;
  }
  return null;
}
