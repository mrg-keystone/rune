/// <reference types="tree-sitter-cli/dsl" />
// @ts-check
//
// GENERATED from new/keywords.json by new/generate.mjs — do not edit by hand.
// Edit the registry (or use the studio) and regenerate.

module.exports = grammar({
  name: "rune",

  extras: ($) => [/ /, /\t/, $.comment],

  externals: ($) => [$.typ_desc, $.dto_desc, $.non_desc, $.fault_line],

  rules: {
    source_file: ($) => repeat(choice($._line, /\r?\n/)),

    _line: ($) =>
      choice(
        $.req_line,
        $.mod_line,
        $.ent_line,
        $.ply_line,
        $.cse_line,
        $.new_line,
        $.ret_line,
        $.typ_line,
        $.dto_line,
        $.non_line,
        $.boundary_line,
        $.step_line,
        $.fault_line,
        $.dto_desc,
        $.typ_desc,
        $.non_desc,
      ),

    // ---- generated keyword rules --------------------------------------
    // [REQ] Requirement (indent 0)
    req_tag: ($) => "[REQ]",
    req_line: ($) => seq($.req_tag, field("noun", $.identifier), optional(seq(choice(".", "::"), field("verb", $.method_name))), $.parameters, ":", $.return_type),

    // [MOD] Module (indent 0)
    mod_tag: ($) => "[MOD]",
    mod_line: ($) => seq($.mod_tag, field("name", $.identifier)),

    // [ENT] Entrypoint (indent 0)
    ent_tag: ($) => token(seq("[ENT", optional(seq(":", /[^\]\s]+/)), "]")),
    ent_line: ($) => seq($.ent_tag, $.signature, ":", $.return_type),

    // [PLY] Polymorphic step (indent 4)
    ply_tag: ($) => "[PLY]",
    ply_line: ($) => seq($.ply_tag, $.signature, ":", $.return_type),

    // [CSE] Case (indent 8)
    cse_tag: ($) => "[CSE]",
    cse_line: ($) => seq($.cse_tag, field("name", $.identifier)),

    // [NEW] Constructor (indent 4)
    new_tag: ($) => choice("[NEW]", "[CTR]"),
    new_line: ($) => seq($.new_tag, field("name", $.identifier)),

    // [RET] Return (indent 4)
    ret_tag: ($) => "[RET]",
    ret_line: ($) => seq($.ret_tag, choice(prec(2, $.dto_reference), $.type_name)),

    // [TYP] Type definition (indent 0)
    typ_tag: ($) => token(seq("[TYP", optional(seq(":", /[^\]\s]+/)), "]")),
    typ_line: ($) => seq($.typ_tag, $.typ_name, ":", $.typ_type),

    // [DTO] DTO definition (indent 0)
    dto_tag: ($) => token(seq("[DTO", optional(seq(":", /[^\]\s]+/)), "]")),
    dto_line: ($) => seq($.dto_tag, $.dto_def_name, ":", $.dto_prop, repeat(seq(",", optional($._ws), $.dto_prop))),

    // [NON] Noun declaration (indent 0)
    non_tag: ($) => token(seq("[NON", optional(seq(":", /[^\]\s]+/)), "]")),
    non_line: ($) => seq($.non_tag, field("name", $.identifier)),
    // ---- end generated keyword rules ----------------------------------

    comment: ($) => token(seq("//", /.*/)),

    dto_reference: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

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

    _ws: ($) => /[\s]+/,

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

    boundary_prefix: ($) => choice("db:", "fs:", "mq:", "ex:", "os:", "lg:"),

    dto_def_name: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

    dto_prop: ($) =>
      seq(
        choice($.dto_array_prop, prec(2, $.dto_reference), $.property_name),
        optional($.dto_optional_marker)
      ),

    dto_optional_marker: ($) => "?",

    dto_array_prop: ($) => seq($.property_name, $.dto_array_suffix),

    dto_array_suffix: ($) => /\([a-z]+\)/,

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
