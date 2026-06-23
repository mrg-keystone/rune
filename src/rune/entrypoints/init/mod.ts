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

// This is a rune project. You author tiny .rune specs (here in spec/), and
// "rune sync spec/<m>.rune" generates a typed, validated Deno module into
// src/<m>/ — routed endpoints, auto Swagger, an interactive "cake" at /docs.
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
// layout: the import map (deno.json), the shared-services spec (spec/core.rune),
// an empty src/ for generated code, and the runtime wiring (bootstrap/). It does
// NOT generate module code — author module specs under spec/ (e.g. spec/tasks.rune)
// and run `rune sync spec/tasks.rune` to generate them into src/tasks/; the specs
// stay in spec/. deno.json and the bootstrap files come from the SAME renderers
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
    await Deno.mkdir(join(dir, "spec"), { recursive: true });
    await Deno.mkdir(join(dir, "src"), { recursive: true }); // empty — codegen lands here
    await Deno.mkdir(join(dir, "bootstrap"), { recursive: true });

    // The authored shared-services spec — the source of truth you edit + sync.
    await Deno.writeTextFile(join(dir, "spec", "core.rune"), CORE_TEMPLATE);

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

  const row = (path: string, desc: string) => `  ${path.padEnd(20)} ${desc}`;
  console.log(`${GREEN}${BOLD}✓ Created ${name}/${RESET}
${DIM}${row("deno.json", "import map: jsr:@mrg-keystone/rune@^1, #assert, decorators")}
${row("spec/core.rune", "shared-services spec — add module specs beside it")}
${row("src/", "empty — rune sync generates modules here")}
${row("bootstrap/", "runtime wiring (bootstrapServer); modules.ts fills in on sync")}${RESET}

Next:
  ${BOLD}cd ${name}${RESET}
  ${DIM}# draft a module spec under spec/ as a work-in-progress (.in-prog.rune),${RESET}
  ${DIM}# which dev/run-all skip; iterate with rune check, then sync to scaffold:${RESET}
  ${BOLD}rune sync spec/tasks.in-prog.rune${RESET}  # generate into src/tasks/ (the spec stays in spec/)
  ${BOLD}rune sync spec/core.rune${RESET}           # generate the shared service clients
  ${DIM}# fill the stub bodies + \`deno check\`; finalize by renaming the draft to${RESET}
  ${DIM}# spec/tasks.rune, then \`rune dev\` picks it up and iterates live${RESET}
`);
  return 0;
}
