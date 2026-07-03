import { assertEquals } from "#std/assert";
import { join } from "#std/path";
import {
  devLockPath,
  gitRepoRoot,
  pidAlive,
  readChildPid,
  readDevLock,
  reapOrphanChild,
  repoKey,
  runeStateRoot,
  writeChildPid,
  writeDevLock,
} from "./registry.ts";

// Each test isolates ~/.rune under a temp RUNE_HOME so the real one is never touched.
async function withHome(
  fn: (home: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "rune-home-" });
  const prev = Deno.env.get("RUNE_HOME");
  Deno.env.set("RUNE_HOME", home);
  try {
    await fn(home);
  } finally {
    if (prev === undefined) Deno.env.delete("RUNE_HOME");
    else Deno.env.set("RUNE_HOME", prev);
    await Deno.remove(home, { recursive: true }).catch(() => {});
  }
}

Deno.test("runeStateRoot / devLockPath honor RUNE_HOME", async () => {
  await withHome((home) => {
    assertEquals(runeStateRoot(), home);
    assertEquals(devLockPath(), join(home, "dev.json"));
    return Promise.resolve();
  });
});

Deno.test("repoKey uses the nearest .git ancestor's sanitized folder name", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "rune-repo test-" }); // space → sanitized
  try {
    await Deno.mkdir(join(tmp, ".git"));
    const sub = join(tmp, "packages", "ui");
    await Deno.mkdir(sub, { recursive: true });
    // gitRepoRoot walks up to the .git dir; the key is that root's basename, sanitized.
    assertEquals(gitRepoRoot(sub), tmp);
    const expected = tmp.split("/").pop()!.replace(/[^A-Za-z0-9._-]+/g, "-");
    assertEquals(repoKey(sub), expected);
    // A worktree uses a `.git` FILE, not dir — still detected by existence, not type.
    const wt = await Deno.makeTempDir({ prefix: "rune-worktree-" });
    await Deno.writeTextFile(join(wt, ".git"), "gitdir: /somewhere\n");
    assertEquals(gitRepoRoot(wt), wt);
    await Deno.remove(wt, { recursive: true });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("repoKey falls back to the target folder name outside any repo", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "no-git-here-" });
  try {
    assertEquals(gitRepoRoot(tmp), null);
    assertEquals(
      repoKey(tmp),
      tmp.split("/").pop()!.replace(/[^A-Za-z0-9._-]+/g, "-"),
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readDevLock/writeDevLock round-trip; missing file reads as empty", async () => {
  await withHome(async () => {
    assertEquals(await readDevLock(), {}); // no file yet
    const map = { demo: { pid: 4242, "log-folder": "/tmp/logs/demo" } };
    await writeDevLock(map);
    assertEquals(await readDevLock(), map);
    // A corrupt file also degrades to empty rather than throwing.
    await Deno.writeTextFile(devLockPath(), "{ not json");
    assertEquals(await readDevLock(), {});
  });
});

Deno.test("pidAlive: this process is alive; a bogus pid and pid<=1 are not", async () => {
  assertEquals(await pidAlive(Deno.pid), true);
  assertEquals(await pidAlive(0), false);
  assertEquals(await pidAlive(1), false);
  assertEquals(await pidAlive(2_147_483_646), false); // no such process
});

Deno.test("child.pid write/read round-trip and reap removes the file", async () => {
  const folder = await Deno.makeTempDir({ prefix: "rune-logs-" });
  try {
    assertEquals(await readChildPid(folder), null);
    // Record a pid that is NOT alive (this process's own +1 is almost never live and never us),
    // so reap is a no-op kill but still clears the file.
    await writeChildPid(folder, 2_147_483_646);
    assertEquals(await readChildPid(folder), 2_147_483_646);
    await reapOrphanChild(folder);
    assertEquals(await readChildPid(folder), null); // file removed after reap
  } finally {
    await Deno.remove(folder, { recursive: true }).catch(() => {});
  }
});
