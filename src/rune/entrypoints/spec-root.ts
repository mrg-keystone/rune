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

/** Load the project's shared `[SRV]` set from `<root>/src/core/core.rune`.
 *
 * Returns the services by name, or `undefined` when there is no core spec, it
 * declares no services, or `targetAbs` IS the core spec itself (a spec never
 * merges its own declarations). Pure read — the planners stay I/O-free and the
 * entrypoints do this loading, mirroring how they read the target spec text. */
export async function loadCoreSrvs(
  root: string,
  targetAbs: string,
): Promise<Map<string, SrvNode> | undefined> {
  const corePath = join(root, CORE_SPEC_REL);
  if (resolve(corePath) === resolve(targetAbs)) return undefined;
  let text: string;
  try {
    text = await Deno.readTextFile(corePath);
  } catch {
    return undefined; // no core spec in this project
  }
  const ast = parse(text);
  if (ast.srvs.length === 0) return undefined;
  return new Map(ast.srvs.map((s) => [s.name, s]));
}
