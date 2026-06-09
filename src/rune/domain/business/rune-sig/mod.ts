// Concrete-class generation for business features and data adapters. A noun's
// methods (collected across every [REQ] flow) become a plain class with stubbed
// bodies — no abstract base, no sig.ts. Polymorphic ([PLY]) nouns are excluded;
// they get an abstract base + variant implementations via the poly-* templates.
//
// Signatures use `unknown` for params/returns; tighten them as you implement.
// Exact input/output DTO parity for coordinators/entrypoints is enforced
// separately by rune-signature-parity.

import {
  type CseNode,
  type RuneAst,
  type StepLike,
} from "@rune/domain/business/rune-parse/mod.ts";

export interface MethodSig {
  verb: string;
  params: string[];
  isStatic: boolean;
}

// Group method signatures by noun across every [REQ] flow. Polymorphic ([PLY])
// nouns are excluded — they get base/implementations, not a sig/impl split.
export function collectNounMethods(ast: RuneAst): Map<string, MethodSig[]> {
  const byNoun = new Map<string, MethodSig[]>();
  const polyNouns = new Set<string>();

  const add = (noun: string, sig: MethodSig): void => {
    const list = byNoun.get(noun) ?? [];
    if (!list.some((m) => m.verb === sig.verb && m.isStatic === sig.isStatic)) {
      list.push(sig);
    }
    byNoun.set(noun, list);
  };

  const walk = (steps: StepLike[] | CseNode["steps"]): void => {
    for (const step of steps) {
      if (step.kind === "step" || step.kind === "boundary") {
        add(step.noun, {
          verb: step.verb,
          params: step.params,
          isStatic: step.isStatic,
        });
      } else if (step.kind === "ply") {
        polyNouns.add(step.noun);
        for (const cse of step.cases) walk(cse.steps);
      }
    }
  };

  for (const req of ast.reqs) walk(req.steps);
  for (const noun of polyNouns) byNoun.delete(noun);
  return byNoun;
}

// Scaffolded-once impl: a plain concrete class. Statics and instance methods
// from the spec, bodies stubbed. No abstract base, no `override`, no sig import.
export function renderImpl(noun: string, methods: MethodSig[]): string {
  const pascal = toPascal(noun);
  const instance = methods.filter((m) => !m.isStatic);
  const statics = methods.filter((m) => m.isStatic);

  const lines: string[] = [];
  lines.push(
    "// Scaffolded once; fill in the bodies. `sync` preserves this file.",
  );
  lines.push("");
  lines.push(`export class ${pascal} {`);
  for (const m of statics) {
    lines.push(`  static ${m.verb}(${renderParams(m.params)}): unknown {`);
    lines.push(`    throw new Error("not implemented");`);
    lines.push("  }");
  }
  for (const m of instance) {
    lines.push(`  ${m.verb}(${renderParams(m.params)}): unknown {`);
    lines.push(`    throw new Error("not implemented");`);
    lines.push("  }");
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

// ---- helpers ----

/** Render a rune param list as typed TS params (`name: unknown`), deduping and
 * sanitising identifiers. Shared with the poly templates so base/impl method
 * signatures type-check the same way the sig/impl split does. */
export function renderParams(params: string[]): string {
  const seen = new Set<string>();
  return params
    .map((p, i) => {
      let id = toCamelIdent(p);
      if (id === "" || seen.has(id)) id = `arg${i}`;
      seen.add(id);
      return `${id}: unknown`;
    })
    .join(", ");
}

export function toPascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter((s) => s.length > 0)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

function toCamelIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "");
  if (cleaned === "") return "";
  return cleaned[0].toLowerCase() + cleaned.slice(1);
}
