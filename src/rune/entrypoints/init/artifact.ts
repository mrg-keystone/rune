// The shared `spec/` ARTIFACT: skeleton creation, the self-describing manifest,
// and the vendored conformance vectors — rune's implementation of the artifact
// contract (bedrock: manifest §3, durability classes §4, init-as-contributorship
// §8). The artifact is the ONE place the toolchains meet: every rule here is
// additive and idempotent so any toolchain's `init`, first or later, converges
// the repo without ever touching another toolchain's half.

import { dirname, join } from "#std/path";
import {
  HASH_VECTORS_JSON,
  SPEC_ROOT_VECTORS_JSON,
} from "./vendored-tests.ts";

/** The artifact format this CLI writes and reads. */
export const ARTIFACT_FORMAT_VERSION = "1.0.0";
/** The formatVersion major this CLI supports — anything else fails loud. */
export const SUPPORTED_FORMAT_MAJOR = 1;

export interface ManifestEntry {
  class: "durable" | "merge" | "derived";
  owner: string;
  producer: string;
}

export interface SpecManifest {
  formatVersion: string;
  subtrees: Record<string, ManifestEntry>;
}

/** Every subtree rune produces — registered additively, only-if-absent, the
 *  first time rune's `init` runs against an artifact (§3 per-path registration).
 *  rune never writes, edits, or reorders another toolchain's entries. */
export const RUNE_MANIFEST_ENTRIES: Record<string, ManifestEntry> = {
  "product/": {
    class: "durable",
    owner: "product",
    producer: "scoping toolchain",
  },
  "runes/": { class: "durable", owner: "backend", producer: "backend toolchain" },
  "misc/layout.md": {
    class: "derived",
    owner: "none",
    producer: "backend toolchain",
  },
  "misc/data.json": {
    class: "merge",
    owner: "backend",
    producer: "backend toolchain",
  },
  "misc/heal-rules.json": {
    class: "merge",
    owner: "backend",
    producer: "backend toolchain",
  },
  "misc/cake.json": {
    class: "durable",
    owner: "backend",
    producer: "backend toolchain",
  },
  "misc/scenarios/": {
    class: "durable",
    owner: "backend",
    producer: "backend toolchain",
  },
  "contract/openapi.json": {
    class: "derived",
    owner: "none",
    producer: "backend toolchain",
  },
};

/** The skeleton manifest whichever toolchain's first `init` writes: the format
 *  version plus the one subtree with no toolchain-role producer — `tests/`, the
 *  artifact format's own vendored vectors (§3's named bootstrap exception). */
function skeletonManifest(): SpecManifest {
  return {
    formatVersion: ARTIFACT_FORMAT_VERSION,
    subtrees: {
      "tests/": { class: "durable", owner: "none", producer: "artifact format" },
    },
  };
}

/**
 * Create the `spec/` skeleton ATOMICALLY iff `spec/` is absent (§8 checklist
 * items 3–5): the empty layout, the minimal self-describing manifest, and the
 * vendored `spec/tests/` conformance vectors. Built in a private temp location
 * and renamed into place as ONE step, so an interrupted or racing first `init`
 * can never leave a partial skeleton a later `init` would mistake for done —
 * and the rename itself arbitrates two simultaneous first `init`s (the loser
 * simply finds `spec/` present and proceeds as a later init).
 *
 * Returns true when THIS call created the skeleton.
 */
export async function ensureSpecSkeleton(gitRoot: string): Promise<boolean> {
  const specDir = join(gitRoot, "spec");
  try {
    await Deno.stat(specDir);
    return false; // present — a later init; the skeleton step is done forever
  } catch { /* absent — build it */ }

  const tmp = await Deno.makeTempDir({
    prefix: ".spec-skeleton-",
    dir: gitRoot, // same filesystem, so the rename below is atomic
  });
  try {
    for (const d of ["runes", "misc", "ui", "product", "contract", "tests"]) {
      await Deno.mkdir(join(tmp, d), { recursive: true });
    }
    await Deno.writeTextFile(
      join(tmp, "manifest.json"),
      JSON.stringify(skeletonManifest(), null, 2) + "\n",
    );
    await Deno.writeTextFile(
      join(tmp, "tests", "spec-root-vectors.json"),
      SPEC_ROOT_VECTORS_JSON + "\n",
    );
    await Deno.writeTextFile(
      join(tmp, "tests", "hash-vectors.json"),
      HASH_VECTORS_JSON + "\n",
    );
    try {
      await Deno.rename(tmp, specDir);
      return true;
    } catch {
      // Lost the race — someone else's rename landed first. Their skeleton is
      // complete (atomicity guarantees it); clean up ours and carry on.
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      return false;
    }
  } catch (e) {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
    throw e;
  }
}

/** Read `spec/manifest.json`, or null when absent/unreadable. */
export async function readManifest(
  gitRoot: string,
): Promise<SpecManifest | null> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(gitRoot, "spec", "manifest.json")),
    );
    if (
      parsed && typeof parsed === "object" &&
      typeof parsed.formatVersion === "string"
    ) {
      return parsed as SpecManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Register `entries` in the manifest, ADDITIVELY and only-if-absent (§3):
 * existing entries — this toolchain's or any other's — are never rewritten,
 * reordered, or removed. A pre-artifact app (spec/ present, no manifest) gets
 * a skeleton manifest first, so older repos converge on re-run.
 * Returns the list of keys this call added.
 */
export async function registerManifestEntries(
  gitRoot: string,
  entries: Record<string, ManifestEntry>,
): Promise<string[]> {
  const path = join(gitRoot, "spec", "manifest.json");
  const manifest = (await readManifest(gitRoot)) ?? skeletonManifest();
  const added: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (manifest.subtrees[key] !== undefined) continue;
    manifest.subtrees[key] = entry;
    added.push(key);
  }
  if (added.length || !(await readManifest(gitRoot))) {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(manifest, null, 2) + "\n");
  }
  return added;
}

/**
 * The version handshake (§3): a tool declares the formatVersion range it
 * supports and FAILS LOUD on an out-of-range artifact. Returns null when the
 * artifact is compatible (or carries no manifest — a pre-artifact repo, which
 * every tool still reads); otherwise the located error message to print.
 */
export async function checkArtifactVersion(
  gitRoot: string,
): Promise<string | null> {
  const manifest = await readManifest(gitRoot);
  if (!manifest) return null;
  const major = Number(manifest.formatVersion.split(".")[0]);
  if (Number.isFinite(major) && major === SUPPORTED_FORMAT_MAJOR) return null;
  return `spec/manifest.json declares artifact format ${manifest.formatVersion}; ` +
    `this rune supports ${SUPPORTED_FORMAT_MAJOR}.x — upgrade ${
      major > SUPPORTED_FORMAT_MAJOR ? "the rune CLI" : "the artifact"
    } so the two agree (never edit around a version mismatch).`;
}
