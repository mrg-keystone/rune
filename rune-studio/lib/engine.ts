// WO-5: the shared interpreter (closes G9 / G2 for the Studio).
//
// The Studio no longer carries its own parse/codegen engine — it calls the SAME
// shape-checker modules the real `shape-checker` CLI runs, so preview == engine
// output by construction (L5), not by approximation. This replaces the
// lib/runegen.ts Rust-binary bridge (retired per ADR 0001).

import { parse } from "@rune/domain/business/rune-parse/mod.ts";
import { planManifest } from "@rune/domain/business/rune-manifest/mod.ts";

export { parse, planManifest };

// deno-lint-ignore no-explicit-any
type Registry = any;

/**
 * Generate the file tree for a .rune spec — the exact files the engine emits.
 * When a registry (the edited artifact) is passed, its bindings + codegen
 * templates drive the output, so editing the language in the UI changes real
 * generation with no engine recompile (WO-7 / L6 end-to-end).
 */
// A `specs/` path so the engine derives a module even when the spec omits [MOD]
// (the studio editor's default). A real [MOD] in the spec still wins.
export const STUDIO_RUNE_PATH = "specs/spec.rune";

export function generate(source: string, registry?: Registry): { path: string; content: string }[] {
  const opts = registry
    ? {
      bindings: registry.bindings,
      codegen: registry.codegen?.templates,
      policies: registry.codegen?.policies,
    }
    : {};
  const plan = planManifest(STUDIO_RUNE_PATH, source, new Set(), opts);
  if (plan.errors.length > 0) {
    throw new Error("parse/generate error:\n" + plan.errors.join("\n"));
  }
  return [...plan.toCreate, ...plan.toRegenerate].sort((a, b) => a.path.localeCompare(b.path));
}
