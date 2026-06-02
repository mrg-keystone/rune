import type { PipelineContext, EntryTarget } from "@core/dto/types.ts";

export async function check(
  path: string,
  target: EntryTarget,
  ctx: PipelineContext,
): Promise<string[] | null> {
  if (target !== "folder") return null;
  if (!path.match(/^src\/[^/]+\/domain\/business$/)) return null;

  if (!ctx.lsp) return null;

  const pathDepth = path.split("/").length;
  const featureDirs = ctx.dirs
    .filter((d) => d.startsWith(path + "/") && d.split("/").length === pathDepth + 1)
    .map((d) => d.split("/").pop()!);

  if (featureDirs.length < 3) return null;

  const siblingExports = await ctx.lsp.getSiblingExportSignatures(path, featureDirs);

  // Count which export names appear across siblings
  const exportNameDirs = new Map<string, string[]>();
  for (const [dir, exports] of siblingExports) {
    for (const exp of exports) {
      const dirs = exportNameDirs.get(exp.name) ?? [];
      dirs.push(dir);
      exportNameDirs.set(exp.name, dirs);
    }
  }

  // Find names exported by 3+ siblings
  const candidates = [...exportNameDirs.entries()]
    .filter(([_, dirs]) => dirs.length >= 3);

  if (candidates.length === 0) return null;

  // Verify type compatibility for each candidate
  const confirmed: string[] = [];

  for (const [name, dirs] of candidates) {
    const signatures: string[] = [];
    for (const dir of dirs) {
      const modPath = `${path}/${dir}/mod.ts`;
      const sig = await ctx.lsp.getSymbolType(modPath, name);
      if (sig) signatures.push(sig);
    }

    if (signatures.length >= 3 && areSignaturesCompatible(signatures)) {
      confirmed.push(name);
    }
  }

  if (confirmed.length === 0) return null;

  return [`3+ sibling features export "${confirmed.join('", "')}" with compatible signatures — extract into a poly structure with poly-mod.ts`];
}

function areSignaturesCompatible(signatures: string[]): boolean {
  const arities = signatures.map(getArity);
  const first = arities[0];
  return first !== null && arities.every((a) => a === first);
}

function getArity(sig: string): number | null {
  // Match the parameter list inside the outermost parens
  const match = sig.match(/\(([^)]*)\)/);
  if (!match) return null;
  const params = match[1].trim();
  if (params === "") return 0;
  // Count top-level commas (not inside nested generics/parens)
  let depth = 0;
  let count = 1;
  for (const ch of params) {
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

export const SYSTEM_PROMPT = `You are a code architecture advisor detecting missing polymorphic modules.

Rule: When 3+ sibling features under a business/ directory export functions with the same names and compatible type signatures, they should be restructured into the canonical poly shape:

\`\`\`
<feature-name>/
├── base/
│   ├── mod.ts    — Base implementation shared across all variants
│   └── test.ts   — Tests for the base implementation
├── implementations/
│   └── <variant-name>/
│       ├── mod.ts  — Variant-specific implementation
│       └── test.ts — Tests for this variant
└── poly-mod.ts    — Barrel export for the active implementation
\`\`\`

The sibling features become variant implementations under a single poly feature. The base/ directory holds shared logic and the interface contract. The poly-mod.ts barrel re-exports the active variant(s) so consumers import from one place.

Given a detection of missing poly-mod, explain how to restructure the siblings into this shape. Be specific about what goes in base vs implementations.`;

export function buildPrompt(
  violations: string[],
  path: string,
  _target: EntryTarget,
): string {
  const detected = violations[0];
  const names = detected.replace("missing-poly-mod:", "").split(",");
  return `Directory: ${path}
Detection: ${detected}

These sibling features all export \`${names.join("`, `")}\` with compatible signatures.

They should be restructured into the canonical poly shape:
  <feature-name>/base/mod.ts — shared interface and common logic
  <feature-name>/implementations/<variant>/mod.ts — each current sibling becomes a variant
  <feature-name>/poly-mod.ts — barrel that re-exports all implementations

How should the developer restructure these siblings? What belongs in base vs implementations?`;
}
