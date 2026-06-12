import { assert, assertEquals, assertStringIncludes } from "#assert";
import {
  buildHealPrompt,
  callHealer,
  healConfigured,
  parseVerdict,
  VERDICT_SCHEMA,
} from "./mod.ts";

Deno.test("healConfigured — gated on PRIVATE_CLAUDE_URL", () => {
  const saved = Deno.env.get("PRIVATE_CLAUDE_URL");
  try {
    Deno.env.delete("PRIVATE_CLAUDE_URL");
    assertEquals(healConfigured(), false);
    Deno.env.set("PRIVATE_CLAUDE_URL", "https://x/private-claude");
    assertEquals(healConfigured(), true);
  } finally {
    if (saved === undefined) Deno.env.delete("PRIVATE_CLAUDE_URL");
    else Deno.env.set("PRIVATE_CLAUDE_URL", saved);
  }
});

Deno.test("buildHealPrompt — carries the bundle and the graph", () => {
  const { system, prompt } = buildHealPrompt(
    { endpoint: { id: "get" }, response: { http: 500, body: "not-found" } },
    [{ module: "/mirror", endpoints: [] }],
  );
  assertStringIncludes(system, "ROOT CAUSE");
  assertStringIncludes(prompt, '"not-found"');
  assertStringIncludes(prompt, '"/mirror"');
});

Deno.test("parseVerdict — structured passthrough, filtered suggestions", () => {
  const v = parseVerdict({
    structured: {
      diagnosis: "teardown wiped the enabled set",
      suggestions: [
        { kind: "run-step-first", target: "enableRead", why: "repopulate" },
        { bogus: true },
      ],
    },
  });
  assertEquals(v.diagnosis, "teardown wiped the enabled set");
  assertEquals(v.suggestions.length, 1);
  assertEquals(v.suggestions[0].target, "enableRead");
});

Deno.test("parseVerdict — fenced JSON in text, and prose fallback", () => {
  const fenced = parseVerdict({
    text: 'before\n```json\n{"diagnosis":"d","suggestions":[]}\n```\nafter',
  });
  assertEquals(fenced.diagnosis, "d");

  const prose = parseVerdict({ text: "free-form explanation" });
  assertEquals(prose.diagnosis, "free-form explanation");
  assertEquals(prose.suggestions, []);
});

Deno.test("callHealer — posts the schema and parses the reply", async () => {
  const saved = Deno.env.get("PRIVATE_CLAUDE_URL");
  Deno.env.set("PRIVATE_CLAUDE_URL", "https://healer.test/private-claude");
  try {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        Response.json({
          structured: { diagnosis: "ok", suggestions: [] },
        }),
      );
    }) as typeof fetch;
    const v = await callHealer({ endpoint: { id: "x" } }, [], fakeFetch);
    assertEquals(seenUrl, "https://healer.test/private-claude/v1/prompt");
    assertEquals(seenBody.json_schema, JSON.parse(JSON.stringify(VERDICT_SCHEMA)));
    assert(typeof seenBody.prompt === "string");
    assertEquals(v.diagnosis, "ok");
  } finally {
    if (saved === undefined) Deno.env.delete("PRIVATE_CLAUDE_URL");
    else Deno.env.set("PRIVATE_CLAUDE_URL", saved);
  }
});
