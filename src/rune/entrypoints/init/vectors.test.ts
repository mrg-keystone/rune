// rune's canonicalize-and-hash, run against the SHARED golden vectors (vendored
// from the artifact format): the single-file x-spec-hash stamp must agree with
// every independent implementation, byte for byte. (The spec-root walk vectors
// are exercised by the frontend toolchain's implementation and the artifact
// format's own reference runner; the directory content-hash belongs to the
// client generator.)

import { assertEquals } from "#std/assert";
import { canonicalize, sha256Hex } from "@mrg-keystone/rune";
import { HASH_VECTORS_JSON } from "./vendored-tests.ts";

interface SingleFileVector {
  name: string;
  contents: Record<string, unknown>;
  expected: string;
}

const doc = JSON.parse(HASH_VECTORS_JSON) as { singleFile: SingleFileVector[] };

for (const v of doc.singleFile) {
  Deno.test(`hash vectors (single-file): ${v.name}`, async () => {
    const { ["x-spec-hash"]: _omit, ...rest } = v.contents;
    assertEquals(await sha256Hex(canonicalize(rest)), v.expected);
  });
}
