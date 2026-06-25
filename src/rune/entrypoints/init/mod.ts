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

const CORE_TEMPLATE = `[MOD] core

// This is a rune project. You author tiny .rune specs (here in spec/runes/),
// and "rune sync spec/runes/<m>.rune" generates a typed, validated Deno module
// into src/<m>/ AND moves the spec in beside its code (src/<m>/<m>.rune) —
// routed endpoints, auto Swagger, an interactive "cake" at /docs. The sibling
// spec/misc/ holds data design + cake artifacts; spec/ui/ holds the UI prototype.
// The generated code runs on rune's runtime, @mrg-keystone/rune (on JSR).
//
// Working with an AI assistant (Claude Code)? Have it use the "rune" skill —
// it knows the spec syntax, the lifecycle, and the runtime's rules. The rune
// installer puts it at ~/.claude/skills/rune ("rune update" refreshes it).
//
// core.rune holds the project's SHARED SERVICES. Declare each ONCE; every
// module resolves its boundary calls against this spec, and each [SRV]
// generates a client under src/core/data/<name>/. Add one when you need it:
//   [SRV] (SIDECAR)<name>: <ENV_VAR>
//       one-line description
//       @docs <url>
`;

// `rune init <project-name>` — scaffold a fresh project SKELETON in the spec/
// layout: the import map (deno.json), the shared-services spec
// (spec/runes/core.rune), the sibling staging dirs (spec/misc/ for data + cake
// artifacts, spec/ui/ for the UI prototype), an empty src/ for generated code,
// and the runtime wiring (bootstrap/). It does NOT generate module code — author
// module specs under spec/runes/ (e.g. spec/runes/tasks.rune) and run
// `rune sync spec/runes/tasks.rune` to generate them into src/tasks/; sync then
// moves the spec in beside its code (src/tasks/tasks.rune). deno.json and the
// bootstrap files come from the SAME renderers
// `rune sync` uses, so they're byte-identical to engine output; bootstrap/modules.ts
// starts empty and sync fills it in as modules with [ENT] surfaces are generated.
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
    await Deno.mkdir(join(dir, "spec", "runes"), { recursive: true }); // authored .rune specs
    await Deno.mkdir(join(dir, "spec", "misc"), { recursive: true }); // data design + cake artifacts
    await Deno.mkdir(join(dir, "spec", "ui"), { recursive: true }); // sprig UI prototype + design
    await Deno.mkdir(join(dir, "src"), { recursive: true }); // empty — codegen lands here
    await Deno.mkdir(join(dir, "bootstrap"), { recursive: true });

    // The authored shared-services spec — the source of truth you edit + sync.
    await Deno.writeTextFile(join(dir, "spec", "runes", "core.rune"), CORE_TEMPLATE);

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
${row("spec/runes/core.rune", "shared-services spec — add module specs beside it")}
${row("spec/misc/", "data design (data.json) + cake artifacts (cake.json)")}
${row("spec/ui/", "UI prototype + design system (sprig output)")}
${row("src/", "empty — rune sync generates modules here")}
${row("bootstrap/", "runtime wiring (bootstrapServer); modules.ts fills in on sync")}${RESET}

Next:
  ${BOLD}cd ${name}${RESET}
  ${DIM}# draft a module spec under spec/runes/ as a work-in-progress (.in-prog.rune),${RESET}
  ${DIM}# which dev/run-all skip; iterate with rune check, then sync to scaffold:${RESET}
  ${BOLD}rune sync spec/runes/tasks.in-prog.rune${RESET}  # generate into src/tasks/ (draft stays in spec/runes/)
  ${BOLD}rune sync spec/runes/core.rune${RESET}           # generate the shared service clients
  ${DIM}# fill the stub bodies + \`deno check\`; finalize by renaming the draft to${RESET}
  ${DIM}# spec/runes/tasks.rune — sync then moves it in beside its code (src/tasks/tasks.rune)${RESET}
`);
  return 0;
}
