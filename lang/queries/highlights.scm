; Rune syntax highlighting
; GENERATED from new/keywords.json by new/generate.mjs — do not edit by hand.

; Tags: structural anchors
(req_tag) @rune.tag
(mod_tag) @rune.tag
(ent_tag) @rune.tag
(ply_tag) @rune.tag
(cse_tag) @rune.tag
(new_tag) @rune.tag
(ret_tag) @rune.tag
(typ_tag) @rune.tag
(dto_tag) @rune.tag
(non_tag) @rune.tag

; Nouns: subjects (before . or ::)
(signature (identifier) @rune.noun)
(mod_line (identifier) @rune.noun)
(cse_line (identifier) @rune.noun)
(new_line (identifier) @rune.noun)
(non_line (identifier) @rune.noun)

; Verbs: actions (after . or ::)
(method_name) @rune.verb

; Function names: camelCase REQ signatures
(function_name) @rune.boundary

; DTOs: type contracts
(dto_reference) @rune.dto
(dto_def_name) @rune.dto

; Builtins: language primitives
(typ_type (type_name) @rune.builtin)
(typ_generic_type (type_name) @rune.builtin)
(typ_tuple_type (type_name) @rune.builtin)

; String enum values
(typ_enum_value) @rune.fault

; Boundaries: system edges
(boundary_prefix) @rune.boundary

; Faults
(fault_line) @rune.fault

; Optional marker + comments
(dto_optional_marker) @rune.comment
(typ_desc) @rune.comment
(dto_desc) @rune.comment
(non_desc) @rune.comment
(comment) @rune.comment
