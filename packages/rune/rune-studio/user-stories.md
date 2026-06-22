# User stories — Rune Studio

A running list of what a user can actually _do_. Each was verified by driving
the real app in a browser (Playwright) against a freshly-started
`deno task dev`.

- Visit `/` and see the studio SSR'd: masthead, the spec editor, and the keyword
  panel render server-side (HTTP 200, no JS required for first paint).
- Edit the `.rune` spec on the left and see live, registry-driven syntax
  highlighting (tags, nouns, verbs, DTOs, faults, builtins, comments).
- See live diagnostics in the strip below the editor (line length, tag indent);
  click a diagnostic to jump the cursor to it.
- Edit a keyword in the Keywords tab — change its **tag literal** and the editor
  instantly stops/starts recognising it (rename `[REQ]`→`[RQX]` → `[REQ]` loses
  its colour).
- Change a keyword's **colour** and every occurrence in the editor recolours
  instantly.
- Change a keyword's **indent / follows / label / docs**; add or delete
  keywords; edit boundary prefixes and token colours.
- Open **⚙ code template** on a keyword and toggle "generates code" on/off — a
  keyword may or may not emit code. Turning `[TYP]` off removes the `types/`
  files from the output.
- Edit a keyword's **path/body template** and watch the Generated code tab
  update live (add `// @generated` to the `[DTO]` template → every generated DTO
  file shows it).
- Open the **Generated code** tab to see the `dist.rune/` tree produced from the
  templates, click any file to view it. Status shows which keywords emit code.
- Click **compare with rune binary** to fetch the reference output from the real
  compiled `rune generate` binary via `/api/generate` (needs the binary built).
- Use the top-bar buttons to view the live **keywords.json**, generated
  **grammar.js**, and **highlights.scm** for the current keyword set.

## Not yet covered (follow-ups)

- A formal Playwright test file checked into the repo (these stories were
  verified interactively, not yet codified as an automated suite).
- The analyzer/grammar are still derived only for syntax + highlighting +
  templates; semantic validation rules aren't registry-driven yet.
