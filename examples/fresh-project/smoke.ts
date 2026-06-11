import { signToken } from "@mrg-keystone/keep";

/**
 * One-command smoketest for the Keep ↔ Fresh integration. Boots the real Fresh dev server
 * (Vite), runs the matrix against it, tears it down. Run: `deno task smoke`.
 *
 * Keep is consumed via Deno `links` (deno.json `"links": ["../.."]`) — NOT a vendor symlink — so
 * this tests your LOCAL Keep through the actual Vite SSR pipeline.
 */
const KEY = "dev-secret";
const PORT = 8173;
const BASE = `http://127.0.0.1:${PORT}`;

const dev = new Deno.Command("deno", {
  args: [
    "run",
    "-A",
    "npm:vite@^7.1.3",
    "--port",
    String(PORT),
    "--strictPort",
  ],
  env: { ...Deno.env.toObject(), MANUAL_KEY: KEY, TRUST_LOCALHOST: "false" },
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
  const token = await signToken(
    { source: "smoke", appName: "fresh-project" },
    KEY,
  );

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

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS ✓");
} finally {
  try {
    dev.kill("SIGTERM");
  } catch { /* already gone */ }
  await dev.status;
}
Deno.exit(failed ? 1 : 0);
