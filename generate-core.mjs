// Derive tree-sitter artifacts from the keyword registry.
//
// This is the ONE place keywords turn into a grammar. The studio imports the
// sibling copy (studio/lib/generate-core.ts — kept byte-for-byte in lock-step
// with this file's logic) for its "Export" buttons; generate.mjs imports this
// to write the committed files. Both share the exact same logic, so the studio
// preview and the committed grammar can never drift.

/** Map a tag's `follows` kind to the body of its tree-sitter line rule. */
function lineRuleBody(tag) {
  const t = `$.${tag.id}_tag`;
  switch (tag.follows) {
    case "signature":
    case "poly": // a polymorphic opener has the same line shape as a signature
      // noun.verb(args): returnType  (optionally a camelCase function name)
      return tag.allowFunctionName
        ? `seq(${t}, choice($.req_signature, $.signature), ":", $.return_type)`
        : `seq(${t}, $.signature, ":", $.return_type)`;
    case "typedef":
      return `seq(${t}, $.typ_name, ":", $.typ_type)`;
    case "dtodef":
      return `seq(${t}, $.dto_def_name, ":", $.dto_prop, repeat(seq(",", optional($._ws), $.dto_prop)))`;
    case "identifier":
    case "case": // a polymorphic case is followed by a bare case name
      return `seq(${t}, field("name", $.identifier))`;
    case "value":
      return `seq(${t}, choice(prec(2, $.dto_reference), $.type_name))`;
    case "none":
      return `${t}`;
    default:
      throw new Error(`Unknown "follows" kind: ${tag.follows} (tag ${tag.tag})`);
  }
}

/** Insert a modifier token before a tag literal's closing bracket: [DTO] :core -> [DTO:core]. */
function applyModifier(literal, token) {
  return literal.replace(/\]$/, `${token}]`);
}

/**
 * Every literal a tag's `_tag` rule must accept: its primary spelling, any
 * synonyms ([NEW]/[CTR]), and any :core-style modifier variants ([DTO:core]).
 */
function tagLiterals(tag, modifiers) {
  const base = [tag.tag, ...(tag.synonyms ?? [])];
  const variants = [];
  for (const mod of modifiers) {
    if ((mod.appliesTo ?? []).includes(tag.id)) {
      for (const b of base) variants.push(applyModifier(b, mod.token));
    }
  }
  return [...base, ...variants];
}

/** Build the contents of grammar.js from the registry. */
export function buildGrammar(reg) {
  const modifiers = reg.modifiers ?? [];

  const tagRules = reg.tags
    .map((tag) => {
      const lits = tagLiterals(tag, modifiers);
      const tagRule = lits.length === 1
        ? JSON.stringify(lits[0])
        : `choice(${lits.map((l) => JSON.stringify(l)).join(", ")})`;
      return (
        `    // ${tag.tag} ${tag.label} (indent ${tag.indent})\n` +
        `    ${tag.id}_tag: ($) => ${tagRule},\n` +
        `    ${tag.id}_line: ($) => ${lineRuleBody(tag)},`
      );
    })
    .join("\n\n");

  const lineChoice = [
    ...reg.tags.map((t) => `$.${t.id}_line`),
    "$.boundary_line",
    "$.step_line",
    "$.fault_line",
    "$.dto_desc",
    "$.typ_desc",
    "$.non_desc",
  ]
    .map((r) => `        ${r},`)
    .join("\n");

  const boundaryChoice = reg.boundaries.prefixes
    .map((p) => JSON.stringify(p))
    .join(", ");

  return `/// <reference types="tree-sitter-cli/dsl" />
// @ts-check
//
// GENERATED from new/keywords.json by new/generate.mjs — do not edit by hand.
// Edit the registry (or use the studio) and regenerate.

module.exports = grammar({
  name: "rune",

  extras: ($) => [/ /, /\\t/, $.comment],

  externals: ($) => [$.typ_desc, $.dto_desc, $.non_desc, $.fault_line],

  rules: {
    source_file: ($) => repeat(choice($._line, /\\r?\\n/)),

    _line: ($) =>
      choice(
${lineChoice}
      ),

    // ---- generated keyword rules --------------------------------------
${tagRules}
    // ---- end generated keyword rules ----------------------------------

    comment: ($) => token(seq("//", /.*/)),

    dto_reference: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

    req_signature: ($) =>
      seq(field("function", $.function_name), $.parameters),

    function_name: ($) => /[a-z][a-zA-Z0-9]*/,

    signature: ($) =>
      seq(
        field("noun", $.identifier),
        choice(".", "::"),
        field("verb", $.method_name),
        $.parameters
      ),

    method_name: ($) => /[a-zA-Z][a-zA-Z0-9_-]*/,

    parameters: ($) => seq("(", optional($._param_list), ")"),

    _param_list: ($) =>
      seq($._param, repeat(seq(",", optional($._ws), $._param))),

    _param: ($) =>
      choice(
        $.inline_dto,
        $.typed_param,
        prec(2, $.dto_reference),
        $.param_name
      ),

    typed_param: ($) => seq($.param_name, ":", $._type),

    param_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    inline_dto: ($) =>
      seq(
        "{",
        optional(
          seq(
            optional($._ws),
            $.dto_property,
            repeat(seq(",", optional($._ws), $.dto_property)),
            optional($._ws)
          )
        ),
        "}"
      ),

    _ws: ($) => /[\\s]+/,

    dto_property: ($) => $.property_name,

    property_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    _type: ($) => choice(prec(2, $.dto_reference), $.type_name),

    type_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    return_type: ($) =>
      seq($._return_type_single, repeat(seq("|", $._return_type_single))),

    _return_type_single: ($) =>
      prec.right(
        choice(
          $.array_type,
          $.generic_type,
          prec(2, $.dto_reference),
          prec(1, $.type_name)
        )
      ),

    array_type: ($) =>
      prec(5, seq(choice(prec(2, $.dto_reference), $.type_name), "[", "]")),

    generic_type: ($) =>
      seq($.type_name, "<", $._generic_inner, ">"),

    _generic_inner: ($) =>
      seq(
        choice(prec(2, $.dto_reference), $.type_name),
        repeat(seq(",", choice(prec(2, $.dto_reference), $.type_name)))
      ),

    step_line: ($) => seq($.signature, ":", $.return_type),

    boundary_line: ($) =>
      seq($.boundary_prefix, $.signature, ":", $.return_type),

    boundary_prefix: ($) => choice(${boundaryChoice}),

    dto_def_name: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

    dto_prop: ($) =>
      seq(
        choice($.dto_array_prop, prec(2, $.dto_reference), $.property_name),
        optional($.dto_optional_marker)
      ),

    dto_optional_marker: ($) => "?",

    dto_array_prop: ($) => seq($.property_name, $.dto_array_suffix),

    dto_array_suffix: ($) => /\\([a-z]+\\)/,

    typ_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    typ_type: ($) =>
      choice(
        $.typ_generic_type,
        $.typ_tuple_type,
        $.typ_enum_type,
        prec(1, $.type_name)
      ),

    typ_generic_type: ($) => seq($.type_name, "<", $._generic_inner, ">"),

    typ_tuple_type: ($) =>
      seq("[", $.type_name, repeat(seq(",", optional($._ws), $.type_name)), "]"),

    typ_enum_type: ($) =>
      seq($.typ_enum_value, repeat1(seq("|", $.typ_enum_value))),

    typ_enum_value: ($) => /"[^"]*"/,

    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
});
`;
}

/** Build the contents of queries/highlights.scm from the registry. */
export function buildHighlights(reg) {
  const lines = [
    "; Rune syntax highlighting",
    "; GENERATED from new/keywords.json by new/generate.mjs — do not edit by hand.",
    "",
    "; Tags: structural anchors",
  ];

  for (const tag of reg.tags) lines.push(`(${tag.id}_tag) @rune.tag`);

  lines.push("", "; Nouns: subjects (before . or ::)");
  lines.push("(signature (identifier) @rune.noun)");
  for (const tag of reg.tags) {
    if (tag.follows === "identifier" || tag.follows === "case") {
      lines.push(`(${tag.id}_line (identifier) @rune.noun)`);
    }
  }

  lines.push(
    "",
    "; Verbs: actions (after . or ::)",
    "(method_name) @rune.verb",
    "",
    "; Function names: camelCase REQ signatures",
    "(function_name) @rune.boundary",
    "",
    "; DTOs: type contracts",
    "(dto_reference) @rune.dto",
    "(dto_def_name) @rune.dto",
    "",
    "; Builtins: language primitives",
    "(typ_type (type_name) @rune.builtin)",
    "(typ_generic_type (type_name) @rune.builtin)",
    "(typ_tuple_type (type_name) @rune.builtin)",
    "",
    "; String enum values",
    "(typ_enum_value) @rune.fault",
    "",
    "; Boundaries: system edges",
    "(boundary_prefix) @rune.boundary",
    "",
    "; Faults",
    "(fault_line) @rune.fault",
    "",
    "; Optional marker + comments",
    "(dto_optional_marker) @rune.comment",
    "(typ_desc) @rune.comment",
    "(dto_desc) @rune.comment",
    "(non_desc) @rune.comment",
    "(comment) @rune.comment",
  );

  return lines.join("\n") + "\n";
}

/** Map registry palette keys to the @rune.* capture names used in highlights. */
export function captureColors(reg) {
  return {
    "rune.tag": reg.palette.tag,
    "rune.noun": reg.palette.noun,
    "rune.verb": reg.palette.verb,
    "rune.dto": reg.palette.dto,
    "rune.builtin": reg.palette.builtin,
    "rune.boundary": reg.palette.boundary,
    "rune.fault": reg.palette.fault,
    "rune.comment": reg.palette.comment,
  };
}
