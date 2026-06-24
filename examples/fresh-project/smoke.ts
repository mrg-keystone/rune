import { exportSPKI, generateKeyPair, type KeyLike, SignJWT } from "npm:jose@5";

/**
 * One-command smoketest for the Keep ↔ Fresh integration. Boots the real Fresh dev server
 * (Vite), runs the matrix against it, tears it down. Run: `deno task smoke`.
 *
 * Keep is consumed via Deno `links` (deno.json `"links": ["../.."]`) — NOT a vendor symlink — so
 * this tests your LOCAL Keep through the actual Vite SSR pipeline.
 *
 * Auth is the infra-centralized model: infra mints + signs; keep verifies offline against infra's
 * JWKS and exchanges opaque tokens. Here a tiny in-process stub stands in for infra — it publishes
 * a JWKS, signs session bearers, and exchanges opaque `mtk_…` tokens — so the smoke test exercises
 * the real verify / exchange / poll paths end-to-end.
 */
const PORT = 8173;
const INFRA_PORT = 8174;
const BASE = `http://127.0.0.1:${PORT}`;
const INFRA_URL = `http://127.0.0.1:${INFRA_PORT}`;
const KID = "infra-dev-2026";

// Stub infra signer: an RS256 keypair published as a JWKS (SPKI PEM).
const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
});
const jwks = {
  keys: [{ kid: KID, alg: "RS256", publicKey: await exportSPKI(publicKey as KeyLike) }],
};

/** Mint a session bearer the keep server will verify offline against the stub JWKS. */
async function sign(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    iss: "infra",
    creator: "smoke",
    source: "smoke",
    claims: {},
    sessionExp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer("infra")
    .setExpirationTime(now + 3600)
    .sign(privateKey as KeyLike);
}

// The stub infra HTTP service (JWKS + exchange + revocation poll).
const infra = Deno.serve({ port: INFRA_PORT, onListen: () => {} }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/keys/jwks") return Response.json(jwks);
  if (pathname === "/revocation/status") return Response.json({ revokeAll: false });
  if (pathname === "/manualToken/exchange") {
    return Response.json({ bearer: await sign() });
  }
  return new Response("not found", { status: 404 });
});

const dev = new Deno.Command("deno", {
  args: [
    "run",
    "-A",
    "npm:vite@^7.1.3",
    "--port",
    String(PORT),
    "--strictPort",
  ],
  env: {
    ...Deno.env.toObject(),
    INFRA_URL,
    TRUST_LOCALHOST: "false",
  },
  stdout: "null",
  stderr: "null",
}).spawn();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`${BASE}/`);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

let failed = 0;
async function check(
  name: string,
  path: string,
  expect: number,
  init?: RequestInit,
) {
  let status = 0;
  try {
    status = (await fetch(`${BASE}${path}`, init)).status;
  } catch (e) {
    console.log(`✗ ${name}: request failed (${e})`);
    failed++;
    return;
  }
  const ok = status === expect;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${status} (expect ${expect})`);
}

try {
  if (!(await waitReady())) {
    console.error("dev server did not come up");
    Deno.exit(1);
  }
  const token = await sign();

  await check("SSR /users (in-process, no token)", "/users", 200);
  await check("/api/users (network, no token)", "/api/users", 401);
  await check("/api/users (network, with header token)", "/api/users", 200, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await check(
    "/api/users?token=<valid> (query param)",
    `/api/users?token=${token}`,
    200,
  );
  await check(
    "/api/users?token=garbage (query param)",
    "/api/users?token=garbage",
    401,
  );
  await check("/api/health (@Public, no token)", "/api/health", 200);
  await check("/api/users (forged internal header)", "/api/users", 401, {
    headers: { "x-danet-internal": "anything" },
  });

  // OAuth-style exchange: POST an opaque manual token to /api/_token → a session bearer.
  await check("/api/_token (exchange opaque mtk_)", "/api/_token", 200, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "mtk_demo" }),
  });
  // The exchanged bearer then authorizes a network call.
  let exchanged = "";
  try {
    const res = await fetch(`${BASE}/api/_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "mtk_demo" }),
    });
    exchanged = (await res.json()).bearer ?? "";
  } catch { /* counted below */ }
  await check(
    "/api/users (exchanged session bearer)",
    "/api/users",
    200,
    { headers: { Authorization: `Bearer ${exchanged}` } },
  );

  // Swagger docs, embedded under the mount: shells are public, the spec is gated.
  await check("/api/docs (public index shell)", "/api/docs", 200);
  await check("/api/docs/app (emulator shell)", "/api/docs/app", 200);
  await check(
    "/api/docs/app/swagger (swagger shell)",
    "/api/docs/app/swagger",
    200,
  );
  await check("/api/docs/app/json (spec, no token)", "/api/docs/app/json", 401);
  await check(
    "/api/docs/app/json (spec, with token)",
    `/api/docs/app/json?token=${token}`,
    200,
  );

  // Index links must be mount-relative ("docs/app"); absolute "/docs/app" escapes /api.
  const indexHtml = await (await fetch(`${BASE}/api/docs`)).text();
  const relative = indexHtml.includes('href="docs/app"') &&
    !indexHtml.includes('href="/docs/');
  if (!relative) failed++;
  console.log(`${relative ? "✓" : "✗"} docs index links are mount-relative`);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS ✓");
} finally {
  try {
    dev.kill("SIGTERM");
  } catch { /* already gone */ }
  await dev.status;
  await infra.shutdown();
}
Deno.exit(failed ? 1 : 0);
