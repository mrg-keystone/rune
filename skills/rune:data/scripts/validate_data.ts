#!/usr/bin/env -S deno run -A
// validate_data.ts — deterministic gate for a rune:data design.
//
// Checks spec/misc/data.json against the schema AND for completeness against the
// spec (every [NON] entity must be designed). Catches the model drifting from
// the contract — ad-hoc shapes, missing entities, an `aggregate` that smuggled
// in an event ledger, an `overwrite-justified` with no `why`. Exit 0 = clean,
// 1 = errors. Warnings never fail the build but are printed.
//
// Usage: deno run -A validate_data.ts spec/misc/data.json [spec/runes/ or spec/runes/*.rune ...]
//   (pass the spec path(s) to enable entity-coverage checking)

const STORES = new Set(["firestore", "denokv"]);
const SHAPES = new Set(["query", "subscription", "point-get", "atomic", "write"]);
const STRATEGIES = new Set(["append-child", "already-immutable", "aggregate", "overwrite-justified"]);

const errs: string[] = [];
const warns: string[] = [];
const E = (m: string) => errs.push(m);
const W = (m: string) => warns.push(m);

async function collectRunes(dir: string, out: string[]): Promise<void> {
  // Recurse so a bare `spec/` reaches `spec/runes/*.rune` (the canonical staging
  // dir) and skips the sibling `spec/misc/` + `spec/ui/`, which hold no specs.
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir.replace(/\/$/, "")}/${e.name}`;
    if (e.isDirectory) await collectRunes(p, out);
    else if (e.isFile && e.name.endsWith(".rune")) out.push(p);
  }
}

async function specEntities(paths: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of paths) {
    const info = await Deno.stat(p).catch(() => null);
    const files: string[] = [];
    if (info?.isDirectory) await collectRunes(p, files);
    else if (info?.isFile) files.push(p);
    for (const f of files) {
      const t = await Deno.readTextFile(f);
      for (const line of t.split("\n")) {
        const m = line.trim().match(/^\[NON\]\s+(\S+)/);
        if (m) out.add(m[1]);
      }
    }
  }
  return out;
}

async function main() {
  const [dataPath, ...specPaths] = Deno.args;
  if (!dataPath) { console.error("usage: validate_data.ts spec/misc/data.json [spec/runes/ ...]"); Deno.exit(2); }

  let doc: any;
  try { doc = JSON.parse(await Deno.readTextFile(dataPath)); }
  catch (e) { console.error(`✗ ${dataPath} is not valid JSON: ${(e as Error).message}`); Deno.exit(1); }

  if (typeof doc.module !== "string" || !doc.module) E("top-level `module` (string) is missing");
  if (!doc.generatedFrom || !Array.isArray(doc.generatedFrom?.specs)) W("`generatedFrom.specs[]` missing — record which specs/prototype this came from");
  if (!Array.isArray(doc.entities) || !doc.entities.length) { E("`entities` must be a non-empty array"); report(); }

  const seen = new Set<string>();
  for (const [i, ent] of (doc.entities ?? []).entries()) {
    const tag = ent?.name ? `entity '${ent.name}'` : `entities[${i}]`;
    if (!ent?.name) E(`${tag}: missing \`name\``); else seen.add(ent.name);
    if (!STORES.has(ent?.store)) E(`${tag}: \`store\` must be one of ${[...STORES].join("|")} (got ${JSON.stringify(ent?.store)})`);
    if (!ent?.rationale) W(`${tag}: empty \`rationale\` — a reviewer reads this to understand the store choice`);

    const aps = ent?.accessPatterns;
    if (!Array.isArray(aps) || !aps.length) E(`${tag}: \`accessPatterns[]\` must be non-empty (they justify the store)`);
    else for (const [j, ap] of aps.entries()) {
      if (!SHAPES.has(ap?.shape)) E(`${tag} accessPatterns[${j}]: \`shape\` must be ${[...SHAPES].join("|")} (got ${JSON.stringify(ap?.shape)})`);
      if (!ap?.source) W(`${tag} accessPatterns[${j}]: missing \`source\` — trace it to a spec step or prototype region`);
      if (ap?.store && !STORES.has(ap.store)) E(`${tag} accessPatterns[${j}]: \`store\` invalid (${JSON.stringify(ap.store)})`);
    }

    for (const [j, pr] of (ent?.projections ?? []).entries())
      if (!STORES.has(pr?.store)) E(`${tag} projections[${j}]: \`store\` invalid (${JSON.stringify(pr?.store)})`);

    const im = ent?.immutability;
    if (!im || !STRATEGIES.has(im.strategy)) {
      E(`${tag}: \`immutability.strategy\` must be ${[...STRATEGIES].join("|")} (got ${JSON.stringify(im?.strategy)})`);
    } else {
      if (im.strategy === "append-child") {
        if (!im.collection?.name) E(`${tag}: append-child needs \`immutability.collection.name\``);
        if (im.collection && im.collection.appendOnly !== true) W(`${tag}: append-child \`collection.appendOnly\` should be true`);
        if (!im.currentStateOnRead) W(`${tag}: append-child should say how current state is derived (\`currentStateOnRead\`)`);
      }
      if (im.strategy === "aggregate" && im.collection)
        E(`${tag}: strategy 'aggregate' must NOT carry a \`collection\` ledger — a derived counter is not event-sourced. Drop it or use 'append-child' if history is truly a feature.`);
      if (im.strategy === "overwrite-justified" && !(im.why || im.justification))
        E(`${tag}: 'overwrite-justified' requires a \`why\` explaining why the overwrite is safe`);
    }
  }

  if (specPaths.length) {
    const want = await specEntities(specPaths);
    for (const n of want) if (!seen.has(n)) E(`spec declares [NON] ${n} but it is absent from data.json entities — every entity must be designed`);
  }

  report();

  function report() {
    for (const w of warns) console.log(`⚠ ${w}`);
    if (errs.length) { for (const e of errs) console.error(`✗ ${e}`); console.error(`\n${errs.length} error(s), ${warns.length} warning(s) — data.json is NOT valid.`); Deno.exit(1); }
    console.log(`✓ ${dataPath} is valid${specPaths.length ? " and covers every spec entity" : ""}. ${warns.length} warning(s).`);
    Deno.exit(0);
  }
}

if (import.meta.main) await main();
