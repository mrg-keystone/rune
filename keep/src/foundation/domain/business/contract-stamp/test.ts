import { assert, assertEquals } from "#assert";
import { join } from "#std/path";
import {
  canonicalize,
  emitContractOpenApi,
  mergedOpenApiDoc,
  sha256Hex,
  stampSpecHash,
} from "./mod.ts";
import type { SwaggerDocEntry } from "@types";

const dec = new TextDecoder();

Deno.test("canonicalize — JCS: sorted keys (recursive), ES number forms, raw UTF-8", () => {
  const bytes = canonicalize({ b: 1.0, a: { z: 1e3, y: -0 }, s: "café" });
  assertEquals(dec.decode(bytes), '{"a":{"y":0,"z":1000},"b":1,"s":"café"}');
});

Deno.test("stampSpecHash — the stamp is never self-referential", async () => {
  const unstamped = await stampSpecHash({ openapi: "3.0.0", info: { title: "t" } });
  const restamped = await stampSpecHash({
    openapi: "3.0.0",
    info: { title: "t" },
    "x-spec-hash": "stale-old-value",
  });
  // A stamped file hashes identically to its unstamped twin.
  assertEquals(restamped.hash, unstamped.hash);
  assertEquals(
    await sha256Hex(canonicalize({ info: { title: "t" }, openapi: "3.0.0" })),
    unstamped.hash,
  );
});

const docEntry = (paths: Record<string, unknown>, schemas = {}) =>
  ({ path: "/m", doc: { openapi: "3.0.0", paths, components: { schemas } } }) as unknown as SwaggerDocEntry;

Deno.test("mergedOpenApiDoc — merges module paths and schemas into one app doc", () => {
  const merged = mergedOpenApiDoc([
    docEntry({ "/http/start": { post: {} } }, { StartDto: { type: "object" } }),
    docEntry({ "/http/list": { get: {} } }, { ListDto: { type: "object" } }),
  ], "shop");
  assertEquals(Object.keys(merged.paths as Record<string, unknown>).sort(), [
    "/http/list",
    "/http/start",
  ]);
  const schemas =
    (merged.components as { schemas: Record<string, unknown> }).schemas;
  assertEquals(Object.keys(schemas).sort(), ["ListDto", "StartDto"]);
  assertEquals((merged.info as { title: string }).title, "shop");
});

Deno.test("emitContractOpenApi — writes stamped file once, quiet on no-change re-run", async () => {
  const spec = await Deno.makeTempDir();
  try {
    const docs = [docEntry({ "/http/start": { post: {} } })];
    const first = await emitContractOpenApi(spec, docs, "app");
    assert(first.wrote, "first emission writes");
    const onDisk = JSON.parse(
      await Deno.readTextFile(join(spec, "contract", "openapi.json")),
    );
    assertEquals(onDisk["x-spec-hash"], first.hash);
    // Re-emit with identical docs: byte-identical → not written again.
    const again = await emitContractOpenApi(spec, docs, "app");
    assertEquals(again.wrote, false);
    assertEquals(again.hash, first.hash);
    // A changed surface changes the hash and rewrites.
    const changed = await emitContractOpenApi(
      spec,
      [docEntry({ "/http/start": { post: {} }, "/http/cancel": { post: {} } })],
      "app",
    );
    assert(changed.wrote);
    assert(changed.hash !== first.hash, "surface change changes the stamp");
  } finally {
    await Deno.remove(spec, { recursive: true });
  }
});
