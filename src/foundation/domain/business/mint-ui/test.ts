import { assertEquals, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import { createMintUi } from "./mod.ts";
import { verifyToken } from "@foundation/domain/business/token/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const KEY = "mint-test-key";

function app(signingKey = KEY) {
  const logger = new Logger();
  logger.configure({ appName: "billing" });
  const ui = createMintUi({ appName: "billing", signingKey, logger });
  const hono = new Hono();
  hono.get("/_mint", ui.form);
  hono.post("/_mint", ui.mint);
  // Drive Hono with conn info in `env`, exactly as Deno.serve does. Default: loopback peer.
  // Pass hostname=null to simulate a missing peer address (no conn info forwarded).
  return (req: Request, hostname: string | null = "127.0.0.1") => {
    const env = hostname === null ? undefined : { remoteAddr: { hostname } };
    return logger.runInRequest("r", () => hono.fetch(req, env));
  };
}

Deno.test("GET serves the form on localhost", async () => {
  const res = await app()(new Request("http://localhost/_mint"));
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "Mint access token");
});

Deno.test("non-localhost requests are forbidden", async () => {
  const form = await app()(new Request("http://host/_mint"), "203.0.113.7");
  assertEquals(form.status, 403);

  const body = new FormData();
  body.set("source", "x");
  body.set("expiresIn", "3600");
  const post = await app()(
    new Request("http://host/_mint", { method: "POST", body }),
    "203.0.113.7",
  );
  assertEquals(post.status, 403);
});

Deno.test("fails closed when no peer address is available (no Host-header fallback)", async () => {
  // A spoofed Host must NOT grant access when the socket address is unknown.
  const res = await app()(
    new Request("http://localhost/_mint", { headers: { host: "localhost" } }),
    null,
  );
  assertEquals(res.status, 403);
});

Deno.test("POST mints a verifiable token", async () => {
  const body = new FormData();
  body.set("source", "ci-runner");
  body.set("appName", "billing");
  body.set("expiresIn", "3600");

  const res = await app()(new Request("http://localhost/_mint", { method: "POST", body }));
  assertEquals(res.status, 200);

  const page = await res.text();
  const token = page.match(/<pre>([^<]+)<\/pre>/)?.[1];
  assertEquals(typeof token, "string");

  const payload = await verifyToken(token!, KEY);
  assertEquals(payload.source, "ci-runner");
  assertEquals(payload.appName, "billing");
  // expiry is computed as now + 3600s (the "expires in" duration), not an absolute input.
  const now = Math.floor(Date.now() / 1000);
  assertEquals(payload.expiry > now + 3590 && payload.expiry <= now + 3600, true);
});

Deno.test("POST result page builds a copyable /docs?token= link", async () => {
  const body = new FormData();
  body.set("source", "ci-runner");
  body.set("expiresIn", "3600");

  const res = await app()(new Request("http://localhost/_mint", { method: "POST", body }));
  const page = await res.text();

  assertStringIncludes(page, 'replace("/_mint", "/docs")'); // derives docs path from location
  assertStringIncludes(page, '"?token=" + encodeURIComponent(token)');
  assertStringIncludes(page, 'id="docsLink"');
  assertStringIncludes(page, 'id="copyDocs"');
});

Deno.test("POST validates source and the duration", async () => {
  const bad = new FormData();
  bad.set("source", "");
  bad.set("expiresIn", "not-a-number");
  assertEquals(
    (await app()(new Request("http://localhost/_mint", { method: "POST", body: bad }))).status,
    400,
  );

  const nonPositive = new FormData();
  nonPositive.set("source", "ci");
  nonPositive.set("expiresIn", "0");
  assertEquals(
    (await app()(new Request("http://localhost/_mint", { method: "POST", body: nonPositive })))
      .status,
    400,
  );
});

Deno.test("form shows the 'expires in' duration field and an Eastern-time preview", async () => {
  const res = await app()(new Request("http://localhost/_mint"));
  const page = await res.text();
  assertStringIncludes(page, 'name="expiresIn"');
  assertStringIncludes(page, "seconds from now");
  assertStringIncludes(page, 'id="expiryPreview"');
  assertStringIncludes(page, "America/New_York");
});

Deno.test("result page auto-copies the token and shows expiry in Eastern Time", async () => {
  const body = new FormData();
  body.set("source", "ci");
  body.set("expiresIn", "3600");
  const res = await app()(new Request("http://localhost/_mint", { method: "POST", body }));
  const page = await res.text();
  assertStringIncludes(page, "navigator.clipboard.writeText(token)"); // auto-copy
  assertStringIncludes(page, 'id="expiresAt"');
  assertStringIncludes(page, "America/New_York");
});

Deno.test("POST without a signing key fails closed", async () => {
  const body = new FormData();
  body.set("source", "ci");
  body.set("expiresIn", "3600");
  const res = await app("")(new Request("http://localhost/_mint", { method: "POST", body }));
  assertEquals(res.status, 500);
});
