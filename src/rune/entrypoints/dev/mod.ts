import { join, relative, resolve } from "#std/path";
import { isProjectSpec } from "@rune/domain/business/rune-bindings/mod.ts";
import { planManifest } from "@rune/domain/business/rune-manifest/mod.ts";
import { runSync } from "@rune/entrypoints/sync/mod.ts";
import {
  coreSpecExists,
  loadCoreSrvs,
  resolveRoot,
} from "@rune/entrypoints/spec-root.ts";
import {
  attachShared,
  type DevLockEntry,
  devLockPath,
  DevLog,
  MAX_LOG_FILES,
  pidAlive,
  readDevLock,
  reapOrphanChild,
  repoKey,
  runeStateRoot,
  writeChildPid,
  writeDevLock,
} from "@rune/entrypoints/dev/registry.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// `rune dev [path]` — the live spec→emulator loop. Watches the project; on save:
//   spec changed   → check → (errors? publish them to the status file — the last
//                    good server keeps serving) → sync → restart the app
//   source changed → restart the app (no sync)
// The app boots under KEEP_DEV=<status file>, so keep serves /docs/_dev and the
// emulator pages reload themselves when the bootId changes (session state lives
// in localStorage and survives). The pure cycle pieces below (path classification,
// suppression set, cycle planning) are exported for unit tests; the process/watch
// glue stays thin.

const DEBOUNCE_MS = 200;
// How long a path sync wrote stays muted AFTER the cycle that wrote it ends.
const SUPPRESS_TAIL_MS = 2000;

// ---- pure cycle pieces (unit-tested in test.ts) -------------------------------

/** Classify one FS event path (relative to the project root) for the dev loop. */
export function classifyPath(rel: string): "ignored" | "spec" | "source" {
  if (rel === "" || rel === ".") return "ignored";
  const parts = rel.split("/");
  // Dotfiles anywhere in the path (.DS_Store, .git, editor droppings) and paths
  // outside the root ("../…" after relative()) never drive a cycle.
  if (parts.some((p) => p === "" || p.startsWith("."))) return "ignored";
  // A .rune that is NOT a project spec — a doc, a vendored spec, or a
  // `.in-prog.rune` draft — never drives a cycle: it neither syncs nor restarts
  // the app, keeping work-in-progress drafts isolated from the running app.
  if (rel.endsWith(".rune")) return isProjectSpec(rel) ? "spec" : "ignored";
  return "source";
}

/** Mute `paths` until `expiresAt` — sync's own writes must not re-trigger the
 * loop. A later, longer suppression wins over an earlier one. */
export function addSuppressions(
  set: Map<string, number>,
  paths: string[],
  expiresAt: number,
): void {
  for (const p of paths) {
    if (expiresAt > (set.get(p) ?? 0)) set.set(p, expiresAt);
  }
}

/** Is `path` currently muted? Expired entries are pruned as they are seen. */
export function isSuppressed(
  set: Map<string, number>,
  path: string,
  now: number,
): boolean {
  const expiresAt = set.get(path);
  if (expiresAt === undefined) return false;
  if (now > expiresAt) {
    set.delete(path);
    return false;
  }
  return true;
}

export interface CyclePlan {
  /** Changed project specs (root-relative), deduped + sorted: check → sync each. */
  specs: string[];
  /** A non-spec source file changed → the app restarts even with no spec work. */
  restart: boolean;
}

/** Decide what a cycle must do for a batch of changed root-relative paths.
 * Null = nothing actionable (the batch was all noise) — no cycle fires. */
export function planCycle(relPaths: string[]): CyclePlan | null {
  const specs = new Set<string>();
  let restart = false;
  for (const rel of relPaths) {
    const kind = classifyPath(rel);
    if (kind === "spec") specs.add(rel);
    else if (kind === "source") restart = true;
  }
  if (specs.size === 0 && !restart) return null;
  return { specs: [...specs].sort(), restart };
}

// ---- the watcher/orchestrator -------------------------------------------------

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// A watched .rune path can VANISH between the FS event and the cycle that
// handles it — moved into its module by a sync (the `spec/` → `src/<module>/`
// relocation) or deleted by the author. Such a path is a REMOVAL, not a spec to
// read, so the cycle drops it instead of reporting a (false) read error.
async function specExists(abs: string): Promise<boolean> {
  try {
    await Deno.stat(abs);
    return true;
  } catch {
    return false;
  }
}

// The same parse + rules `rune check` runs, returning the error strings instead
// of printing them — they travel to the page banner via the status file.
async function checkSpec(root: string, rel: string): Promise<string[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(root, rel));
  } catch (e) {
    return [`${rel}: cannot read spec: ${errMessage(e)}`];
  }
  const sharedSrvs = await loadCoreSrvs(root, join(root, rel));
  const coreSpecFound = await coreSpecExists(root, join(root, rel));
  return planManifest(rel, text, new Set<string>(), {
    strictServices: true,
    projectRoot: root,
    coreSpecFound,
  }, sharedSrvs).errors;
}

export async function runDev(args: string[]): Promise<number> {
  const target = resolve(args[0] ?? ".");
  // A .rune path means "dev the project that owns this spec" — same root rule as
  // sync — but the loop always operates project-wide from that root.
  let root = target.endsWith(".rune") ? resolveRoot(target) : target;
  try {
    // Canonical (symlink-free) root so collector paths and FS event paths agree
    // (macOS reports /private/tmp for a /tmp root).
    root = await Deno.realPath(root);
  } catch {
    console.error(`${RED}rune dev: no such directory: ${root}${RESET}`);
    return 2;
  }
  try {
    await Deno.stat(join(root, "bootstrap", "mod.ts"));
  } catch {
    console.error(
      `${RED}rune dev: ${root} has no bootstrap/mod.ts — run \`rune sync\` first.${RESET}`,
    );
    return 2;
  }

  // ---- shared dev-process registry: ONE `rune dev` per git repo ----
  // Already an owner for this repo (or any subdir of it — the key is the git root)? ATTACH to its
  // live log instead of starting a second watcher + app. Ctrl-C in the attached run only detaches.
  const repo = repoKey(root);
  const existing = (await readDevLock())[repo];
  if (existing && await pidAlive(existing.pid)) {
    await attachShared(repo, existing);
    return 0;
  }
  // OWN it. A stale entry means the previous owner was killed without cleanup — reap the orphaned
  // app child it left (recorded pid; rune has no deterministic port to kill by) before taking over.
  const logFolder = join(runeStateRoot(), "logs", repo);
  await Deno.mkdir(logFolder, { recursive: true });
  if (existing) await reapOrphanChild(existing["log-folder"]);
  const log = new DevLog(logFolder, MAX_LOG_FILES);
  {
    const map = await readDevLock();
    map[repo] = { pid: Deno.pid, "log-folder": logFolder };
    await writeDevLock(map);
  }
  // Every line the owner emits — its own `rune dev:` messages AND the app child's stdout/stderr —
  // is teed to the terminal AND to the rotating log so an attached run sees the same stream.
  const enc = new TextEncoder();
  const say = (line: string): void => void log.write(enc.encode(line + "\n"));
  // Drop our registry entry on exit — sync (safe in the signal path) and only if it's still OURS
  // (guards a race where a reclaiming run already took the slot).
  const deregister = (): void => {
    try {
      const m = JSON.parse(Deno.readTextFileSync(devLockPath())) as Record<
        string,
        DevLockEntry
      >;
      if (m[repo]?.pid === Deno.pid) {
        delete m[repo];
        Deno.writeTextFileSync(devLockPath(), JSON.stringify(m, null, 2));
      }
    } catch { /* nothing to clean */ }
  };

  // The status file keep's /docs/_dev serves: written atomically (tmp + rename)
  // so the app can never read a partial write.
  const tempDir = await Deno.makeTempDir({ prefix: "rune-dev-" });
  const statusPath = join(tempDir, "status.json");
  async function writeStatus(ok: boolean, errors: string[]): Promise<void> {
    const body = JSON.stringify({ ok, errors, at: new Date().toISOString() });
    const tmp = statusPath + ".tmp";
    try {
      await Deno.writeTextFile(tmp, body);
      await Deno.rename(tmp, statusPath);
    } catch { /* best effort — the channel degrades to bootId-only */ }
  }

  // ---- child app ----
  let child: Deno.ChildProcess | null = null;
  let generation = 0; // bumped on every deliberate stop → stale exits are expected
  let shuttingDown = false;

  function spawnChild(): void {
    const gen = ++generation;
    let proc: Deno.ChildProcess;
    try {
      proc = new Deno.Command("deno", {
        // stdout/stderr are PIPED (not inherited) so the app's output is teed into the shared log
        // that attached runs stream — DevLog still echoes it to this terminal.
        args: ["run", "-A", "bootstrap/mod.ts"],
        cwd: root,
        env: { KEEP_DEV: statusPath },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (e) {
      say(`${RED}rune dev: cannot start the app: ${errMessage(e)}${RESET}`);
      return;
    }
    child = proc;
    void writeChildPid(logFolder, proc.pid); // so a reclaiming run can reap us if we're orphaned
    const pump = async (r: ReadableStream<Uint8Array>): Promise<void> => {
      for await (const c of r) await log.write(c);
    };
    void Promise.all([pump(proc.stdout), pump(proc.stderr)]).catch(() => {});
    proc.status.then((st) => {
      if (gen !== generation || shuttingDown) return; // replaced by a restart / shutdown
      child = null;
      say(
        `${RED}rune dev: app exited (code ${st.code}) — waiting for the next save${RESET}`,
      );
      void writeStatus(false, [`app exited (code ${st.code})`]);
    });
  }

  async function stopChild(): Promise<void> {
    const proc = child;
    if (!proc) return;
    generation++; // its exit is deliberate, not a crash
    child = null;
    try {
      proc.kill("SIGTERM");
    } catch { /* already gone */ }
    const killer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch { /* already gone */ }
    }, 2000);
    await proc.status;
    clearTimeout(killer);
  }

  async function restartChild(): Promise<void> {
    await stopChild();
    spawnChild(); // the new process mints a new bootId by itself
  }

  // ---- watch targets: NEVER the bare root (the child writes deno.lock there) ----
  const watchTargets: string[] = [];
  for (
    const cand of [
      join(root, "src"),
      join(root, "spec"), // the `rune init` default spec-folder layout (singular)
      join(root, "specs"), // the older plural staging layout
      join(root, "bootstrap"),
      join(root, "deno.json"),
    ]
  ) {
    try {
      await Deno.stat(cand);
      watchTargets.push(cand);
    } catch { /* absent → not watched */ }
  }
  const watcher = Deno.watchFs(watchTargets);

  // ---- shutdown ----
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    say(`\n${CYAN}rune dev: shutting down…${RESET}`);
    await stopChild();
    try {
      watcher.close();
    } catch { /* already closed */ }
    deregister();
    log.close();
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch { /* best effort */ }
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());

  // ---- cycle engine: 200 ms trailing debounce, single-flight ----
  const suppressions = new Map<string, number>();
  const pending = new Set<string>(); // absolute event paths awaiting the debounce
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let cycleRunning = false;
  let cycleQueued = false;

  function scheduleCycle(): void {
    if (shuttingDown) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void fireCycle();
    }, DEBOUNCE_MS);
  }

  async function fireCycle(): Promise<void> {
    if (shuttingDown) return;
    if (cycleRunning) {
      cycleQueued = true; // events during a cycle buffer into at most ONE follow-up
      return;
    }
    cycleRunning = true;
    try {
      await runCycle();
    } finally {
      cycleRunning = false;
      if (cycleQueued) {
        cycleQueued = false;
        scheduleCycle();
      }
    }
  }

  async function runCycle(): Promise<void> {
    // Drain the batch, dropping paths sync itself wrote (suppression checked at
    // fire time, AFTER the writing cycle registered them — no intake race).
    const now = Date.now();
    const changed: string[] = [];
    for (const abs of pending) {
      if (!isSuppressed(suppressions, abs, now)) changed.push(abs);
    }
    pending.clear();
    const plan = planCycle(changed.map((abs) => relative(root, abs)));
    if (!plan) return; // all noise → no cycle (keeps idle truly silent)

    if (plan.specs.length > 0) {
      // A spec can VANISH between the FS event and this cycle — moved into its
      // module by a sync (the `spec/` → `src/<module>/` relocation) or deleted by
      // the author. A missing spec is a REMOVAL, not a syntax error: drop it so it
      // never raises a false "spec errors — app NOT restarted" banner. (dev's own
      // sync suppresses these paths; this also covers an EXTERNAL sync/move/rm.)
      const liveSpecs: string[] = [];
      let removed = false;
      for (const rel of plan.specs) {
        if (await specExists(join(root, rel))) liveSpecs.push(rel);
        else removed = true;
      }
      if (liveSpecs.length === 0) {
        // Nothing left to check/sync. If a spec was removed (moved/deleted), the
        // project changed → restart so the running app reflects it; else noise.
        if (removed) {
          say(`${CYAN}rune dev: spec removed — restarting app${RESET}`);
          await writeStatus(true, []);
          await restartChild();
        }
        return;
      }
      // Spec path: check first. Errors go to the status file ONLY — no sync, no
      // restart; the last good server keeps serving while the page shows them.
      const errors: string[] = [];
      for (const rel of liveSpecs) errors.push(...await checkSpec(root, rel));
      if (errors.length > 0) {
        say(`${BOLD}${RED}rune dev: spec errors — app NOT restarted${RESET}`);
        for (const e of errors) say(`  ${RED}${e}${RESET}`);
        await writeStatus(false, errors);
        return;
      }
      const written: string[] = [];
      for (const rel of liveSpecs) {
        say(`${BOLD}${CYAN}rune dev: spec saved → sync ${rel}${RESET}`);
        const code = await runSync(["--root", root, join(root, rel)], written);
        if (code !== 0) {
          // S14: even on failure, mute whatever sync already wrote (this spec's
          // partial writes + any earlier spec in the loop) so the watch loop does
          // not re-trigger on its own writes. Mirrors the success path below.
          addSuppressions(
            suppressions,
            written.map((p) => resolve(p)),
            Date.now() + SUPPRESS_TAIL_MS,
          );
          await writeStatus(false, [
            `rune sync failed for ${rel} (exit ${code})`,
          ]);
          return;
        }
      }
      // Mute every path sync wrote for the tail window, so the loop never feeds
      // on its own writes.
      addSuppressions(
        suppressions,
        written.map((p) => resolve(p)),
        Date.now() + SUPPRESS_TAIL_MS,
      );
      await writeStatus(true, []);
      say(`${GREEN}rune dev: sync ok — restarting app${RESET}`);
      await restartChild();
      return;
    }

    // Non-spec source change → restart only (no sync).
    say(`${CYAN}rune dev: source change — restarting app${RESET}`);
    await writeStatus(true, []);
    await restartChild();
  }

  // ---- boot ----
  await writeStatus(true, []);
  say(
    `${BOLD}rune dev: ${root}${RESET} ${CYAN}(shared process for "${repo}", pid ${Deno.pid})${RESET}\n` +
      `  re-running \`rune dev\` in this repo attaches here — Ctrl-C there just detaches\n` +
      `  watching ${
        watchTargets.map((t) => relative(root, t) || t).join(", ")
      }\n` +
      `  status file ${statusPath}\n  logs ${logFolder}`,
  );
  spawnChild();

  const ACTIONABLE = new Set(["create", "modify", "remove", "rename"]);
  for await (const event of watcher) {
    if (shuttingDown) break;
    if (!ACTIONABLE.has(event.kind)) continue;
    let any = false;
    for (const p of event.paths) {
      if (classifyPath(relative(root, p)) === "ignored") continue;
      pending.add(p);
      any = true;
    }
    if (any) scheduleCycle();
  }

  // The watcher closed without a signal (unusual): clean up like a shutdown.
  await stopChild();
  deregister();
  log.close();
  try {
    await Deno.remove(tempDir, { recursive: true });
  } catch { /* best effort */ }
  return 0;
}

/** `rune stop [path]` — stop THIS git repo's shared `rune dev` process (from ~/.rune/dev.json) and
 *  reap its app child. The teardown counterpart of the shared-process registry. */
export async function runStop(args: string[]): Promise<number> {
  const target = resolve(args.find((a) => !a.startsWith("-")) ?? ".");
  const repo = repoKey(target);
  const map = await readDevLock();
  const e = map[repo];
  if (!e) {
    console.log(
      `${CYAN}rune stop: no shared dev process registered for "${repo}".${RESET}`,
    );
    return 0;
  }
  try {
    Deno.kill(e.pid, "SIGTERM");
  } catch { /* already gone */ }
  await reapOrphanChild(e["log-folder"]);
  delete map[repo];
  await writeDevLock(map);
  console.log(
    `${GREEN}rune stop: stopped the shared dev process for "${repo}" (pid ${e.pid}).${RESET}`,
  );
  return 0;
}
