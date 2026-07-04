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

// --- sprig UI scaffold ---------------------------------------------------------
//
// `rune init` scaffolds the WHOLE app: the keep backend (bootstrap/ + src/<module>)
// AND a native sprig UI that runs ON the backend — composed by serveSprig() behind
// ONE `{ fetch }` handler that `deno serve` drives (no Deno.serve of our own). The
// keep in-process client is bound to sprig's Backend DI token, so a page's
// resolve.ts reads data with no TCP and no token; only browser islands use /api/*.

// Import-map + task additions the sprig UI needs (merged into deno.json on init,
// never on sync — the UI layer is init-only). `@sprig/keep` is @sprig/core's
// server-side `./keep` subpath (serveSprig + createRenderer).
const SPRIG_IMPORTS: Record<string, string> = {
  "@sprig/core": "jsr:@sprig/core@^0.12",
  "@sprig/keep": "jsr:@sprig/core/keep",
  "@std/path": "jsr:@std/path@^1",
};
const SPRIG_TASKS: Record<string, string> = {
  // Deno owns the listener; serveSprig is the default-export { fetch }.
  "start": "deno serve -A --unstable-kv serve.ts",
  "dev": "deno serve -A --unstable-kv --watch serve.ts",
};

const HOME_TEMPLATE = `<main class="home">
  <h1>{{ title }}</h1>
  <p>{{ message }}</p>
</main>
`;

const HOME_RESOLVE = `import { type Resolve } from "@sprig/core";

// resolve() runs on the SERVER before render; its returned object is the page's
// template scope. To read your keep backend IN-PROCESS (no HTTP, no token), inject
// the Backend client bound by serveSprig:
//   import { inject, Backend } from "@sprig/core";
//   const { ok, data } = await inject(Backend).get("/<module>/<endpoint>");
export const resolve: Resolve = () => ({
  title: "sprig + rune",
  message: "Edit app/src/pages/home. Add a backend module with \`rune sync spec/runes/<m>.rune\`.",
});
`;

/** serve.ts — the single-origin composition root (created once, dev-owned). */
function renderServe(): string {
  return [
    "// Single-origin composition root: serveSprig() folds the keep backend and the",
    "// sprig UI into ONE { fetch } handler. Deno owns the listener — there is no",
    "// Deno.serve() here:  deno serve -A --unstable-kv serve.ts",
    "//",
    "//   /api/* and /docs*  → the keep backend's token-gated NETWORK handler.",
    "//   everything else    → the sprig SSR app, with the keep IN-PROCESS client bound",
    "//                        to the Backend DI token (resolve.ts reads data, no token).",
    'import { serveSprig } from "@sprig/keep";',
    'import { api } from "@/bootstrap/mod.ts";',
    'import { app } from "@/app/src/main.ts";',
    "",
    'export default serveSprig({ keep: api, app, base: "" });',
    "",
  ].join("\n");
}

/** app/src/main.ts — the sprig UI bootstrap (created once, dev-owned). */
function renderAppMain(): string {
  return [
    "// The sprig UI: the route table + the app. Each page's resolve.ts reads data",
    "// in-process via inject(Backend) (the keep backend, bound by serveSprig) — no TCP,",
    "// no token. The SSR renderer renders the matched folder-component into the shell.",
    'import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";',
    'import { createRenderer, type SsrRenderer } from "@sprig/keep";',
    'import { dirname, fromFileUrl } from "@std/path";',
    "",
    "export const routes: Route[] = defineRoutes([",
    '  { path: "", load: "./pages/home" },',
    "]);",
    "",
    "// Scan app/src for folder-components and build the SSR renderer (once, at boot).",
    "export const renderer: SsrRenderer = await createRenderer(",
    "  dirname(fromFileUrl(import.meta.url)),",
    '  "",',
    '  { dev: !!Deno.env.get("SPRIG_DEV") },',
    ");",
    "",
    'export const app: SprigApp = bootstrap({ routes, base: "", renderer });',
    "",
  ].join("\n");
}

/** Merge the sprig UI's imports + tasks into the deno.json `ensureImportMap`
 * already created. Additive: never clobbers a value the user set. */
async function addSprigToConfig(dir: string, ioErrors: string[]): Promise<void> {
  const path = join(dir, "deno.json");
  try {
    const raw = (await Deno.readTextFile(path)).replace(/^﻿/, "");
    // deno-lint-ignore no-explicit-any
    const config: Record<string, any> = JSON.parse(raw);
    const imports = (config.imports && typeof config.imports === "object") ? config.imports : {};
    for (const [k, v] of Object.entries(SPRIG_IMPORTS)) if (!(k in imports)) imports[k] = v;
    config.imports = imports;
    const tasks = (config.tasks && typeof config.tasks === "object") ? config.tasks : {};
    for (const [k, v] of Object.entries(SPRIG_TASKS)) if (!(k in tasks)) tasks[k] = v;
    config.tasks = tasks;
    await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
  } catch (e) {
    ioErrors.push(`deno.json (sprig wiring): ${e instanceof Error ? e.message : e}`);
  }
}

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
    await Deno.mkdir(join(dir, "app", "src", "pages", "home"), { recursive: true }); // sprig UI

    // The authored shared-services spec — the source of truth you edit + sync.
    await Deno.writeTextFile(join(dir, "spec", "runes", "core.rune"), CORE_TEMPLATE);

    // deno.json — the import map the generated code needs (same writer as sync).
    await ensureImportMap(dir, ioErrors);

    // bootstrap/ — dev-owned runtime wiring + an empty module registry that
    // `rune sync` updates (header-guarded) as [ENT] surfaces are generated.
    await Deno.writeTextFile(join(dir, "bootstrap", "modules.ts"), renderAppRegistry([]));
    await Deno.writeTextFile(join(dir, "bootstrap", "config.ts"), renderConfig());
    await Deno.writeTextFile(join(dir, "bootstrap", "mod.ts"), renderMain(appName));

    // sprig UI composition: serve.ts (the serveSprig root) + the app/ tree, plus
    // the @sprig imports + the `deno serve serve.ts` start task in deno.json.
    await Deno.writeTextFile(join(dir, "serve.ts"), renderServe());
    await Deno.writeTextFile(join(dir, "app", "src", "main.ts"), renderAppMain());
    await Deno.writeTextFile(join(dir, "app", "src", "pages", "home", "template.html"), HOME_TEMPLATE);
    await Deno.writeTextFile(join(dir, "app", "src", "pages", "home", "resolve.ts"), HOME_RESOLVE);
    await addSprigToConfig(dir, ioErrors);
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
${DIM}${row("deno.json", "import map: @mrg-keystone/rune + @sprig/core; start = deno serve serve.ts")}
${row("serve.ts", "serveSprig composition root — the keep backend + sprig UI, one { fetch }")}
${row("app/src/", "sprig UI: main.ts (routes + renderer) + pages/home (starter page)")}
${row("spec/runes/core.rune", "shared-services spec — add module specs beside it")}
${row("spec/misc/", "data design (data.json) + cake artifacts (cake.json)")}
${row("spec/ui/", "UI prototype + design system (sprig output)")}
${row("src/", "empty — rune sync generates backend modules here")}
${row("bootstrap/", "keep backend wiring (bootstrapServer); modules.ts fills in on sync")}${RESET}

Next:
  ${BOLD}cd ${name}${RESET}
  ${BOLD}deno task start${RESET}                          ${DIM}# run the app (sprig UI at /, backend at /api + /docs)${RESET}
  ${DIM}# draft a module spec under spec/runes/ as a work-in-progress (.in-prog.rune),${RESET}
  ${DIM}# which dev/run-all skip; iterate with rune check, then sync to scaffold:${RESET}
  ${BOLD}rune sync spec/runes/tasks.in-prog.rune${RESET}  # generate into src/tasks/ (draft stays in spec/runes/)
  ${BOLD}rune sync spec/runes/core.rune${RESET}           # generate the shared service clients
  ${DIM}# read it from a page with inject(Backend) in app/src/pages/<p>/resolve.ts (in-process)${RESET}
`);
  return 0;
}
