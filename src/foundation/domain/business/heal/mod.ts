/**
 * The heal bridge: package an emulator failure (plus the process graph) into
 * a prompt for the configured private Claude service and parse its verdict
 * back into machine-applicable suggestions.
 *
 * The emulator runs its RULES first (instant, deterministic, offline); this
 * module is the long tail — cross-module causality, implementation bugs,
 * anything the rules couldn't name. Configured via:
 *   PRIVATE_CLAUDE_URL    e.g. https://host/private-claude  (required)
 *   PRIVATE_CLAUDE_TOKEN  bearer token                       (optional)
 */

export interface HealSuggestion {
  kind:
    | "set-input"
    | "run-step-first"
    | "edit-body"
    | "switch-flow"
    | "set-env"
    | "explain";
  target?: string;
  value?: unknown;
  why: string;
}

export interface HealVerdict {
  diagnosis: string;
  suggestions: HealSuggestion[];
}

/** True when a private Claude endpoint is configured on this server. */
export function healConfigured(): boolean {
  return Boolean(Deno.env.get("PRIVATE_CLAUDE_URL"));
}

// The structured-output contract sent to /v1/prompt — the service returns
// `.structured` matching this, so no prose parsing is needed on success.
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "set-input",
              "run-step-first",
              "edit-body",
              "switch-flow",
              "set-env",
              "explain",
            ],
          },
          target: { type: "string" },
          value: {},
          why: { type: "string" },
        },
        required: ["kind", "why"],
      },
    },
  },
  required: ["diagnosis", "suggestions"],
} as const;

const SYSTEM = [
  "You diagnose failures in a keep process emulator (a chain of HTTP endpoints",
  "wired by order/dependsOn/bind metadata; {{$name}} values are module inputs).",
  "You receive the failing step, its request and response, the session's",
  "captured outputs, module inputs, step statuses, the composed process graph,",
  "and the rule-based fixes already offered. Name the ROOT CAUSE (often an",
  "earlier step's side effect — e.g. a teardown step wiped state a later",
  "module reads) and propose the smallest concrete fixes. kinds: set-input",
  "(target=input name, value), run-step-first (target=endpoint id),",
  "edit-body (target=body field, value), switch-flow (target=flow),",
  "set-env (target=ENV_VAR, value), explain (no action). Never propose",
  "destructive or armed actions as run-step-first — explain those instead.",
  "Keep the diagnosis under 120 words, plain language.",
].join(" ");

/** Build the prompt pair for the private Claude service. */
export function buildHealPrompt(
  bundle: Record<string, unknown>,
  processGraph: unknown,
): { system: string; prompt: string } {
  const prompt = [
    "## Failing step bundle (from the emulator session)",
    JSON.stringify(bundle, null, 2),
    "",
    "## Composed process graph (every module on this server)",
    JSON.stringify(processGraph, null, 2),
  ].join("\n");
  return { system: SYSTEM, prompt };
}

/** Parse the service reply: prefer `.structured`, fall back to fenced JSON in `.text`. */
export function parseVerdict(
  raw: { structured?: unknown; text?: string },
): HealVerdict {
  const candidate = raw.structured ?? extractJson(raw.text ?? "");
  if (
    candidate && typeof candidate === "object" &&
    typeof (candidate as { diagnosis?: unknown }).diagnosis === "string"
  ) {
    const c = candidate as { diagnosis: string; suggestions?: unknown };
    return {
      diagnosis: c.diagnosis,
      suggestions: Array.isArray(c.suggestions)
        ? (c.suggestions as HealSuggestion[]).filter((s) =>
          s && typeof s === "object" && typeof s.why === "string"
        )
        : [],
    };
  }
  return {
    diagnosis: raw.text?.trim() || "The healer returned nothing usable.",
    suggestions: [],
  };
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Call the configured private Claude and return the parsed verdict. */
export async function callHealer(
  bundle: Record<string, unknown>,
  processGraph: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<HealVerdict> {
  const url = Deno.env.get("PRIVATE_CLAUDE_URL");
  if (!url) throw new Error("PRIVATE_CLAUDE_URL is not set");
  const token = Deno.env.get("PRIVATE_CLAUDE_TOKEN");
  const { system, prompt } = buildHealPrompt(bundle, processGraph);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchFn(`${url.replace(/\/$/, "")}/v1/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, system, json_schema: VERDICT_SCHEMA }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`healer upstream ${res.status}: ${await res.text()}`);
  }
  return parseVerdict(
    await res.json() as { structured?: unknown; text?: string },
  );
}
