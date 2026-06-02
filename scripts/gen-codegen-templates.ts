#!/usr/bin/env -S deno run -A
// Mirror the engine's DEFAULT_TEMPLATES into the artifact's codegen.templates,
// so the registry carries the canonical codegen bodies (WO-4b). Run once to
// seed / re-sync:
//
//   deno run -A scripts/gen-codegen-templates.ts
//
// Sourced from the engine so the artifact copy is byte-identical to the engine
// default (L3 baseline). After running, regenerate the studio copy with
// `deno run -A rune/new/generate.mjs` and re-check the Drift gate.
import { DEFAULT_TEMPLATES } from "@rune/domain/business/rune-manifest/mod.ts";

const p = new URL("../rune/new/keywords.json", import.meta.url);
const reg = JSON.parse(await Deno.readTextFile(p));
reg.codegen = { templates: { ...DEFAULT_TEMPLATES } };
await Deno.writeTextFile(p, JSON.stringify(reg, null, 2) + "\n");
console.log(`wrote codegen.templates: ${Object.keys(DEFAULT_TEMPLATES).length} templates`);
