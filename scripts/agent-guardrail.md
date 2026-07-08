## Never crawl the filesystem for framework source

Your `find` is Claude Code's bundled **bfs** (multithreaded). A search rooted at `/`
(`find / …`, or a whole-disk `grep -r … /`) fans out across the entire volume and pegs
several cores for minutes — and it is **never** the right way to locate rune/keep
internals. **Do not run `find /` or any whole-disk search.** Everything agents have
historically crawled the disk for is already at hand:

- **The rune/keep contract** — `#assert`, `RuneAssertError`→HTTP 422, the
  `assert.string` / `.number` / `.boolean` / `.uint8Array` helpers, `RUNE_ASSERT=off`,
  the `// unvalidated:` cast rule, `bootstrapServer`, `@Endpoint`, `HttpException`,
  `getIdentity`, heal-rules — is documented in the skill references installed alongside
  you. Read them directly instead of hunting the source:
  - `~/.claude/skills/rune:spec/references/constraints.md` — the assert contract & seams
  - `~/.claude/skills/rune:framework/references/{endpoints,auth,deployment}.md` — runtime,
    bootstrap, auth, and error mapping
- **To resolve an import alias** (e.g. `#assert`): read the PROJECT's `deno.json` `imports`
  map — the alias is defined there and nowhere else. Never search for it.
- **To find a cached/vendored dependency's real `.ts`:** run `deno info <specifier>` (e.g.
  `deno info jsr:@mrg-keystone/rune`) — it prints the exact cached path in milliseconds. If
  you must grep vendored source, scope the search to that path or to
  `~/Library/Caches/deno`, never `/`.
- **Playwright screenshots / console logs** land in `~/Library/Caches/ms-playwright-mcp/`
  and the project's `.playwright-mcp/` — look there, don't crawl for the file.

If something genuinely isn't in the project or the caches above, say so and ask — do not
escalate to a root-wide `find`.
