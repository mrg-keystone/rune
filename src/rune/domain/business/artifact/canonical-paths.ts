// The project's canonical folder layout — the single source for the `structure`
// rule and the scaffold printer. It lives INSIDE the rune-studio artifact
// (keywords.json → `canonicalPaths`), so the artifact is the one source of truth
// for both the language AND the layout. (Was assets/canonical-paths.json.)
import ARTIFACT from "@keywords" with { type: "json" };

// deno-lint-ignore no-explicit-any
export const canonicalPaths: any = (ARTIFACT as { canonicalPaths: unknown })
  .canonicalPaths;

export default canonicalPaths;
