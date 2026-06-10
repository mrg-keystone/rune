import { basename, dirname } from "#std/path";

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
