## Ghost stubs — the `[TYP:ext]` lifecycle

An external input is a promise that *someone else* produces the value. Until
that producer exists, sync generates `bootstrap/stubs.ts` — a ghost stub
module with one trivial GET endpoint per unfulfilled input (`mint-<name>`,
marked `stub: true`). It mounts like any module (cake at `/docs/stubs`,
badged `stub`), so dependent modules run end-to-end before their real
producers are built.

Each `mint-<name>` mints a placeholder scaled to the field's declared `[TYP]`
primitive **and shaped to satisfy every constraint modifier the field
carries** — the mint exists so the consumer's own seam validation passes, not
just to fill the base type, so a bare-primitive placeholder that fails the
field's own modifiers (`""` against `[TYP:ext,uuid]`) would defeat the stub's
purpose. The endpoint's response body is an object keyed by the field's own
name — `{ <name>: <placeholder> }`, never a bare value — because producer
discovery (below) requires the endpoint's declared output to own the field's
exact name:

| Declared primitive, no constraint modifier | `<name>`'s value in `{ <name>: ... }` |
| --- | --- |
| `string` | `""` |
| `number` | `0` |
| `boolean` | `false` |
| `Uint8Array` | `new Uint8Array(0)` (empty) |
| `void` | `null` |

When the field also carries one of the string/number constraint modifiers
(`uuid`/`email`/`url`/`nonempty`/`json`/`int`/`min=N`/`max=N`/`positive` —
see
[02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md)),
that modifier's placeholder replaces the bare-primitive default above for
that field:

| Constraint modifier | `<name>`'s value in `{ <name>: ... }` |
| --- | --- |
| `uuid` | `"00000000-0000-4000-8000-000000000000"` (well-formed v4 UUID) |
| `email` | `"stub@example.com"` |
| `url` | `"https://example.com/stub"` |
| `nonempty` | `"stub"` |
| `json` | `"{}"` (a valid JSON-blob string) |
| `int` | `1` |

The five string modifiers above never combine with each other on one field
(each already requires `string`, and its own placeholder already satisfies
`nonempty` too, so there's no further conflict to resolve). `positive` has no
table row of its own: it's parametrized against `min=N` and `max=N` the same
way they're parametrized against each other, so all three — `min=N`, `max=N`,
and `positive` — are resolved below as one combined rule rather than tabled
per modifier, since a value minted to satisfy one of them in isolation can
land outside a co-declared bound from another. (`int` stays tabled above
because it never shifts that combined rule's outcome beyond rounding — see
below.)

What `mint-<name>` mints when a field carries `min=N`, `max=N`, and/or
`positive` together: whichever value is minted must satisfy *every*
co-declared modifier at once, per the invariant above, so the modifiers can't
be resolved independently — a `max=N` default that ignores a co-declared
`positive`, or a `min=N` default that ignores a co-declared `max`, would mint
a value that fails the field's own constraints. Sync computes `min` and
`positive` together into a single lower bound before ever consulting `max`,
so one never overrides the other — the lower bound is `max(N, 1)` if both
`min=N` and `positive` are present (rounded per any co-declared `int`), `N`
itself if only `min=N` is present, `1` if only `positive` is present, else
`0`. Sync mints that lower bound, unless a co-declared `max=N` is also
present and smaller than it, in which case the field's modifiers are
mutually contradictory (e.g. `min=5,max=3`) and sync rejects the declaration
rather than minting a value guaranteed to fail one of them. A field carrying
only `max=N` (no `min` or `positive`) keeps today's rule: mint the smallest
already-tabled candidate that is `≤ N` (falling back to `N` itself if every
tabled value exceeds it). Combining `min` and `positive` into one lower bound
up front — rather than trying `min=N` first and only falling back to
`positive` when `min` is absent — keeps the mint from ever contradicting
either one: `[TYP:ext,min=0,positive]` lands on a lower bound of
`max(0, 1) = 1`, not the `0` a `min`-first branch would wrongly mint against
`positive`.

`[TYP:ext]` is a **type-agnostic** modifier — it applies to a field of any
type, not just the five primitives tabled above (see
[02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md)).
A field whose declared type is `Class`, a DTO, a generic, an array (whether
written `Array<T>` or via the `(s)`/`(s?)` pluralized-array suffix, e.g.
`[TYP:ext] tag(s): string` → `string[]`), or a union has no table-able
placeholder the way a bare primitive does, so `mint-<name>` skips stub
generation for these fields entirely (the skip-stub set) — they stay
permanently unfulfilled until a real producer lands, the same "no
placeholder" treatment `Class` already gets at DTO boundaries (`@Allow()`, no
validator, never boundary-safe — see 02-language/04); a synthesized array/DTO/
union placeholder would need per-field placeholder rules of its own, which
the skip-stub treatment avoids needing to define. A consumer bound to a
skip-stub field — array-typed or otherwise — accordingly never resolves
through a stub: it stays unresolved until a real producer lands, same as any
other permanently-unfulfilled input, rather than reading falsely green off a
minted placeholder.

Each external input moves through the same four states, independently of
every other input sharing the file. What's generated — `bootstrap/stubs.ts`
and its registry entry — changes only when `rune sync` runs; the *state* a
field logically occupies can still change between syncs, though, since
declaring a producer moves a field from Stubbed to Producer-present the
moment it lands in the composed sources, before any sync has run against it:

| State | Reached when | `bootstrap/stubs.ts` | Registry entry | `mint-<name>` endpoint |
| --- | --- | --- | --- | --- |
| **Unfulfilled** | `[TYP:ext]` field declared, and no producer for it exists yet in the composed sources — covers both the window before the first sync runs against it, and, for a field whose declared type is `Class`, a DTO, a generic, an array, or a union (the skip-stub set, defined above), every sync after that too, since that field can never be minted a stub | not yet generated for this field — though the shared, app-wide file may already exist if another external input anywhere in the composed app is Stubbed or Producer-present | not yet generated for this field — same shared-file caveat as the `bootstrap/stubs.ts` column | doesn't exist yet |
| **Stubbed** | A sync runs and finds no producer for the field | present, contains this field's `mint-<name>` | present, `DENO_ENV=production`-gated | exists, badged `stub` |
| **Producer-present** | A real producer for the field is now declared in the composed sources, but `rune sync` hasn't run since it landed | unchanged from Stubbed | unchanged from Stubbed | still only `mint-<name>` — compiling the producer and evaporating the stub happen in the same sync pass, so the running app never has both at once |
| **Evaporated** | The next sync runs and finds a producer | this field's `mint-<name>` endpoint is removed from the file | unchanged while any other input in the file is still Stubbed or Producer-present; the file's one registry entry is removed once no input in the file remains Stubbed or Producer-present — including when the remaining inputs are permanently-unfulfilled, which never contributed a stub and so don't keep the file alive (see Partial state below) | `mint-<name>` gone; only the real producer remains |

Two inputs diverge from that progression rather than passing through it in
order:

- **Produced from the start** — if a producer for the field is already
  declared in the composed sources the very first time sync discovers the
  field, the field never occupies Unfulfilled, Stubbed, or Producer-present:
  the first sync that sees it finds a producer immediately and it lands
  straight in Evaporated, so no `mint-<name>` is ever generated for it.
- **Permanently unfulfilled** — a `[TYP:ext]` field whose declared type is
  `Class`, a DTO, a generic, an array, or a union (the skip-stub set, defined
  above) occupies Unfulfilled and never leaves it: it never reaches Stubbed
  because no `mint-<name>` is ever minted for it, so it stays Unfulfilled
  indefinitely, across every sync, unless and until a real producer lands —
  at which point it jumps straight to Evaporated the same way a
  produced-from-the-start field does.

"Finds a producer" reuses the same static discovery the headless runner uses
to add its synthetic `$`-input dependency edges (see
[07-cake/04-the-headless-runner-exerciseendpoints-opts.md](../07-cake/04-the-headless-runner-exerciseendpoints-opts.md)):
the schemas' declared output fields, before any request fires, exact-field
producers considered before plural ones — an endpoint's declared output
owning the field's exact name, else the first such endpoint owning the
`name + "s"` plural whose first element supplies the value (scalars only — a
non-scalar first element yields nothing, no scan for a later scalar); echoes
never counting as producers either way. As with the runner's synthetic edge,
a candidate producer is excluded *relative to a given consumer* if it is that
consumer itself or already downstream of it — and a field can have more than
one consumer across the composition, each with its own downstream set, so a
producer downstream of one consumer can still be upstream (and eligible) for
another. Evaporation's field-level yes/no is the conjunction of that
per-consumer check across every consumer of the field: a field evaporates
only when *every one* of its consumers has at least one eligible producer
(excluding that consumer itself and anything downstream of it), so
evaporating the stub never strands a consumer whose only producer sits
downstream of it. The runner's further run-time tie-break among several
surviving candidates — earliest in run order — has no bearing here:
evaporation is a static yes/no per consumer (does an eligible producer exist
for this consumer), folded into a further static yes/no for the field (does
every consumer clear that check), not a choice among several.

Evaporation layers one more exclusion on top that the runner itself does
**not** apply: a field's own `mint-<name>` never counts as a producer of the
field it mints, so a stub can't keep itself alive. This is a separate check
from the runner's discovery, not the same self-exclusion reused — the runner
counts a stub's `mint-<name>` as a perfectly valid producer for *other*
consumer endpoints (that's exactly how a composed app whose real producer
doesn't exist yet still runs green end-to-end through the stub). Evaporation
adds the mint-exclusion on top of the reused discovery specifically to judge
whether *its own* field still needs the stub.

**Partial state** — `bootstrap/stubs.ts` is one file for the whole composed
app, not one per module (see the cross-module dedup rule below), and its
inputs evaporate one at a time, not in lockstep: the file and its registry
entry persist for as long as *any* `[TYP:ext]` input anywhere in the composed
app is still Stubbed or Producer-present, even after others have Evaporated.
The file's endpoint set at any point is exactly the union of `mint-<name>`
endpoints for every Stubbed and Producer-present input across the composed
app (a permanently-unfulfilled input never contributes one). Once no
`[TYP:ext]` input anywhere in the composed app remains Stubbed or
Producer-present — whether because every stub-eligible input has Evaporated,
or because every remaining input is permanently unfulfilled and so never
minted a stub in the first place — the next sync deletes `bootstrap/stubs.ts`
entirely and removes its registry entry; nothing references the file, so
nothing breaks when it goes. A permanently-unfulfilled input is untouched by
this either way: it stays Unfulfilled indefinitely regardless of whether the
file exists, since it never had a mint to keep alive or lose.
`DENO_ENV=production` exclusion (the Stubbed and Producer-present rows'
registry gate) means stubs can never ship regardless of which state an
individual input is in.

**Worked example — `memberId` from birth to evaporation:**

1. A module declares `[TYP:ext,uuid] memberId: string`; a consumer endpoint
   in the composed app binds `$memberId` and validates it with `@IsUUID()`
   at the seam.
2. **Sync 1** finds no producer for `memberId` anywhere in the composition:
   `bootstrap/stubs.ts` is generated with a `mint-memberId` endpoint (state
   Stubbed) returning `{ memberId: "00000000-0000-4000-8000-000000000000" }`
   — the `uuid` row of the constraint-modifier table above, not the bare
   `string` default, so the consumer's `@IsUUID()` check passes. The composed
   app now runs green end-to-end: the consumer's bind resolves through the
   stub.
3. A producer endpoint (say, `POST /members` whose response declares a
   `memberId` field) is added to another module's source. Until the next
   sync, `memberId` sits in Producer-present: the running app is unchanged
   from Stubbed — `mint-memberId` is still the only compiled endpoint that
   mints the field, since compiling the new producer and evaporating the
   stub happen in the same sync pass.
4. **Sync 2** compiles the producer and, applying the discovery rule above,
   finds it produces `memberId`: `memberId` transitions to Evaporated,
   `mint-memberId` is removed from `bootstrap/stubs.ts`. If `memberId` was
   the file's only unfulfilled input, the file and its registry entry are
   deleted entirely in the same pass — nothing referenced the file, so
   nothing breaks.

Two modules that each declare `[TYP:ext] memberId: string` (the same field
name) share **one** `mint-memberId` stub endpoint rather than each getting
their own: sync dedups by field name — one `mint-<name>` endpoint per unique
external-input name across the whole composed app. This matches the
producer-discovery rule above, which is itself keyed on field name across the
composition rather than per-module: two independent stubs for the same name
would let one evaporate while the other lingers, splitting one logical
external input into two.

Collapsing two modules' same-named external inputs into one mint only holds
together if both declarations agree on what's being minted: the dedup rule
assumes that every module declaring `[TYP:ext] memberId` gives it the same
primitive and the same constraint modifiers, since `mint-memberId` can only
mint one placeholder. Nothing enforces that agreement across modules —
`02-language/04`'s duplicate-name and same-signature-everywhere rules are
both scoped to a single file (they govern a `noun.verb` callee's signature
within the file that declares it), not to `[TYP:ext]` names repeated across
the composed app's separate modules.

Two modules declaring the same external-input name with conflicting types or
modifiers (e.g. module A's `[TYP:ext,uuid] memberId: string` vs. module B's
`[TYP:ext,int] memberId: number`) is a hard error at compose/sync time — the
same severity class as `[TYP]`'s own duplicate-name error — since silently
minting one module's placeholder for the other's differently-typed consumer
would pass seam validation for one module while quietly failing the other's.

`bootstrap/stubs.ts` is header-guarded: sync checks what's already sitting at
that path before writing, and a non-generated file there — hand-written or a
real module — disables ghost stubs rather than being overwritten:

| What's at `bootstrap/stubs.ts` | Wired into `modules`? | `DENO_ENV=production` gate? | Overwritten by sync? | Cake badge |
| --- | --- | --- | --- | --- |
| Generated ghost stub | Yes | Yes — excluded in production | Yes — regenerated every sync, tracking the state table above | `stub` |
| Hand-written, non-module `bootstrap/stubs.ts` | No — omitted from the registry entirely | No — the gate is generated only for the ghost | No — left untouched | none (never mounted) |
| Real module named `stubs` | Yes — registered like any other module | No — ungated | No — left untouched, same header-guard as above | none (registered like any other module; no `stub` badge) |

