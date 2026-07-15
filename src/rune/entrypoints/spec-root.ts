import { basename, dirname, join, resolve } from "#std/path";
import { parse, type SrvNode } from "@rune/domain/business/rune-parse/mod.ts";
import { CORE_SPEC_REL } from "@rune/domain/business/rune-bindings/mod.ts";

// Where to scaffold — the keep backend CODEGEN ROOT — derived from the spec's OWN
// location (not cwd). In the canonical composed monorepo the backend lives in a
// `server/` package beside the sprig `ui/` package, with the shared authoring
// `spec/` at the git root: `<git>/{ui,server,spec}`. Codegen lands under
// `<git>/server/src/<module>/` and the moved spec beside it. So:
//   - a spec in the canonical `spec/runes/` staging dir (or `specs/runes/`) sits
//     at the GIT ROOT (`<git>/spec/runes/<m>.rune`); the codegen root is its
//     `server/` sibling — hop up past `runes/`+`spec/` to the git root, then into
//     `server`. `spec/runes/` sits beside `spec/misc/` (data + cake artifacts)
//     and `spec/ui/` (the sprig prototype), all under one shared `spec/`.
//   - a spec in a flat `spec/` / `specs/` folder (the legacy staging layout) is
//     also at the git root → the same `server/` sibling is the codegen root.
//   - a spec already MOVED inside a `src/<module>/` (a previous run relocated it
//     into `<git>/server/src/<module>/`) resolves to the dir above that `src/`,
//     which IS `<git>/server` — so a staging sync and a re-sync of the moved spec
//     agree on the ONE codegen root, and re-syncing never nests a second `src/`.
//   - otherwise, scaffold right beside the spec, in its own directory.
// Only the spec's immediate parents are inspected, so a `src`/`spec` dir higher
// up the path can't hijack the root. `--root` overrides this at the call site
// (e.g. `--root <git>/server`).
//
// Shared by `rune sync` and `rune manifest` so the root-resolution rule has a
// single source of truth and can't drift between the two entrypoints.
export function resolveRoot(absRune: string): string {
  const specDir = dirname(absRune);
  // spec/runes/ — the canonical staging subfolder at the git root: hop up TWO
  // levels (past `runes/` and `spec/`) to the git root, then into the `server/`
  // codegen root. Mirrors the singular-`spec/` staging rule below.
  if (basename(specDir) === "runes" && basename(dirname(specDir)) === "spec") {
    return join(dirname(dirname(specDir)), "server");
  }
  if (basename(specDir) === "spec") return join(dirname(specDir), "server");
  // A moved spec inside `server/src/<module>/`: the dir above `src/` is already
  // the `server/` codegen root — return it as-is (no extra `server/` hop).
  if (basename(dirname(specDir)) === "src") return dirname(dirname(specDir));
  return specDir;
}

/** The core-spec file locations probed under the `server/` codegen `root`, in
 * resolution order: the canonical `<root>/src/core/core.rune` first, then the
 * shared `spec/runes/` staging dir. In the composed monorepo that staging dir is
 * the git-root `spec/` — a SIBLING of the `server/` codegen root — so each staging
 * location is probed both one level UP (`<root>/../spec/...`, the canonical
 * `<git>/spec/runes/core.rune`) AND under `<root>` (the legacy layout where spec/
 * sat inside the codegen root), so old fixtures and the new split both resolve.
 * The legacy flat `spec/`+`specs/` layouts and a flat `<root>/core.rune` sibling
 * follow — each trailed (last) by its `.in-prog.rune` draft. A draft core STILL
 * supplies the shared services so every module resolves its boundary calls while
 * core is iterated on (core is infrastructure, not a composable module — it
 * declares no endpoints and is never mounted — so unlike a module draft it must
 * not be "ignored"); finalized core wins when both exist. Shared by loadCoreSrvs
 * (reads them) and coreSpecExists (stats them) so the two can't drift. */
function coreSpecCandidates(root: string): string[] {
  const up = dirname(root); // the git root when `root` is `<git>/server`
  return [
    join(root, CORE_SPEC_REL), // canonical: <server>/src/core/core.rune
    join(up, "spec", "runes", "core.rune"), // shared <git>/spec/runes/ staging
    join(root, "spec", "runes", "core.rune"), // legacy under-root spec/runes/
    join(up, "specs", "runes", "core.rune"),
    join(root, "specs", "runes", "core.rune"),
    join(up, "spec", "core.rune"), // legacy flat spec/ layout
    join(root, "spec", "core.rune"),
    join(up, "specs", "core.rune"),
    join(root, "specs", "core.rune"),
    join(root, "core.rune"), // flat sibling
    join(root, "src", "core", "core.in-prog.rune"),
    join(up, "spec", "runes", "core.in-prog.rune"),
    join(root, "spec", "runes", "core.in-prog.rune"),
    join(up, "specs", "runes", "core.in-prog.rune"),
    join(root, "specs", "runes", "core.in-prog.rune"),
    join(up, "spec", "core.in-prog.rune"),
    join(root, "spec", "core.in-prog.rune"),
    join(up, "specs", "core.in-prog.rune"),
    join(root, "specs", "core.in-prog.rune"),
    join(root, "core.in-prog.rune"),
  ];
}

/** Load the project's shared `[SRV]` set from the core spec.
 *
 * Probes coreSpecCandidates() in order. Returns the services by name, or
 * `undefined` when there is no core spec, the first core spec found declares no
 * services, or `targetAbs` IS the core spec itself (a spec never merges its own
 * declarations). Pure read — the planners stay I/O-free; the entrypoints do
 * this loading, like they read the target text. */
export async function loadCoreSrvs(
  root: string,
  targetAbs: string,
): Promise<Map<string, SrvNode> | undefined> {
  for (const corePath of coreSpecCandidates(root)) {
    if (resolve(corePath) === resolve(targetAbs)) continue; // never self-merge
    let text: string;
    try {
      text = await Deno.readTextFile(corePath);
    } catch {
      continue; // not at this location
    }
    const ast = parse(text);
    if (ast.srvs.length === 0) return undefined;
    return new Map(ast.srvs.map((s) => [s.name, s]));
  }
  return undefined; // no core spec in this project
}

/** Whether a core spec FILE exists under `root` (any supported layout), as
 * opposed to whether it declares services. The entrypoints pass this to the
 * planner so a strict-services run can tell two very different failures apart:
 * "no core.rune anywhere under the resolved root" (almost always the root
 * doesn't point at the rune project — e.g. the spec is staged above it — a
 * root-resolution error) versus "core.rune exists but doesn't declare service
 * X" (a genuine spec error). Same candidate set + self-skip as loadCoreSrvs. */
export async function coreSpecExists(
  root: string,
  targetAbs: string,
): Promise<boolean> {
  for (const corePath of coreSpecCandidates(root)) {
    if (resolve(corePath) === resolve(targetAbs)) continue;
    try {
      await Deno.stat(corePath);
      return true;
    } catch {
      continue; // not at this location
    }
  }
  return false;
}
