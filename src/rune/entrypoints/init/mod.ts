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

// --- sprig UI: delegated to the sprig CLI --------------------------------------
//
// `rune init` no longer hand-rolls the sprig UI (serve.ts + app/ + a createRenderer
// bootstrap). sprig is CLI-compilation now — `sprig dev`/`sprig build` compile the
// templates and emit the client bundle into static/ — and the sprig CLI owns that
// scaffold: it writes serve.ts (serveSprig), src/ (the UI), bootstrap/mod.ts (an
// empty keep backend), and a deno.json pinned to ITS OWN @sprig/core + tracked
// @mrg-keystone/rune, with `dev = sprig dev` / `build = sprig build` tasks. So the
// UI half has ONE owner (sprig) and never drifts against a stale hand-copied pin.
//
// rune init runs `sprig init <dir>` for the UI, then OVERLAYS its spec-driven keep
// backend: it replaces sprig's empty bootstrap/mod.ts with the registry-driven one
// (`renderMain`, whose `api` export the sprig-written serve.ts already imports, and
// whose `import.meta.main` listen keeps `rune dev` a backend-only loop), adds the
// module registry + config + the spec/ layout, and merges rune's engine import map
// into sprig's deno.json (additive — sprig already pins @mrg-keystone/rune).

/** Locations to look for the installed sprig CLI: PATH first, then the default
 *  `deno install` bin. sprig's compiler/scaffold need the on-disk runtime (~/.sprig),
 *  so it can't be run straight from `jsr:` — it must be `sprig install`ed first. */
function sprigCandidates(): string[] {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  return ["sprig", ...(home ? [join(home, ".deno", "bin", "sprig")] : [])];
}

/** Run the installed sprig CLI's `init` to scaffold the UI half. Returns the
 *  captured output; `missing` when no sprig binary is installed (→ guidance),
 *  `ok=false` when sprig ran but failed. */
async function runSprigInit(
  dir: string,
): Promise<{ ok: boolean; output: string; missing: boolean }> {
  for (const bin of sprigCandidates()) {
    let out: Deno.CommandOutput;
    try {
      out = await new Deno.Command(bin, {
        args: ["init", dir],
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue; // try the next candidate
      return {
        ok: false,
        output: e instanceof Error ? e.message : String(e),
        missing: false,
      };
    }
    const dec = new TextDecoder();
    return {
      ok: out.success,
      output: dec.decode(out.stdout) + dec.decode(out.stderr),
      missing: false,
    };
  }
  return { ok: false, output: "", missing: true };
}

/** Overlay rune's spec-driven keep backend onto a scaffolded sprig app (a dir the
 *  sprig CLI already populated with serve.ts + src/ UI + a deno.json + an empty
 *  bootstrap/mod.ts). Pure filesystem — exported so it can be tested against a
 *  fixture sprig scaffold without shelling out to the sprig CLI. Additive to
 *  sprig's deno.json (never clobbers its keys); replaces sprig's empty bootstrap
 *  backend with the registry-driven one and lays down the spec/ authoring layout. */
export async function overlayRuneBackend(
  dir: string,
  appName: string,
  ioErrors: string[],
): Promise<void> {
  // Merge rune's engine import map into the deno.json sprig wrote (additive —
  // sprig already pins @mrg-keystone/rune, so this only ADDS @/, class-validator/
  // -transformer, #std, #assert, #api-doc, etc.).
  await ensureImportMap(dir, ioErrors);

  // bootstrap/ — replace sprig's empty keep backend with the registry-driven one.
  // `renderMain` exports the same `api` the sprig-written serve.ts imports, and its
  // `import.meta.main` listen keeps `rune dev` a backend-only loop. modules.ts is
  // the GENERATED registry `rune sync` rewrites as [ENT] surfaces are added.
  await Deno.mkdir(join(dir, "bootstrap"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "bootstrap", "modules.ts"),
    renderAppRegistry([]),
  );
  await Deno.writeTextFile(join(dir, "bootstrap", "config.ts"), renderConfig());
  await Deno.writeTextFile(
    join(dir, "bootstrap", "mod.ts"),
    renderMain(appName),
  );

  // spec/ — the authored layout: runes/ (specs you edit + sync), misc/ (data +
  // cake artifacts), ui/ (the sprig UI prototype + design system).
  await Deno.mkdir(join(dir, "spec", "runes"), { recursive: true });
  await Deno.mkdir(join(dir, "spec", "misc"), { recursive: true });
  await Deno.mkdir(join(dir, "spec", "ui"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "spec", "runes", "core.rune"),
    CORE_TEMPLATE,
  );
}

// `rune init <project-name>` — scaffold a fresh sprig + keep app. The UI half
// (serve.ts, src/ UI, deno.json pins, `sprig dev`/`sprig build` tasks) is scaffolded
// by the sprig CLI; rune overlays its spec-driven keep backend (bootstrap/ + the
// spec/ layout) on top. It does NOT generate module code — author module specs under
// spec/runes/ (e.g. spec/runes/tasks.rune) and run `rune sync spec/runes/tasks.rune`
// to generate them into src/tasks/; sync then moves the spec in beside its code
// (src/tasks/tasks.rune). The bootstrap files come from the SAME renderers `rune sync`
// uses, so they're byte-identical to engine output; bootstrap/modules.ts starts empty
// and sync fills it in as modules with [ENT] surfaces are generated.
export async function runInit(args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("Usage: rune init <project-name>");
    return 2;
  }
  if (
    name.includes("/") || name.includes("\\") || name === "." || name === ".."
  ) {
    console.error(
      `${RED}error: '${name}' is not a valid project name (it becomes a directory).${RESET}`,
    );
    return 2;
  }

  const dir = resolve(name);
  // Refuse an existing target — `sprig init <dir>` refuses one too (it must create
  // the dir), so reject up front with a clearer message than sprig's.
  try {
    await Deno.stat(dir);
    console.error(
      `${RED}error: ${name}/ already exists — choose a new name or remove it first.${RESET}`,
    );
    return 2;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(
        `${RED}error: cannot use ${name}/: ${
          e instanceof Error ? e.message : e
        }${RESET}`,
      );
      return 2;
    }
    // NotFound → fresh directory; sprig init creates it below.
  }

  // keep's app name: the project dir, normalized to a slug.
  const appName = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";

  // 1) Delegate the UI half to the sprig CLI (it owns the UI, the client
  //    compilation via `sprig dev`/`sprig build`, and the @sprig/@rune pins).
  const sprig = await runSprigInit(dir);
  if (sprig.missing) {
    console.error(
      `${RED}rune init needs the sprig CLI to scaffold the UI (sprig is CLI-compilation now).${RESET}\n` +
        `  Install it once:  ${BOLD}deno run -A jsr:@sprig/core/cli install${RESET}\n` +
        `  then re-run:      ${BOLD}rune init ${name}${RESET}`,
    );
    return 2;
  }
  if (!sprig.ok) {
    console.error(
      `${RED}rune init: 'sprig init ${name}' failed:${RESET}\n${sprig.output.trimEnd()}`,
    );
    return 1;
  }

  // 2) Overlay rune's spec-driven keep backend onto the sprig app.
  const ioErrors: string[] = [];
  try {
    await overlayRuneBackend(dir, appName, ioErrors);
  } catch (e) {
    console.error(
      `${RED}error: could not overlay the rune backend onto ${name}/: ${
        e instanceof Error ? e.message : e
      }${RESET}`,
    );
    return 1;
  }
  if (ioErrors.length) {
    for (const e of ioErrors) console.error(`${RED}${e}${RESET}`);
    return 1;
  }

  const row = (path: string, desc: string) => `  ${path.padEnd(22)} ${desc}`;
  console.log(
    `${GREEN}${BOLD}✓ Created ${name}/${RESET} ${DIM}— sprig UI (via sprig init) + rune keep backend${RESET}
${DIM}${
      row(
        "deno.json",
        "@sprig/core + @mrg-keystone/rune; tasks: dev=sprig dev, build=sprig build",
      )
    }
${
      row(
        "serve.ts",
        "serveSprig composition root — UI /ui, backend /api + /docs  [sprig]",
      )
    }
${
      row(
        "src/",
        "sprig UI (mod.ts, pages/home, shell); rune modules land here on sync",
      )
    }
${
      row(
        "bootstrap/",
        "keep backend wiring (bootstrapServer); modules.ts fills in on sync",
      )
    }
${
      row(
        "spec/runes/core.rune",
        "shared-services spec — add module specs beside it",
      )
    }
${row("spec/misc/", "data design (data.json) + cake artifacts (cake.json)")}
${row("spec/ui/", "UI prototype + design system (sprig output)")}${RESET}

Next:
  ${BOLD}cd ${name}${RESET}
  ${BOLD}deno task dev${RESET}                            ${DIM}# sprig HMR dev → http://localhost:8000/ui (compiles the client)${RESET}
  ${DIM}# draft a module spec under spec/runes/ as a work-in-progress (.in-prog.rune),${RESET}
  ${DIM}# which dev/run-all skip; iterate with rune check, then sync to scaffold:${RESET}
  ${BOLD}rune sync spec/runes/tasks.in-prog.rune${RESET}  # generate into src/tasks/ (draft stays in spec/runes/)
  ${BOLD}rune sync spec/runes/core.rune${RESET}           # generate the shared service clients
  ${DIM}# read it from a page with inject(Backend) in src/pages/<p>/logic.ts (in-process)${RESET}
`,
  );
  return 0;
}
