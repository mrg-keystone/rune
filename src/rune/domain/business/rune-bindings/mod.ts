// Maps canonical-paths.json placeholders (like "<feature>") to the rune element
// that fills them. Used by the scaffolder (manifest) and the rune-derived rules.
//
// Convention by placeholder name — no annotations on canonical-paths.json. The
// placeholder names are semantically meaningful, the binding map is small and
// stable. New placeholder = update both the JSON and this file.

export type RuneElementSource =
  | "MOD" // [MOD] directive
  | "REQ" // [REQ] coordinator (process = `${noun}-${verb}`)
  | "STEP" // untagged step noun
  | "PLY" // polymorphic [PLY] noun
  | "CSE" // case name inside [PLY]
  | "BOUNDARY" // boundary tag's noun (db:noun.x → noun)
  | "DTO" // [DTO] (or [DTO:core])
  | "TYP" // [TYP] (or [TYP:core])
  | "ENT"; // [ENT] surface

export type CaseStyle = "kebab" | "camel" | "pascal" | "lower";

export interface Binding {
  // Which rune element types fill this placeholder. Multiple sources mean any of
  // them can produce a name for this slot.
  from: readonly RuneElementSource[];
  // How to transform the rune name into a path segment.
  caseStyle: CaseStyle;
  // Optional suffix to strip before transforming (e.g., "Dto" off "GetRecordingDto").
  stripSuffix?: string;
  // Whether this slot is in core/ (true) or in <module>/ (false). Some placeholders
  // can appear in both — the rune element's own :core modifier decides at runtime.
  // null means "depends on caller".
  coreOnly: boolean | null;
}

export const bindings: Record<string, Binding> = {
  "<module-name>": {
    from: ["MOD"],
    caseStyle: "kebab",
    coreOnly: false,
  },
  "<process>": {
    from: ["REQ"],
    caseStyle: "kebab",
    coreOnly: false,
  },
  "<feature>": {
    from: ["STEP", "PLY"],
    caseStyle: "kebab",
    coreOnly: null,
  },
  "<variant-name>": {
    from: ["CSE"],
    caseStyle: "kebab",
    coreOnly: null,
  },
  "<service>": {
    from: ["BOUNDARY"],
    caseStyle: "kebab",
    coreOnly: null,
  },
  "<name>": {
    from: ["DTO", "TYP", "ENT"],
    caseStyle: "kebab",
    stripSuffix: "Dto",
    coreOnly: null,
  },
};

export function applyCase(name: string, style: CaseStyle): string {
  switch (style) {
    case "lower":
      return name.toLowerCase();
    case "camel":
      return name[0].toLowerCase() + name.slice(1);
    case "pascal":
      return name[0].toUpperCase() + name.slice(1);
    case "kebab":
      return toKebab(name);
  }
}

function toKebab(name: string): string {
  // Insert a hyphen before each uppercase letter (except the first), then lowercase.
  // "GetRecordingDto" → "get-recording-dto"
  // "fiveNine" → "five-nine"
  // "metadata" → "metadata"
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    const isUpper = ch >= "A" && ch <= "Z";
    if (isUpper && i > 0) out += "-";
    out += ch.toLowerCase();
  }
  return out;
}

export function transformName(rawName: string, binding: Binding): string {
  let name = rawName;
  if (binding.stripSuffix && name.endsWith(binding.stripSuffix)) {
    name = name.slice(0, -binding.stripSuffix.length);
  }
  return applyCase(name, binding.caseStyle);
}

// Compose a process name from a [REQ]'s noun and verb.
//   recording.set        → "recording-set"
//   register/recording   → "recording-register" (camelCase form: noun-verb)
export function processName(noun: string, verb: string): string {
  return `${toKebab(noun)}-${toKebab(verb)}`;
}

// A rune file counts as a project spec only at one of these paths:
//   specs/<name>.rune
//   src/<module>/spec.rune
//   src/<module>/<module>.rune
// Documentation, vendored, and arbitrary rune files are skipped by rune rules.
export function isProjectSpec(path: string): boolean {
  if (path.startsWith("specs/") && !path.slice("specs/".length).includes("/")) return true;
  if (path.startsWith("src/")) {
    const rest = path.slice("src/".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return false;
    const module = rest.slice(0, slash);
    const tail = rest.slice(slash + 1);
    return tail === "spec.rune" || tail === `${module}.rune`;
  }
  return false;
}

// Derive the module name from a project-spec path.
//   specs/recording.rune       → "recording"
//   src/orders/spec.rune       → "orders"
//   src/orders/orders.rune     → "orders"
export function moduleFromSpecPath(path: string): string | null {
  if (!isProjectSpec(path)) return null;
  if (path.startsWith("specs/")) {
    return path.slice("specs/".length, -".rune".length);
  }
  // src/<module>/...
  return path.slice("src/".length).split("/")[0];
}
