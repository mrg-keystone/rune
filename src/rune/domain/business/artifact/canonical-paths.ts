// The project's canonical folder layout — the single source for the `structure`
// rule and the scaffold printer. It lives INSIDE the rune-studio artifact
// (keywords.json → `canonicalPaths`), so the artifact is the one source of truth
// for both the language AND the layout. (Was assets/canonical-paths.json.)
import ARTIFACT from "@keywords" with { type: "json" };

const raw = (ARTIFACT as { canonicalPaths?: unknown }).canonicalPaths;

// The structure rule and scaffold printer hard-depend on this; fail loudly here
// (rather than passing `undefined` downstream into an opaque crash) if a future
// keywords.json edit drops the key.
if (raw === undefined) {
  throw new Error(
    "keywords.json is missing `canonicalPaths` — the structure rule and scaffold " +
      "printer require it. Restore the key (edit it in Rune Studio).",
  );
}

// The canonical layout is a recursive tree of path segments that the structure
// rule walks dynamically; kept as `any` so those readers aren't forced to narrow
// every nested access. The guard above is what actually protects them.
// deno-lint-ignore no-explicit-any
export const canonicalPaths: any = raw;
