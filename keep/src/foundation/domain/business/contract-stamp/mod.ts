// The hash-stamped contract emission — the backend toolchain's half of
// artifact-mediated decoupling (bedrock artifact §6): the composed app's
// OpenAPI surface is written to `spec/contract/openapi.json`, stamped with a
// self-content hash in a reserved top-level `x-spec-hash` field computed over
// the document with that field omitted. Canonicalization is RFC 8785 (JCS):
// for JSON-representable values that is ES JSON.stringify semantics (numbers
// via Number-to-String, minimal escaping, raw UTF-8) with object keys sorted
// by UTF-16 code units recursively; UTF-8 output, no BOM. The frontend
// toolchain reads the COMMITTED file and compares hashes — it never invokes
// this side.

import type { SwaggerDocEntry } from "@types";

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** RFC 8785 (JCS) canonical bytes of a JSON-representable value. */
export function canonicalize(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sortKeysDeep(value)));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Merge the per-module docs the bootstrap built into ONE OpenAPI document for
 * the whole composed app. Route paths are merged as-is — they are the app's
 * real global route space, so a path collision here IS a runtime collision,
 * not an artifact of the merge.
 */
export function mergedOpenApiDoc(
  docs: SwaggerDocEntry[],
  appName: string,
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  let openapi = "3.0.0";
  for (const { doc } of docs) {
    const d = doc as unknown as Record<string, unknown>;
    if (typeof d.openapi === "string") openapi = d.openapi;
    Object.assign(paths, (d.paths as Record<string, unknown>) ?? {});
    const comp = d.components as Record<string, unknown> | undefined;
    Object.assign(schemas, (comp?.schemas as Record<string, unknown>) ?? {});
  }
  return {
    openapi,
    info: { title: appName, version: "0.0.0" },
    paths,
    components: { schemas },
  };
}

/**
 * Stamp a document with its self-content hash: `x-spec-hash` = SHA-256 over
 * the JCS-canonical bytes of the document WITH that field omitted (so the
 * stamp is never self-referential, and a stamped file hashes identically to
 * its unstamped twin). Returns the pretty-printed JSON to commit + the hash.
 */
export async function stampSpecHash(
  doc: Record<string, unknown>,
): Promise<{ json: string; hash: string }> {
  const { ["x-spec-hash"]: _omit, ...rest } = doc;
  const hash = await sha256Hex(canonicalize(rest));
  const stamped = { ...rest, "x-spec-hash": hash };
  return { json: JSON.stringify(stamped, null, 2) + "\n", hash };
}

/**
 * Emit `spec/contract/openapi.json` for a booted app — the explicit build
 * step of artifact §6. Writes only on change (byte-identical content is
 * skipped, so a no-change re-run is physically quiet). Returns what happened.
 */
export async function emitContractOpenApi(
  specDir: string,
  docs: SwaggerDocEntry[],
  appName: string,
): Promise<{ wrote: boolean; hash: string; path: string }> {
  const { json, hash } = await stampSpecHash(mergedOpenApiDoc(docs, appName));
  const dir = `${specDir}/contract`;
  const path = `${dir}/openapi.json`;
  let existing: string | null = null;
  try {
    existing = await Deno.readTextFile(path);
  } catch { /* absent */ }
  if (existing === json) return { wrote: false, hash, path };
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, json);
  return { wrote: true, hash, path };
}
