import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import { Logger } from "./mod.ts";
import { DatadogTransport } from "@foundation/domain/data/datadog/mod.ts";
import { PostmarkAlerter } from "@foundation/domain/data/postmark/mod.ts";

function captureConsole() {
  const lines: { level: string; args: unknown[] }[] = [];
  const orig = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.info = (...a: unknown[]) =>
    void lines.push({ level: "info", args: a });
  console.warn = (...a: unknown[]) =>
    void lines.push({ level: "warn", args: a });
  console.error = (...a: unknown[]) =>
    void lines.push({ level: "error", args: a });
  console.debug = (...a: unknown[]) =>
    void lines.push({ level: "debug", args: a });
  return { lines, restore: () => Object.assign(console, orig) };
}

// A Datadog transport whose POSTs are captured (and optionally forced to fail).
function stubDatadog(status = 202) {
  const entries: Record<string, unknown>[] = [];
  let posts = 0;
  const fn = ((_url: string | URL | Request, init?: RequestInit) => {
    posts++;
    entries.push(...JSON.parse(init?.body as string));
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return {
    transport: new DatadogTransport({
      apiKey: "K",
      service: "api",
      transport: fn,
    }),
    entries,
    posts: () => posts,
  };
}

Deno.test("Logger - outside a request, prefixes [<app>]", () => {
  const { lines, restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "myapp" });
    log.info("hello", { a: 1 });
  } finally {
    restore();
  }
  assertEquals(lines[0].level, "info");
  assertEquals(lines[0].args[0], "[myapp] hello");
  assertEquals(lines[0].args[1], { a: 1 });
});

Deno.test("Logger - inside a request, prefixes [<app> <reqId>] and adds requestId attr", () => {
  const { lines, restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "myapp" });
    log.runInRequest("req-123", () => log.info("during", { x: true }));
  } finally {
    restore();
  }
  assertEquals(lines[0].args[0], "[myapp req-123] during");
  assertEquals(lines[0].args[1], { x: true, requestId: "req-123" });
});

Deno.test("Logger - lifecycle builds the ingress/egress messages", () => {
  const { lines, restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api" });
    log.runInRequest("r1", () => {
      log.lifecycle("ingress", "info", "GET", "/users", { headers: {} });
      log.lifecycle("egress", "warn", "GET", "/users", { status: 404 });
    });
  } finally {
    restore();
  }
  assertEquals(lines[0].args[0], "[ingress api r1] GET /users");
  assertEquals(lines[1].level, "warn");
  assertEquals(lines[1].args[0], "[egress api r1] GET /users");
});

Deno.test("Logger - forwards to Datadog; user attrs cannot clobber reserved fields", async () => {
  const dd = stubDatadog();
  const { restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api", datadog: dd.transport });
    await log.runInRequest("r9", async () => {
      log.info("ev", {
        message: "CLOBBER?",
        seq: 999,
        timestamp: "BAD",
        foo: 1,
      });
      await log.settle();
    });
  } finally {
    restore();
  }

  const entry = dd.entries[0];
  assertEquals(entry.message, "[api r9] ev"); // user "message" did not win
  assertEquals(entry.status, "info");
  assertEquals(entry.service, "api");
  assertEquals(entry.foo, 1);
  assertEquals(entry.requestId, "r9");
  assertEquals(entry.seq !== 999, true);
  assertEquals(entry.timestamp !== "BAD", true);
});

Deno.test("Logger - stamps each entry with an ISO call-time timestamp and monotonic seq", async () => {
  const dd = stubDatadog();
  const { restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api", datadog: dd.transport });
    await log.runInRequest("r1", async () => {
      log.info("first");
      log.info("second");
      await log.settle();
    });
  } finally {
    restore();
  }
  assertEquals(dd.entries.length, 2);
  assertEquals(typeof dd.entries[0].timestamp, "string");
  assertEquals(
    Number.isNaN(Date.parse(dd.entries[0].timestamp as string)),
    false,
  );
  assertEquals(
    (dd.entries[1].seq as number) > (dd.entries[0].seq as number),
    true,
  );
});

Deno.test("Logger - sends fire as logs happen; settle() awaits them", async () => {
  const dd = stubDatadog();
  const { restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api", datadog: dd.transport });
    await log.runInRequest("r1", async () => {
      log.info("a");
      log.info("b");
      assertEquals(dd.posts(), 2); // fired immediately, as they happened
      await log.settle(); // awaits the in-flight sends
    });
  } finally {
    restore();
  }
  assertEquals(dd.posts(), 2);
  assertEquals(dd.entries.length, 2);
});

Deno.test("Logger - out-of-request logs fire fire-and-forget", () => {
  const dd = stubDatadog();
  const { restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api", datadog: dd.transport });
    log.info("startup");
  } finally {
    restore();
  }
  assertEquals(dd.posts(), 1);
});

Deno.test("Logger - a failed send falls back to console, emails an alert, never throws", async () => {
  const dd = stubDatadog(500); // intake rejects → send throws
  const pmCalls: Record<string, unknown>[] = [];
  const pmFetch = ((_url: string | URL | Request, init?: RequestInit) => {
    pmCalls.push(JSON.parse(init?.body as string));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const alerter = new PostmarkAlerter({
    serverToken: "T",
    from: "a@x.com",
    to: "b@x.com",
    transport: pmFetch,
  });

  const { lines, restore } = captureConsole();
  try {
    const log = new Logger();
    log.configure({ appName: "api", datadog: dd.transport, alerter });
    await log.runInRequest("r1", async () => {
      log.info("hello"); // must not throw
      await log.settle(); // awaits the failed send; never rejects
    });
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget alert flush
  } finally {
    restore();
  }

  // Console fallback surfaced the failure...
  assertEquals(
    lines.some((l) =>
      l.level === "error" &&
      String(l.args[0]).includes("Datadog log delivery failed")
    ),
    true,
  );
  // ...and an alert email was sent.
  assertEquals(pmCalls.length, 1);
  assertStringIncludes(pmCalls[0].Subject as string, "Logger delivery failure");
});

Deno.test("Logger - currentRequest is undefined outside a scope", () => {
  const log = new Logger();
  assertEquals(log.currentRequest(), undefined);
  const seen = log.runInRequest("abc", () => log.currentRequest());
  assertExists(seen);
  assertEquals(seen?.requestId, "abc");
});
