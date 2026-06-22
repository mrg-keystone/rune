// Artifact migrations (WO-7 / D5 / closes the versioning half of G8).
//
// When the language schema bumps, existing artifacts must keep working. Each
// migration upgrades one schemaVersion to the next; migrate() runs the chain
// from whatever version an artifact carries up to CURRENT, so an N-1 artifact
// still validates and still parses/generates under N (L7). Generated output is
// stamped with the version that produced it (see rune-manifest HEADER + this
// version).

import { bindings as DEFAULT_BINDINGS } from "@rune/domain/business/rune-bindings/mod.ts";
import { DEFAULT_TEMPLATES } from "@rune/domain/business/rune-manifest/mod.ts";

export const CURRENT_SCHEMA_VERSION = "1.0.0";

// deno-lint-ignore no-explicit-any
type Artifact = Record<string, any>;

export interface MigrationResult {
  artifact: Artifact;
  from: string;
  to: string;
  applied: string[];
}

/** Upgrade a pre-1.0.0 artifact to 1.0.0: stamp the version and fill the codegen
 * sections the engine now expects (bindings + templates) from the defaults. */
function to_1_0_0(a: Artifact, applied: string[]): Artifact {
  const out = { ...a };
  if (!out.schemaVersion) {
    out.schemaVersion = "1.0.0";
    applied.push("stamp schemaVersion 1.0.0");
  }
  if (!out.bindings) {
    out.bindings = structuredClone(DEFAULT_BINDINGS);
    applied.push("seed codegen bindings from engine defaults");
  }
  if (!out.codegen) {
    out.codegen = { templates: { ...DEFAULT_TEMPLATES } };
    applied.push("seed codegen.templates from engine defaults");
  }
  return out;
}

/** Run the migration chain from the artifact's version up to CURRENT. */
export function migrate(input: Artifact): MigrationResult {
  const from = String(input.schemaVersion ?? "0.0.0");
  const applied: string[] = [];
  let artifact = input;

  // 0.x -> 1.0.0
  if (major(from) < 1) {
    artifact = to_1_0_0(artifact, applied);
  }
  artifact = { ...artifact, schemaVersion: CURRENT_SCHEMA_VERSION };

  return { artifact, from, to: CURRENT_SCHEMA_VERSION, applied };
}

function major(v: string): number {
  return Number(v.split(".")[0]) || 0;
}
