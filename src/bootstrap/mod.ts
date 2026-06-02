import { resolve, join } from "#std/path";
import { rules, runPipeline, parseArgs, printHeader, printResults, printJson, runManifest, runSync, runValidate } from "@rune/mod-root.ts";
import { getIgnoredPaths } from "@rune/domain/data/project/mod.ts";
import { suggestForResults } from "@rune/domain/data/llm/openai.ts";
import SHAPE from "@assets/canonical-paths.json" with { type: "json" };
import type { EntryResult } from "@core/dto/types.ts";

// Subcommand dispatch.
if (Deno.args[0] === "manifest") {
  const code = await runManifest(Deno.args.slice(1));
  Deno.exit(code);
}

if (Deno.args[0] === "sync") {
  const code = await runSync(Deno.args.slice(1));
  Deno.exit(code);
}

if (Deno.args[0] === "validate") {
  const code = await runValidate(Deno.args.slice(1));
  Deno.exit(code);
}

const { dir, module: moduleName, suggest, json } = parseArgs(Deno.args);

const targetDir = resolve(dir);
const ignoredPaths = await getIgnoredPaths(targetDir);

let scanDir = targetDir;
let filterPrefix: string | null = null;

if (moduleName) {
  scanDir = resolve(join(targetDir, "src", moduleName));
  filterPrefix = `src/${moduleName}/`;
}

if (!json) printHeader(scanDir);
const allResults: EntryResult[] = await runPipeline(
  moduleName ? targetDir : scanDir,
  rules,
  ignoredPaths,
);

// Filter to only the module's violations when --module is used
const filtered = filterPrefix
  ? allResults.filter((r) => r.path.startsWith(filterPrefix!))
  : allResults;

// Deterministic suggestions for simple rules
for (const r of filtered) {
  if (r.suggestion) continue;

  if (r.rule === "import-aliases") {
    const imp = r.violations[0]?.match(/\((.+)\)$/)?.[1];
    if (imp) r.suggestion = `Replace the relative import "${imp}" with the corresponding @ alias.`;
  } else if (r.rule === "external-imports") {
    r.suggestion = "Use a # alias in the import map instead of bare npm: or jsr: specifiers.";
  } else if (r.rule === "barrel-discipline") {
    r.suggestion = "Move re-exports to mod-root.ts or poly-mod.ts — other files should only export their own declarations.";
  } else if (r.rule === "dto-validation") {
    r.suggestion = "Add a Zod schema to validate this DTO shape.";
  } else if (r.rule === "layer-restrictions") {
    r.suggestion = r.violations[0];
  } else if (r.rule === "module-isolation") {
    r.suggestion = r.violations[0];
  } else if (r.rule === "fixture-promotion") {
    r.suggestion = "Move this fixture to assets/ since it's imported by production code.";
  } else if (r.rule === "structure") {
    const v = r.violations[0] ?? "";
    if (v.includes("Wrong extension")) {
      const match = v.match(/expected (.+?) \(/);
      if (match) r.suggestion = `Rename this file to use the ${match[1]} extension.`;
    } else if (v.includes("Missing required file")) {
      const match = v.match(/Missing required file "(.+?)"/);
      const extMatch = v.match(/\((\.[a-z]+(?:\|.[a-z]+)*)\)/);
      if (match) r.suggestion = `Create ${match[1]}${extMatch ? extMatch[1].split("|")[0] : ".ts"} in this folder.`;
    }
  }
}

if (suggest && filtered.length > 0) {
  const needsLlm = filtered.some(
    (r) =>
      !r.suggestion &&
      ((r.rule === "structure" && r.violations.some((v) => v.includes("not allowed"))) ||
        r.rule === "module-fragmentation"),
  );

  if (needsLlm) {
    try {
      const specJson = JSON.stringify(SHAPE, null, 2);
      const readFile = (path: string) => Deno.readTextFile(join(targetDir, path));
      console.error("  [suggest] Generating suggestions via OpenAI...");
      const t0 = performance.now();
      await suggestForResults(filtered, specJson, readFile);
      console.error(`  [suggest] Done in ${(performance.now() - t0).toFixed(0)}ms`);
    } catch (e) {
      console.error(`  [suggest] Failed: ${e}`);
    }
  }
}

if (json) printJson(filtered);
else printResults(filtered);

Deno.exit(filtered.length > 0 ? 1 : 0);
