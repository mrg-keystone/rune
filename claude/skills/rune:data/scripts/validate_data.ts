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

const STORES = new Set(["firestore", "denokv", "sqlite", "fs_json", "s3"]);
const SHAPES = new Set(["query", "subscription", "point-get", "atomic", "write", "blob"]);
const STRATEGIES = new Set(["append-child", "already-immutable", "aggregate", "overwrite-justified"]);
const RET_POLICIES = new Set(["permanent", "ttl", "purge-after"]);
const RET_MECHS = new Set(["kv-expireIn", "firestore-ttl-field", "s3-lifecycle", "signed-url-expiry", "sqlite-expires-col", "fs-json-sweep", "none"]);
const durationOk = (s: unknown) => typeof s === "string" && /^\s*\d+\s*(ms|s|m|h|d|w|mo|y)\s*$/.test(s);

const errs: string[] = [];
const warns: string[] = [];
const E = (m: string) => errs.push(m);
const W = (m: string) => warns.push(m);

// Validate a `retention` object: how long this data lives (a TTL) or that it's kept forever
// (permanent, no TTL). `required` warns when absent; `immStrategy` flags a TTL that would
// silently delete append-only history.
function checkRetention(tag: string, ret: any, opts: { required?: boolean; immStrategy?: string } = {}) {
  if (ret == null) {
    if (opts.required) W(`${tag}: no \`retention\` — state how long it lives (\`permanent\`, or a \`ttl\`); an unstated lifetime is a silent default`);
    return;
  }
  if (typeof ret !== "object" || Array.isArray(ret)) { E(`${tag}: \`retention\` must be an object { policy, ttl?, mechanism, why }`); return; }
  if (!RET_POLICIES.has(ret.policy)) E(`${tag}: \`retention.policy\` must be ${[...RET_POLICIES].join("|")} (got ${JSON.stringify(ret.policy)})`);
  const timed = ret.policy === "ttl" || ret.policy === "purge-after";
  if (timed && !ret.ttl) E(`${tag}: \`retention.policy: "${ret.policy}"\` requires a \`ttl\` duration (e.g. "24h", "30d")`);
  if (timed && ret.ttl && !durationOk(ret.ttl)) W(`${tag}: \`retention.ttl\` ${JSON.stringify(ret.ttl)} doesn't look like a duration (e.g. "15m", "24h", "30d")`);
  if (ret.policy === "permanent" && ret.ttl) E(`${tag}: \`retention.policy: "permanent"\` must NOT carry a \`ttl\` — permanent means it never expires`);
  if (ret.mechanism !== undefined && !RET_MECHS.has(ret.mechanism)) E(`${tag}: \`retention.mechanism\` invalid (${JSON.stringify(ret.mechanism)}) — one of ${[...RET_MECHS].join("|")}`);
  if (ret.policy === "permanent" && ret.mechanism && ret.mechanism !== "none") W(`${tag}: permanent retention usually needs no expiry mechanism — use \`mechanism: "none"\` (unless a lifecycle rule only transitions storage class, never deletes)`);
  if (timed && (!ret.mechanism || ret.mechanism === "none")) W(`${tag}: a ${ret.policy} retention needs a real \`mechanism\` (kv-expireIn / firestore-ttl-field / s3-lifecycle / sqlite-expires-col / fs-json-sweep), not "none"`);
  if (!ret.why) W(`${tag}: \`retention.why\` empty — say why this lifetime (especially why it is permanent)`);
  if (timed && opts.immStrategy === "append-child")
    W(`${tag}: a \`${ret.policy}\` TTL on an \`append-child\` record will delete the history the immutability work protects — set \`permanent\`, or justify the roll-off in \`why\` if this is truly an append-only log that ages out`);
}

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

    for (const [j, pr] of (ent?.projections ?? []).entries()) {
      if (!STORES.has(pr?.store)) E(`${tag} projections[${j}]: \`store\` invalid (${JSON.stringify(pr?.store)})`);
      if (pr?.retention) checkRetention(`${tag} projections[${j}]`, pr.retention);
    }

    // blobs[] — large-file fields stored out-of-band: a remote S3 bucket (`s3`, the
    // default) or a local file on disk (`fs`, written via the [SRV] (NATIVE)fs boundary —
    // e.g. a screenshot PNG beside an fs_json/sqlite store). Either way the bytes live
    // outside the record, which keeps only a reference.
    for (const [j, b] of (ent?.blobs ?? []).entries()) {
      if (b?.store && b.store !== "s3" && b.store !== "fs") E(`${tag} blobs[${j}]: \`store\` must be "s3" (remote bucket) or "fs" (local file) (got ${JSON.stringify(b.store)})`);
      const localBlob = b?.store === "fs";
      if (!b?.field) W(`${tag} blobs[${j}]: missing \`field\` — name the record field that holds the ${localBlob ? "local-file path" : "S3"} reference`);
      if (!b?.key) W(`${tag} blobs[${j}]: missing \`key\` — give the ${localBlob ? "local file path/pattern" : "S3 object key pattern"}`);
      if (b?.retention) checkRetention(`${tag} blobs[${j}]`, b.retention);
    }

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

    // retention — every entity must consciously state its lifetime (a TTL, or permanent)
    checkRetention(tag, ent?.retention, { required: true, immStrategy: ent?.immutability?.strategy });
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
