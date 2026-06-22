import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import { Logger } from "@foundation/domain/business/logger/mod.ts";
import { createRequestLoggingMiddleware } from "./mod.ts";

function captureInfo() {
  const calls: unknown[][] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => void calls.push(a);
  return { calls, restore: () => void (console.info = orig) };
}

Deno.test("request logger redacts a credential in the ?token query param", async () => {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const app = new Hono();
  app.use(createRequestLoggingMiddleware(logger));
  app.get("/x", (c) => c.text("ok"));

  const cap = captureInfo();
  try {
    await app.fetch(new Request("http://app/x?token=SECRET123&foo=bar"));
  } finally {
    cap.restore();
  }

  // The logger emits `console.info(message, attributes)`; find the ingress line.
  const ingress = cap.calls.find(
    (a) => typeof a[0] === "string" && (a[0] as string).includes("[ingress"),
  );
  assertExists(ingress, "expected an ingress log line");
  const attrs = JSON.stringify(ingress![1]);

  assertStringIncludes(attrs, '"token":"***"'); // token redacted
  assertStringIncludes(attrs, '"foo":"bar"'); // other params untouched
  assertEquals(attrs.includes("SECRET123"), false); // the real token never appears
});

/** Runs one request through the middleware and returns the ingress log's attributes as JSON. */
async function ingressAttrs(req: Request): Promise<string> {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const app = new Hono();
  app.use(createRequestLoggingMiddleware(logger));
  app.get("/x", (c) => c.text("ok"));
  app.post("/x", (c) => c.text("ok"));
  const cap = captureInfo();
  try {
    await app.fetch(req, { remoteAddr: { hostname: "127.0.0.1" } });
  } finally {
    cap.restore();
  }
  const ingress = cap.calls.find(
    (a) => typeof a[0] === "string" && (a[0] as string).includes("[ingress"),
  );
  assertExists(ingress, "expected an ingress log line");
  return JSON.stringify(ingress![1]);
}

Deno.test("redacts the access_token query param", async () => {
  const attrs = await ingressAttrs(
    new Request("http://app/x?access_token=SECRET&ok=1"),
  );
  assertStringIncludes(attrs, '"access_token":"***"');
  assertStringIncludes(attrs, '"ok":"1"');
  assertEquals(attrs.includes("SECRET"), false);
});

Deno.test("redacts credential headers (authorization, cookie, x-api-key, proxy-authorization)", async () => {
  const attrs = await ingressAttrs(
    new Request("http://app/x", {
      headers: {
        authorization: "Bearer SECRET-A",
        cookie: "session=SECRET-B",
        "x-api-key": "SECRET-C",
        "proxy-authorization": "Basic SECRET-D",
      },
    }),
  );
  for (
    const k of ["authorization", "cookie", "x-api-key", "proxy-authorization"]
  ) {
    assertStringIncludes(attrs, `"${k}":"***"`);
  }
  for (const secret of ["SECRET-A", "SECRET-B", "SECRET-C", "SECRET-D"]) {
    assertEquals(attrs.includes(secret), false);
  }
});

Deno.test("sanitizes a forged x-request-id before it reaches logs or the response header", async () => {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const app = new Hono();
  app.use(createRequestLoggingMiddleware(logger));
  app.get("/x", (c) => c.text("ok"));
  const cap = captureInfo();
  let res: Response;
  try {
    res = await app.fetch(
      new Request("http://app/x", {
        headers: { "x-request-id": "abc] [ingress forged] GET /evil" },
      }),
      { remoteAddr: { hostname: "127.0.0.1" } },
    );
  } finally {
    cap.restore();
  }
  const id = res!.headers.get("x-request-id")!;
  assertEquals(/^[A-Za-z0-9._-]+$/.test(id), true); // only safe chars survive
  assertEquals(id.includes(" "), false);
  assertEquals(id.includes("]"), false);
});

Deno.test("omits an over-64KB request body from the logs", async () => {
  const big = JSON.stringify({ blob: "x".repeat(70 * 1024) });
  const attrs = await ingressAttrs(
    new Request("http://app/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    }),
  );
  assertStringIncludes(attrs, "[omitted: too large]");
  assertEquals(attrs.includes("xxxxxxxxxx"), false); // the large body never appears
});
