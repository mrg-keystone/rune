#!/usr/bin/env -S deno run -A
// WO-6: out-of-band tree-sitter build pipeline.
//
//   deno run -A new/build-grammar.ts
//
// Regenerates every editor artifact FROM THE ARTIFACT and compiles a WASM
// parser the in-Studio editor (and external editors) consume — the browser
// never runs the tree-sitter toolchain. Steps:
//   1. generate.mjs        keywords.json -> grammar/grammar.js + queries/highlights.scm
//   2. tree-sitter generate grammar.js   -> grammar/src/parser.c (+ grammar.json)
//   3. tree-sitter build    parser.c      -> grammar/rune.wasm
//   4. copy rune.wasm + highlights.scm    -> studio/static/ (editor consumes)
//
// A tag/colour change in keywords.json, re-run through this, recolours both the
// in-Studio editor (new WASM + highlights) and any external editor fed the same
// artifacts. No hand edits to generated files (the Drift + grammar gates guard).

const HERE = new URL(".", import.meta.url);
const runeRoot = new URL("../", HERE);
const grammarDir = new URL("grammar/", runeRoot);
const studioStatic = new URL("studio/static/", HERE);

async function run(cmd: string, args: string[], cwd: URL): Promise<void> {
  const p = new Deno.Command(cmd, { args, cwd, stdout: "inherit", stderr: "inherit" });
  const { success, code } = await p.output();
  if (!success) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${code})`);
}

// 1. registry -> grammar.js + highlights.scm + studio copy
await run("deno", ["run", "--allow-read", "--allow-write", "new/generate.mjs"], runeRoot);
// 2. grammar.js -> parser.c
await run("tree-sitter", ["generate"], grammarDir);
// 3. parser.c -> WASM
await run("tree-sitter", ["build", "--wasm", "-o", "rune.wasm"], grammarDir);
// 4. publish to the studio's static dir for the in-browser editor
await Deno.mkdir(studioStatic, { recursive: true });
await Deno.copyFile(new URL("rune.wasm", grammarDir), new URL("rune-tree-sitter.wasm", studioStatic));
await Deno.copyFile(new URL("queries/highlights.scm", runeRoot), new URL("rune-highlights.scm", studioStatic));

console.log("grammar build complete:");
console.log("  grammar/rune.wasm");
console.log("  studio/static/rune-tree-sitter.wasm");
console.log("  studio/static/rune-highlights.scm");
