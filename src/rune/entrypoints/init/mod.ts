import { basename, join, resolve } from "#std/path";
import {
  ensureImportMap,
  renderAppRegistry,
  renderConfig,
  renderMain,
} from "@rune/entrypoints/sync/mod.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// The starter module the project ships with — a concrete two-endpoint slice
// (create + complete) that exercises the whole shape: DTOs, a coordinator, a
// business feature, a `db:` boundary (resolved from core.rune below), and `[ENT]`
// HTTP surfaces. It is a SPEC only; `rune sync` turns it into code. Replace it
// with your own modules.
const MODULE = "tasks";

const CORE_TEMPLATE = `[MOD] core

// Shared services — declare each one ONCE here; every module resolves its
// boundary calls (db:...) from this spec. Each [SRV] generates a shared client
// under src/core/data/<name>/, which the per-noun data adapters import.

[SRV] (SIDECAR)db: DB_URL
    the project's primary datastore (sidecar)
    @docs https://docs.example.com/datastore
`;

const MODULE_TEMPLATE = `[MOD] tasks

// A starter module — replace it with your own. One [MOD] per deployable surface.
// The loop: edit this spec -> \`rune sync\` (or \`rune dev\`) -> fill the stub
// bodies -> open /docs/tasks (the cake) and walk the endpoints to green.

[ENT] http.create(CreateTaskDto): TaskDto
[ENT] http.complete(TaskRefDto): TaskDto

[REQ] task.create(CreateTaskDto): TaskDto
    id::generate(): id
    [NEW] task
    task.fill(title): task
    db:task.save(TaskDto): void
      timeout
    task.toDto(): TaskDto

[REQ] task.complete(TaskRefDto): TaskDto
    db:task.load(id): TaskDto
      not-found
    task.markDone(): task
    db:task.save(TaskDto): void
      timeout
    task.toDto(): TaskDto

[TYP] id: string
    a unique task identifier
[TYP] title: string
    the human-readable task title
[TYP] done: boolean
    whether the task has been completed

[DTO] CreateTaskDto: title
    input to create a new task
[DTO] TaskRefDto: id
    a reference to an existing task
[DTO] TaskDto: id, title, done
    a persisted task record

[NON] task
    a single todo item
`;

// `rune init <project-name>` — scaffold a fresh project SKELETON: the import map
// (deno.json), the shared-services spec (src/core/core.rune), a starter module
// spec (src/<module>/<module>.rune), and the runtime wiring (bootstrap/). It does
// NOT generate module code — that's `rune sync`'s job — so what you get is exactly
// the files you author plus the boilerplate, and nothing else. deno.json and the
// bootstrap files come from the SAME renderers `rune sync` uses, so they're
// byte-identical to what the engine produces; bootstrap/modules.ts starts empty
// and `rune sync` fills it in as modules with [ENT] surfaces are generated.
export async function runInit(args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("Usage: rune init <project-name>");
    return 2;
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    console.error(`${RED}error: '${name}' is not a valid project name (it becomes a directory).${RESET}`);
    return 2;
  }

  const dir = resolve(name);
  // Refuse to scribble into a non-empty existing directory.
  try {
    for (const _ of Deno.readDirSync(dir)) {
      console.error(`${RED}error: ${name}/ already exists and is not empty.${RESET}`);
      return 2;
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`${RED}error: cannot use ${name}/: ${e instanceof Error ? e.message : e}${RESET}`);
      return 2;
    }
    // NotFound → fresh directory, created below.
  }

  // keep's app name: the project dir, normalized to a slug.
  const appName = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";

  const ioErrors: string[] = [];
  try {
    await Deno.mkdir(join(dir, "src", "core"), { recursive: true });
    await Deno.mkdir(join(dir, "src", MODULE), { recursive: true });
    await Deno.mkdir(join(dir, "bootstrap"), { recursive: true });

    // Specs (authored — the source of truth you edit + sync).
    await Deno.writeTextFile(join(dir, "src", "core", "core.rune"), CORE_TEMPLATE);
    await Deno.writeTextFile(join(dir, "src", MODULE, `${MODULE}.rune`), MODULE_TEMPLATE);

    // deno.json — the import map the generated code needs (same writer as sync).
    await ensureImportMap(dir, ioErrors);

    // bootstrap/ — dev-owned runtime wiring + an empty module registry that
    // `rune sync` updates (header-guarded) as [ENT] surfaces are generated.
    await Deno.writeTextFile(join(dir, "bootstrap", "modules.ts"), renderAppRegistry([]));
    await Deno.writeTextFile(join(dir, "bootstrap", "config.ts"), renderConfig());
    await Deno.writeTextFile(join(dir, "bootstrap", "mod.ts"), renderMain(appName));
  } catch (e) {
    console.error(`${RED}error: could not scaffold ${name}/: ${e instanceof Error ? e.message : e}${RESET}`);
    return 1;
  }
  if (ioErrors.length) {
    for (const e of ioErrors) console.error(`${RED}${e}${RESET}`);
    return 1;
  }

  const row = (path: string, desc: string) => `  ${path.padEnd(22)} ${desc}`;
  console.log(`${GREEN}${BOLD}✓ Created ${name}/${RESET}
${DIM}${row("deno.json", "import map: jsr:@mrg-keystone/rune@^1, #assert, decorators")}
${row("src/core/core.rune", "shared services spec (the db: client)")}
${row(`src/${MODULE}/${MODULE}.rune`, "a starter module spec — replace it with your own")}
${row("bootstrap/", "runtime wiring (bootstrapServer); modules.ts fills in on sync")}${RESET}

Next:
  ${BOLD}cd ${name}${RESET}
  ${BOLD}rune sync src/core/core.rune${RESET}        # generate the shared service clients
  ${BOLD}rune sync src/${MODULE}/${MODULE}.rune${RESET}      # generate the module (DTOs, coordinators, endpoints)
  ${DIM}# then fill the stub bodies, \`deno check\`, and \`rune dev\` to iterate live${RESET}
`);
  return 0;
}
