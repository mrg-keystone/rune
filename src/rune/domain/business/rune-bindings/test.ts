import { assertEquals } from "#std/assert";
import { applyCase, bindings, processName, transformName } from "./mod.ts";
import SHAPE from "@assets/canonical-paths.json" with { type: "json" };

Deno.test("applyCase — kebab", () => {
  assertEquals(applyCase("GetRecordingDto", "kebab"), "get-recording-dto");
  assertEquals(applyCase("fiveNine", "kebab"), "five-nine");
  assertEquals(applyCase("metadata", "kebab"), "metadata");
});

Deno.test("applyCase — camel/pascal/lower", () => {
  assertEquals(applyCase("Recording", "camel"), "recording");
  assertEquals(applyCase("recording", "pascal"), "Recording");
  assertEquals(applyCase("HELLO", "lower"), "hello");
});

Deno.test("transformName — strips Dto suffix and kebabs", () => {
  const b = bindings["<name>"];
  assertEquals(transformName("GetRecordingDto", b), "get-recording");
  assertEquals(transformName("IdDto", b), "id");
});

Deno.test("transformName — no-op when suffix doesn't match", () => {
  const b = bindings["<name>"];
  assertEquals(transformName("url", b), "url");
});

Deno.test("processName — kebabs noun-verb", () => {
  assertEquals(processName("recording", "set"), "recording-set");
  assertEquals(processName("recording", "get"), "recording-get");
  assertEquals(processName("recordingMetadata", "set"), "recording-metadata-set");
});

Deno.test("bindings — every placeholder maps to at least one rune source", () => {
  for (const [placeholder, binding] of Object.entries(bindings)) {
    assertEquals(
      binding.from.length > 0,
      true,
      `placeholder ${placeholder} has no source`,
    );
  }
});

Deno.test("bindings — every placeholder under src/ has a binding", () => {
  // Only src/ is rune-managed. fixtures/, assets/, dist/, bootstrap/ are not.
  const srcSubtree = (SHAPE as Record<string, unknown>)["src/"];
  const placeholders = collectPlaceholders(srcSubtree);
  const known = new Set(Object.keys(bindings));
  const missing: string[] = [];
  for (const p of placeholders) {
    if (!known.has(p)) missing.push(p);
  }
  assertEquals(
    missing,
    [],
    `canonical-paths.json src/ has placeholders without bindings: ${missing.join(", ")}`,
  );
});

// Walk a canonical-paths subtree and collect every "<...>" placeholder seen as a key.
function collectPlaceholders(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const v of node) collectPlaceholders(v, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const stripped = key.endsWith("/") ? key.slice(0, -1) : key;
    if (stripped.startsWith("<") && stripped.endsWith(">")) {
      out.add(stripped);
    }
    collectPlaceholders(value, out);
  }
  return out;
}
