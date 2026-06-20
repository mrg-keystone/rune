import { basename, dirname, join, resolve } from "#std/path";
import { parse, type SrvNode } from "@rune/domain/business/rune-parse/mod.ts";
import { CORE_SPEC_REL } from "@rune/domain/business/rune-bindings/mod.ts";

// Where to scaffold, derived from the spec's OWN location (not cwd). Dead simple:
//   - if the spec already lives inside a `src/<module>/` (i.e. it was moved there
//     by a previous run), the root is the dir above that `src/` — so re-syncing
//     the moved spec stays put and never nests a second `src/<module>/`.
//   - otherwise, scaffold right beside the spec, in its own directory.
// Only the spec's immediate parents are inspected, so a `src` dir higher up the
// path can't hijack the root. `--root` overrides this at the call site.
//
// Shared by `rune sync` and `rune manifest` so the root-resolution rule has a
// single source of truth and can't drift between the two entrypoints.
export function resolveRoot(absRune: string): string {
  const specDir = dirname(absRune);
  if (basename(dirname(specDir)) === "src") return dirname(dirname(specDir));
  return specDir;
}

/** Load the project's shared `[SRV]` set from the core spec.
 *
 * Looks in two places, in order: the canonical `<root>/src/core/core.rune`, and
 * a flat `<root>/core.rune` sibling (so a plain `spec/` folder of `.rune` files
 * resolves too). Returns the services by name, or `undefined` when there is no
 * core spec, it declares no services, or `targetAbs` IS the core spec itself (a
 * spec never merges its own declarations). Pure read — the planners stay
 * I/O-free; the entrypoints do this loading, like they read the target text. */
export async function loadCoreSrvs(
  root: string,
  targetAbs: string,
): Promise<Map<string, SrvNode> | undefined> {
  const candidates = [join(root, CORE_SPEC_REL), join(root, "core.rune")];
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
