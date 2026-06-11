// Concrete-class generation for business features and data adapters. A noun's
// methods (collected across every [REQ] flow) become a plain class with stubbed
// bodies — no abstract base, no sig.ts. Polymorphic ([PLY]) nouns are excluded;
// they get an abstract base + variant implementations via the poly-* templates.
//
// Signatures resolve through the spec's [DTO]/[TYP] declarations when the
// caller threads them in (RenderImplOptions); anything unresolvable stays
// `unknown` — tighten as you implement. Exact input/output DTO parity for
// coordinators/entrypoints is enforced separately by rune-signature-parity.

import {
  type CseNode,
  type DtoNode,
  type RuneAst,
  type StepLike,
  type TypNode,
} from "@rune/domain/business/rune-parse/mod.ts";
import {
  type Binding,
  transformName,
} from "@rune/domain/business/rune-bindings/mod.ts";

export interface MethodSig {
  verb: string;
  params: string[];
  /** The step's declared return ("TaskDto", "id", "void", "" when omitted). */
  output: string;
  isStatic: boolean;
}

/** Type resolution + signature shape for renderImpl. All optional: with no
 * options the output is the legacy `unknown`-typed sync stub. */
export interface RenderImplOptions {
  /** Wrap returns in Promise<…> — data adapters are awaited by coordinators. */
  async?: boolean;
  /** [TYP] declarations by name: params/returns resolve to their primitive. */
  typMap?: Map<string, TypNode>;
  /** [DTO] declarations by name: Dto-suffixed names resolve to the class. */
  dtoByName?: Map<string, DtoNode>;
  /** Module + <name> binding for the isCore-aware DTO import paths. */
  module?: string;
  nameBinding?: Binding;
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
          output: step.output,
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
// With opts the signatures are typed from the spec's [DTO]/[TYP] declarations;
// adapter classes (opts.async) get Promise-wrapped returns (the coordinator
// awaits them). Bodies throw, so the un-`async` Promise signatures type-check
// without tripping deno lint's require-await.
export function renderImpl(
  noun: string,
  methods: MethodSig[],
  opts: RenderImplOptions = {},
): string {
  const pascal = toPascal(noun);
  const instance = methods.filter((m) => !m.isStatic);
  const statics = methods.filter((m) => m.isStatic);
  const usedDtos = new Set<string>();

  const resolve = (name: string): string =>
    resolveType(name, opts, usedDtos) ?? "unknown";
  const ret = (m: MethodSig): string => {
    const t = resolveOutput(noun, m.output, opts, usedDtos);
    return opts.async ? `Promise<${t}>` : t;
  };

  const body: string[] = [];
  body.push(`export class ${pascal} {`);
  for (const m of statics) {
    body.push(`  static ${m.verb}(${renderParams(m.params, resolve)}): ${ret(m)} {`);
    body.push(`    throw new Error("not implemented");`);
    body.push("  }");
  }
  for (const m of instance) {
    body.push(`  ${m.verb}(${renderParams(m.params, resolve)}): ${ret(m)} {`);
    body.push(`    throw new Error("not implemented");`);
    body.push("  }");
  }
  body.push("}");

  const lines: string[] = [];
  lines.push(
    "// Scaffolded once; fill in the bodies. `sync` preserves this file.",
  );
  lines.push("");
  for (const name of [...usedDtos].sort()) {
    const node = opts.dtoByName?.get(name);
    const dir = node?.isCore ? "src/core/dto" : `src/${opts.module}/dto`;
    const file = transformName(name, opts.nameBinding!);
    lines.push(`import { ${name} } from "@/${dir}/${file}.ts";`);
  }
  if (usedDtos.size > 0) lines.push("");
  lines.push(...body);
  lines.push("");
  return lines.join("\n");
}

// ---- type resolution ----

// A name resolves to a [DTO] class (recorded for import) or a [TYP] primitive;
// null = no contract in the spec.
function resolveType(
  name: string,
  opts: RenderImplOptions,
  usedDtos: Set<string>,
): string | null {
  if (
    /Dto$/.test(name) && opts.dtoByName?.has(name) && opts.module &&
    opts.nameBinding
  ) {
    usedDtos.add(name);
    return name;
  }
  switch (opts.typMap?.get(name)?.typeName) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "Uint8Array":
      return "Uint8Array";
  }
  return null;
}

// Return types additionally understand `void`, the noun itself (a fluent step
// like `task.normalize(): task` returns the class), and "" → unknown.
function resolveOutput(
  noun: string,
  output: string,
  opts: RenderImplOptions,
  usedDtos: Set<string>,
): string {
  const resolved = resolveType(output, opts, usedDtos);
  if (resolved !== null) return resolved;
  if (output === "void") return "void";
  if (output === noun) return toPascal(noun);
  return "unknown";
}

// ---- helpers ----

/** Render a rune param list as typed TS params, deduping and sanitising
 * identifiers. Types come from `resolve` (default: `unknown` — the poly
 * templates keep that shape so base/impl method signatures type-check). */
export function renderParams(
  params: string[],
  resolve: (name: string) => string = () => "unknown",
): string {
  const seen = new Set<string>();
  return params
    .map((p, i) => {
      let id = toCamelIdent(p);
      if (id === "" || seen.has(id)) id = `arg${i}`;
      seen.add(id);
      return `${id}: ${resolve(p)}`;
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
