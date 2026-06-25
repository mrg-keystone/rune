import { basename, dirname, join, resolve } from "#std/path";
import { parse, type SrvNode } from "@rune/domain/business/rune-parse/mod.ts";
import { CORE_SPEC_REL } from "@rune/domain/business/rune-bindings/mod.ts";

// Where to scaffold, derived from the spec's OWN location (not cwd). Dead simple:
//   - if the spec lives in the canonical `spec/runes/` staging dir (or its
//     `specs/runes/` plural), the root is the dir ABOVE `spec/` — so codegen and
//     the moved spec land in the sibling `src/<module>/` at the root, never
//     nested under `spec/`. `spec/runes/` sits beside `spec/misc/` (data + cake
//     artifacts) and `spec/ui/` (the sprig prototype), all under one `spec/`.
//   - if the spec lives in a flat `spec/` / `specs/` folder (the legacy layout),
//     the root is the dir above it — same STAGING semantics.
//   - if the spec already lives inside a `src/<module>/` (i.e. it was moved there
//     by a previous run), the root is the dir above that `src/` — so re-syncing
//     the moved spec stays put and never nests a second `src/<module>/`.
//   - otherwise, scaffold right beside the spec, in its own directory.
// Only the spec's immediate parents are inspected, so a `src`/`spec` dir higher
// up the path can't hijack the root. `--root` overrides this at the call site.
//
// Shared by `rune sync` and `rune manifest` so the root-resolution rule has a
// single source of truth and can't drift between the two entrypoints.
export function resolveRoot(absRune: string): string {
  const specDir = dirname(absRune);
  // spec/runes/ — the canonical staging subfolder: hop up TWO levels (past
  // `runes/` and `spec/`) to the project root. Mirrors the singular-`spec/`
  // staging rule below; the plural `specs/` stays the legacy resolve-to-self.
  if (basename(specDir) === "runes" && basename(dirname(specDir)) === "spec") {
    return dirname(dirname(specDir));
  }
  if (basename(specDir) === "spec") return dirname(specDir);
  if (basename(dirname(specDir)) === "src") return dirname(dirname(specDir));
  return specDir;
}

/** Load the project's shared `[SRV]` set from the core spec.
 *
 * Looks for the core spec under any supported layout, in order: the canonical
 * `<root>/src/core/core.rune`, the `spec/runes/` staging dir
 * (`<root>/spec/runes/core.rune`), the legacy flat `spec/` and `specs/` folder
 * layouts (`<root>/spec/core.rune`, `<root>/specs/core.rune`), and a flat
 * `<root>/core.rune` sibling. Returns the services by name, or `undefined` when there is no
 * core spec, it declares no services, or `targetAbs` IS the core spec itself (a
 * spec never merges its own declarations). Pure read — the planners stay
 * I/O-free; the entrypoints do this loading, like they read the target text. */
export async function loadCoreSrvs(
  root: string,
  targetAbs: string,
): Promise<Map<string, SrvNode> | undefined> {
  const candidates = [
    join(root, CORE_SPEC_REL), // canonical: src/core/core.rune
    join(root, "spec", "runes", "core.rune"), // spec/runes/ staging dir
    join(root, "specs", "runes", "core.rune"), // specs/runes/ staging dir
    join(root, "spec", "core.rune"), // legacy flat spec/ layout
    join(root, "specs", "core.rune"), // legacy flat specs/ layout
    join(root, "core.rune"), // flat sibling
    // A draft core (`core.in-prog.rune`) STILL supplies the shared services so
    // every module resolves its boundary calls while core is iterated on. Core
    // is infrastructure, not a composable module — it declares no endpoints and
    // is never mounted — so unlike a module draft it must not be "ignored" here,
    // else marking it in-prog silently breaks every module's `db:`/service step.
    // Finalized core wins when both exist (these come last).
    join(root, "src", "core", "core.in-prog.rune"),
    join(root, "spec", "runes", "core.in-prog.rune"),
    join(root, "specs", "runes", "core.in-prog.rune"),
    join(root, "spec", "core.in-prog.rune"),
    join(root, "specs", "core.in-prog.rune"),
    join(root, "core.in-prog.rune"),
  ];
  for (const corePath of candidates) {
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
