#!/usr/bin/env -S deno run -A
// Emit the published JSON Schema from the authoritative zod schema.
//
//   deno run -A scripts/gen-artifact-schema.ts
//
// artifact.schema.json is DERIVED — do not hand-edit. The L1 gate regenerates
// it and diffs, so a hand-edit (or a zod-schema change without regeneration)
// fails verification.
import * as z from "#zod";
import { ArtifactSchema } from "@rune/domain/business/artifact/schema.ts";

const json = z.toJSONSchema(ArtifactSchema, { target: "draft-2020-12" });
const out = new URL("../lang/artifact.schema.json", import.meta.url);
await Deno.writeTextFile(out, JSON.stringify(json, null, 2) + "\n");
console.log("wrote lang/artifact.schema.json");
