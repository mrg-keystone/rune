#!/usr/bin/env -S deno run --allow-read
// Lockstep guard (enabled by the monorepo): the decorator-stack dependency
// ranges rune writes into generated projects (REQUIRED_IMPORTS in
// src/rune/entrypoints/sync/mod.ts) MUST equal keep's own ranges
// (packages/keep/deno.json). The single-copy invariant — ONE
// class-validator / class-transformer / reflect-metadata across a generated
// project AND keep — depends on it; a drift silently degrades nested validation
// and can make bootstrapServer() throw at load (see the reflect-metadata note in
// sync/mod.ts). Across two repos this was comment-only; here it is machine-checked.
//
//   deno run --allow-read packages/rune/scripts/check-keep-lockstep.ts
//   (or: deno task check:lockstep from the repo root)

import { fromFileUrl } from "#std/path";

const REPO = new URL("../../../", import.meta.url); // scripts -> rune -> packages -> root
const syncSrc = await Deno.readTextFile(
  fromFileUrl(new URL("packages/rune/src/rune/entrypoints/sync/mod.ts", REPO)),
);
const keepJson = JSON.parse(
  await Deno.readTextFile(fromFileUrl(new URL("packages/keep/deno.json", REPO))),
) as { imports: Record<string, string> };

// Pull a value out of the REQUIRED_IMPORTS object literal by key.
function emitted(key: string): string | null {
  const m = syncSrc.match(
    new RegExp(`"${key.replace(/[/]/g, "\\/")}":\\s*"([^"]+)"`),
  );
  return m ? m[1] : null;
}

// (label, range rune emits, range keep declares) — must be byte-equal.
const pairs: Array<[string, string | null, string | undefined]> = [
  ["class-validator", emitted("class-validator"), keepJson.imports["class-validator"]],
  ["class-transformer", emitted("class-transformer"), keepJson.imports["class-transformer"]],
  ["reflect-metadata", emitted("reflect-metadata"), keepJson.imports["reflect-metadata"]],
  // rune emits @danet/swagger via #api-doc; keep maps it as #danet/swagger/decorators.
  ["@danet/swagger", emitted("#api-doc"), keepJson.imports["#danet/swagger/decorators"]],
];

const bad: string[] = [];
for (const [label, runeRange, keepRange] of pairs) {
  if (!runeRange) bad.push(`${label}: could not find rune's emitted range in sync/mod.ts`);
  else if (!keepRange) bad.push(`${label}: not declared in packages/keep/deno.json`);
  else if (runeRange !== keepRange) {
    bad.push(`${label}: rune emits "${runeRange}" but keep declares "${keepRange}"`);
  }
}

if (bad.length) {
  console.error("keep-lockstep: DRIFT\n  " + bad.join("\n  "));
  Deno.exit(1);
}
console.log(
  `keep-lockstep: OK — ${pairs.length} decorator-stack ranges match between rune's ` +
    `REQUIRED_IMPORTS and packages/keep/deno.json`,
);
