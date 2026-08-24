## Tags

Every keyword tag in the fixed set is written as a three-letter code in
brackets, but that width is a convention, not a checked rule. The enforced rule
is that a tag must be a **known/recognized tag** (one of the fixed set below);
any unrecognized bracket tag — even a 3-letter one like `[XYZ]` — errors as an
unrecognized line, and length is never measured. The uniform width is what keeps
content after a bare margin tag starting at column 7; that alignment is the
design rationale, not a checked rule (modifier lists like `[TYP:ext,uuid]` and
indented tags shift content right, and no diagnostic measures columns).

| Tag | Purpose |
| --- | --- |
| `[MOD]` | Module directive — names the module (top of file; defaults to the filename) |
| `[REQ]` | Requirement — one externally triggerable feature, `noun.verb(InDto): OutDto` |
| `[ENT]` | Inbound entrypoint — the only source of an HTTP/WS surface |
| `[SRV]` | Backing-service declaration (core.rune only) |
| `[PLY]` | Polymorphic step (interface dispatch) |
| `[CSE]` | Concrete case inside a `[PLY]` block |
| `[NEW]` | Constructor shorthand (`[CTR]` is an accepted synonym; `[NEW]` is canonical) |
| `[RET]` | Return an in-scope value (when the last step is a side effect) |
| `[TYP]` | Named type — the primitive building blocks |
| `[DTO]` | Data-transfer object — composed of types, name must end in `Dto` |
| `[NON]` | Noun — a domain concept description; names the domain class that untagged steps and `[NEW]` operate on (see the todos example) |

The `[MOD]` line may carry a description: `[MOD] name: one-line prose`, with
indented continuation lines beneath it appending further prose (the same
front-door-doc shape `[SRV]` blocks use). The colon and everything after it are
optional — a bare `[MOD] name` leaves the description empty. The collected text
becomes the module description and feeds codegen: it renders as the `//` comment
header of the generated module barrel (`src/<module>/mod-root.ts`), above the
`[NON]`/`[TYP]`/`[SRV]` glossary, as the module's front-door doc (see
[04-codegen.md](../04-codegen/00-overview.md)).

