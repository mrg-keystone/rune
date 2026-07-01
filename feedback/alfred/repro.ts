#!/usr/bin/env -S deno run -A
// ---------------------------------------------------------------------------
// Standalone repro: @mrg-keystone/rune@3.0.0 rejects every infra-issued
// session bearer because the exchange envelope names the grants field
// `ClaimDtos`, but rune's verifier reads `claims`.
//
// Run:
//   deno run -A repro.ts
//       → offline & deterministic; uses the captured ./sample-bearer.json
//
//   ALFRED_DEV_TOKEN=<opaque infra token> deno run -A repro.ts
//       → live; exchanges the opaque token at INFRA_URL/authz/exchange and
//         feeds the REAL response into rune's parser
//
// Exit code: 1 while the bug is present (infra bearer fails to parse),
//            0 once it parses (i.e. fixed).
//
// The three functions below (parseEnvelope, canonicalize, fromBase64url) are
// COPIED VERBATIM from rune 3.0.0 — it does not export them, so they are
// vendored here to run rune's exact logic, not a paraphrase:
//   https://jsr.io/@mrg-keystone/rune/3.0.0/src/foundation/domain/business/token/mod.ts
//     parseEnvelope   L196–244
//     canonicalize    L249–266
//     fromBase64url   L289–295
// ---------------------------------------------------------------------------

const INFRA_URL = Deno.env.get("INFRA_URL") ?? "https://infra.mrg-keystone.deno.net";
const DEV_TOKEN = Deno.env.get("ALFRED_DEV_TOKEN") ?? "";

// ===== BEGIN verbatim copy from rune 3.0.0 token/mod.ts =====================
class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}
interface Claim {
  key: string;
  value: string;
}
interface BearerEnvelope {
  creator: string;
  source: string;
  sessionExpiry: string;
  claims: Claim[];
  signature: string;
  kid: string;
}

function fromBase64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseEnvelope(bearer: string): BearerEnvelope {
  const trimmed = (bearer ?? "").trim();
  if (!trimmed) throw new TokenError("Empty session bearer.");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    try {
      raw = JSON.parse(new TextDecoder().decode(fromBase64url(trimmed)));
    } catch {
      throw new TokenError("Session bearer is not a valid infra envelope.");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TokenError("Session bearer is not an object.");
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v === "") {
      throw new TokenError(`Session bearer missing \`${k}\`.`);
    }
    return v;
  };
  const claims = o.claims;
  if (!Array.isArray(claims)) {
    throw new TokenError("Session bearer `claims` must be an array.");
  }
  const parsedClaims = claims.map((c, i) => {
    if (!c || typeof c !== "object") {
      throw new TokenError(`Session bearer claim[${i}] is malformed.`);
    }
    const cc = c as Record<string, unknown>;
    if (typeof cc.key !== "string") {
      throw new TokenError(`Session bearer claim[${i}] has no \`key\`.`);
    }
    return { key: cc.key, value: typeof cc.value === "string" ? cc.value : String(cc.value ?? "") };
  });
  return {
    creator: str("creator"),
    source: str("source"),
    sessionExpiry: str("sessionExpiry"),
    claims: parsedClaims,
    signature: str("signature"),
    kid: str("kid"),
  };
}

function canonicalize(env: BearerEnvelope): string {
  const claims = env.claims
    .map((c) => ({ key: c.key, value: c.value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({
    creator: env.creator,
    source: env.source,
    sessionExpiry: env.sessionExpiry,
    claims,
  });
}
// ===== END verbatim copy ====================================================

async function getEnvelope(): Promise<Record<string, unknown>> {
  if (DEV_TOKEN) {
    const url = `${INFRA_URL}/authz/exchange`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: DEV_TOKEN }),
    });
    const body = await res.json();
    console.log(`[live] POST ${url} -> ${res.status}`);
    if (!res.ok) {
      console.error(`  exchange failed: ${JSON.stringify(body)}`);
      Deno.exit(2);
    }
    return body;
  }
  console.log("[sample] using ./sample-bearer.json  (set ALFRED_DEV_TOKEN to run live)");
  return JSON.parse(await Deno.readTextFile(new URL("./sample-bearer.json", import.meta.url)));
}

const env = await getEnvelope();

console.log("\ninfra session-bearer envelope keys:", JSON.stringify(Object.keys(env)));
console.log('  has "claims"     (what rune reads)  ->', "claims" in env);
console.log('  has "ClaimDtos"  (what infra emits) ->', "ClaimDtos" in env);

// [1] Feed infra's real envelope to rune 3.0.0's parseEnvelope.
console.log("\n[1] rune 3.0.0 parseEnvelope(infra bearer):");
let bugPresent = false;
try {
  parseEnvelope(JSON.stringify(env));
  console.log("    parsed OK — bug appears FIXED");
} catch (e) {
  bugPresent = true;
  console.log(`    REJECTED -> ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
}

// [2] Control: rename ClaimDtos -> claims and parse again (isolates the field name).
const renamed: Record<string, unknown> = { ...env };
if ("ClaimDtos" in renamed) {
  renamed.claims = renamed.ClaimDtos;
  delete renamed.ClaimDtos;
}
console.log("\n[2] control — same envelope with ClaimDtos renamed to claims:");
try {
  const p = parseEnvelope(JSON.stringify(renamed));
  console.log("    parsed OK -> claims =", JSON.stringify(p.claims));
  // [3] Show the bytes rune verifies the signature against.
  console.log("\n[3] bytes rune signs/verifies over (canonicalize) — infra must sign THESE:");
  console.log("   ", canonicalize(p));
  console.log(
    "    (if infra signs over `ClaimDtos` instead of `claims`, a field-only rename\n" +
      "     flips the failure from parse -> `signature does not verify`; both must use `claims`.)",
  );
} catch (e) {
  console.log(`    still REJECTED -> ${e instanceof Error ? e.message : e}`);
}

console.log("\n=== DIAGNOSIS ===");
console.log(
  "rune 3.0.0 reads `bearer.claims`; infra's /authz/exchange emits `bearer.ClaimDtos`.\n" +
    "parseEnvelope throws before any signature/expiry/grant check, so keep 401s every\n" +
    "infra-issued bearer. See README.md for the exact source lines and the fix.",
);

Deno.exit(bugPresent ? 1 : 0);
