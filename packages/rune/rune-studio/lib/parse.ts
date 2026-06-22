// @ts-nocheck — shared JS logic; Vite transpiles, no type-check needed at runtime.
// deno-lint-ignore-file no-explicit-any
// Parse a .rune spec into a per-keyword data model that templates render from.
//
// One parser, shared by the playground and any CLI render step. It is
// registry-driven: a keyword's `follows` field tells the parser what shape to
// extract, so adding a keyword in keywords.json teaches the parser too.
//
// Output: { byTag: { <tagId>: [instance, …] } }
// Each instance is a plain object whose fields the keyword's template can use.

function lc1(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// registerRecording -> { verb:"register", noun:"recording" }
// setRecordingMetadata -> { verb:"set", noun:"recordingMetadata" }
function splitFunctionName(fn) {
  const m = fn.match(/^([a-z][a-z0-9]*)([A-Z].*)?$/);
  if (!m) return { verb: fn, noun: "" };
  return { verb: m[1], noun: lc1(m[2] || "") };
}

// Parse a DTO property token: "url(s)", "MetadataDto?", "providerName"
function parseProp(tok) {
  let optional = false;
  tok = tok.trim();
  if (tok.endsWith("?")) {
    optional = true;
    tok = tok.slice(0, -1).trim();
  }
  const arr = tok.match(/^([A-Za-z_]\w*)\(([a-z]+)\)$/);
  let name, baseType, type, isArray;
  if (arr) {
    name = arr[1] + arr[2];
    baseType = arr[1];
    type = `${arr[1]}[]`;
    isArray = true;
  } else {
    name = tok;
    baseType = tok;
    type = tok;
    isArray = false;
  }
  // `decl` is the TS declaration name incl. the optional marker, handy for templates
  return {
    name,
    baseType,
    type,
    isArray,
    optional,
    decl: name + (optional ? "?" : ""),
  };
}

// split a parameter list on top-level commas (not inside {} or <>) so inline
// DTOs like {a:x, b:y} stay one parameter
function splitParams(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "{" || ch === "<") depth++;
    else if (ch === "}" || ch === ">") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Parse "noun.verb(a, b): Out" / "Noun::verb(...): Out" / "fnName(...): Out"
function parseSignature(text) {
  const dotted = text.match(
    /^([A-Za-z_]\w*)(\.|::)([A-Za-z_][\w-]*)\((.*?)\)\s*:\s*(.+)$/,
  );
  if (dotted) {
    const params = dotted[4].trim() ? splitParams(dotted[4]) : [];
    return {
      noun: dotted[1],
      sep: dotted[2],
      isStatic: dotted[2] === "::",
      verb: dotted[3],
      params,
      output: dotted[5].trim(),
    };
  }
  const fn = text.match(/^([a-z][A-Za-z0-9]*)\((.*?)\)\s*:\s*(.+)$/);
  if (fn) {
    const { verb, noun } = splitFunctionName(fn[1]);
    const params = fn[2].trim() ? splitParams(fn[2]) : [];
    return {
      name: fn[1],
      verb,
      noun,
      params,
      output: fn[3].trim(),
      isStatic: false,
    };
  }
  return { raw: text };
}

function parseStepLine(body) {
  const bm = body.match(/^([a-z]{2}):(.*)$/); // boundary prefix db: ex: ...
  let boundary = "";
  let rest = body;
  if (bm && /^(db|fs|mq|ex|os|lg):/.test(body)) {
    boundary = bm[1];
    rest = body.slice(3);
  }
  const sig = parseSignature(rest);
  return { raw: body.trim(), boundary, ...sig, faults: [] };
}

const isFaultLine = (b) =>
  /^[a-z0-9][a-z0-9\- ]*$/.test(b) && !b.includes("(") && !b.includes(":");

// Collect the indented step block that follows a requirement line.
function collectSteps(lines, start) {
  const steps = [];
  let last = null;
  for (let j = start + 1; j < lines.length; j++) {
    const r = lines[j];
    if (r.trim() === "") break; // blank line ends the requirement
    const indent = r.length - r.trimStart().length;
    const b = r.slice(indent);
    if (indent === 0) break; // next top-level element
    if (b.startsWith("//")) continue;
    if (indent >= 6 && isFaultLine(b)) { // fault line under previous step
      if (last) last.faults.push(...b.trim().split(/\s+/));
      continue;
    }
    const tagStep = b.match(/^\[([A-Z]{3})\]\s*(.*)$/);
    const step = tagStep
      ? {
        raw: b.trim(),
        tag: `[${tagStep[1]}]`,
        arg: tagStep[2].trim(),
        faults: [],
      }
      : parseStepLine(b);
    step.line = j + 1;
    step.indent = indent;
    steps.push(step);
    last = step;
  }
  return steps;
}

// First indented description line(s) following a definition.
function collectDescription(lines, start) {
  const out = [];
  for (let j = start + 1; j < lines.length; j++) {
    const r = lines[j];
    if (r.trim() === "") break;
    const indent = r.length - r.trimStart().length;
    if (indent < 4) break;
    if (r.slice(indent).startsWith("[")) break;
    out.push(r.trim());
  }
  return out.join(" ");
}

function buildInstance(tag, after, lines, idx) {
  switch (tag.follows) {
    case "dtodef": {
      const [name, propsStr = ""] = after.split(/:(.+)/);
      const props = propsStr.split(",").map((p) => p.trim()).filter(Boolean)
        .map(parseProp);
      return {
        name: name.trim(),
        props,
        description: collectDescription(lines, idx),
      };
    }
    case "typedef": {
      const [name, type = ""] = after.split(/:(.+)/);
      return {
        name: name.trim(),
        type: type.trim(),
        description: collectDescription(lines, idx),
      };
    }
    case "signature": {
      const sig = parseSignature(after);
      // Only requirement-level signatures (column 0) own a step block.
      const indent = tag.indent ?? 0;
      const steps = indent === 0 ? collectSteps(lines, idx) : [];
      const input = sig.params && sig.params.length ? sig.params[0] : "";
      return {
        name: sig.name || `${sig.noun}.${sig.verb}`,
        ...sig,
        input,
        steps,
      };
    }
    case "poly": {
      // polymorphic opener: noun is an interface; cases are linked in parseSpec
      const sig = parseSignature(after);
      return {
        name: sig.name || `${sig.noun}.${sig.verb}`,
        ...sig,
        input: (sig.params || [])[0] || "",
        steps: [],
        cases: [],
      };
    }
    case "case":
      return {
        name: after.trim(),
        description: collectDescription(lines, idx),
      };
    case "identifier":
      return {
        name: after.trim(),
        description: collectDescription(lines, idx),
      };
    case "value":
      return { value: after.trim() };
    default:
      return { raw: after.trim() };
  }
}

export function parseSpec(source, reg) {
  const lines = source.split(/\r?\n/);
  const byTag = Object.fromEntries(reg.tags.map((t) => [t.id, []]));

  let poly: any = null; // the currently-open [PLY] instance
  let polyIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = raw.length - raw.trimStart().length;
    const body = raw.slice(indent);
    if (body === "" || body.startsWith("//")) continue;
    // support the :core modifier — [DTO:core], [TYP:core] route to src/core/
    const isCore = /^\[\w+:core\]/.test(body);
    const matchBody = isCore ? body.replace(":core]", "]") : body;
    const tag = reg.tags.find((t) => matchBody.startsWith(t.tag));
    if (!tag) continue;
    const after = matchBody.slice(tag.tag.length).trim();

    // a non-case line at or above the [PLY]'s indent closes the block
    if (poly && tag.follows !== "case" && indent <= polyIndent) poly = null;

    const inst = buildInstance(tag, after, lines, i);
    inst.line = i + 1;
    inst.tagId = tag.id;
    inst.isCore = isCore;
    byTag[tag.id].push(inst);

    if (tag.follows === "poly") {
      poly = inst;
      polyIndent = indent;
    } else if (tag.follows === "case" && poly) {
      // give each case its interface context so it can generate an impl file
      inst.noun = poly.noun;
      inst.verb = poly.verb;
      inst.output = poly.output;
      inst.interface = poly.noun;
      poly.cases.push(inst);
    }
  }

  // A noun used at a system boundary (db:/ex:/os:/…) is a *data* class, not a
  // business class. Collect those, then tag every instance with its purity so
  // templates can route the file (e.g. impure/<noun> vs pure/<noun>).
  const impure = new Set<string>();
  for (const list of Object.values(byTag) as any[]) {
    for (const inst of list) {
      for (const step of inst.steps || []) {
        if (step.boundary && step.noun) impure.add(step.noun);
      }
    }
  }
  for (const list of Object.values(byTag) as any[]) {
    for (const inst of list) {
      // a case's purity follows its interface noun, not the case name
      const key = inst.noun ?? inst.name;
      if (key != null) {
        inst.isImpure = impure.has(key);
        inst.purity = inst.isImpure ? "impure" : "pure"; // "data" vs "business"
      }
    }
  }

  // Resolve each DTO property to a runtime validator + TS type, so the DTO
  // template can emit real class-validator decorators (not a stub).
  const PRIM = new Set(["string", "number", "boolean", "Uint8Array"]);
  const typMap = Object.fromEntries(
    (byTag.typ || []).map((t: any) => [t.name, t.type]),
  );
  const resolvePrim = (name: string): string => {
    if (PRIM.has(name)) return name;
    if (/Dto$/.test(name)) return "dto:" + name;
    const u = typMap[name];
    if (u) {
      if (PRIM.has(u)) return u;
      if (/^\s*number/.test(u)) return "number";
      if (/^\s*boolean/.test(u)) return "boolean";
      return "string"; // enums / string-literal unions / generics resolve to string
    }
    return "string";
  };
  const decoratorFor = (
    prim: string,
    optional: boolean,
    isArray: boolean,
  ): string => {
    let dec: string;
    if (prim.startsWith("dto:")) {
      dec = `@ValidateNested()\n  @Type(() => ${prim.slice(4)})`;
    } else if (prim === "number") dec = "@IsNumber()";
    else if (prim === "boolean") dec = "@IsBoolean()";
    else if (prim === "Uint8Array") dec = "@IsDefined()";
    else dec = "@IsString()";
    if (isArray) dec = "@IsArray()\n  " + dec;
    if (optional) dec = "@IsOptional()\n  " + dec;
    return dec;
  };
  for (const d of byTag.dto || []) {
    for (const p of d.props || []) {
      const prim = resolvePrim(p.baseType);
      p.tsType = p.type;
      p.validator = decoratorFor(prim, !!p.optional, !!p.isArray);
    }
  }

  // Module name from the optional [MOD] directive (defaults handled by caller).
  const modLine = lines.find((l) => l.trimStart().startsWith("[MOD]"));
  const module = modLine ? modLine.trim().slice(5).trim() : "";

  return { byTag, impureNouns: [...impure], module };
}
