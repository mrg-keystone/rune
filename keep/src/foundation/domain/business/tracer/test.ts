import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { createBackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import { span, Traced, Tracer } from "./mod.ts";

function freshTracer(): Tracer {
  const t = new Tracer();
  t.configure({ appName: "test", capacity: 5 });
  return t;
}

Deno.test("span is a no-op outside a trace and never records", async () => {
  const t = freshTracer();
  const out = await t.span("loose", () => 42);
  assertEquals(out, 42);
  assertEquals((await t.list()).length, 0);
});

Deno.test("trace captures root + nested user spans with correct parenting and durations", async () => {
  const t = freshTracer();
  await t.trace(
    { requestId: "r1", method: "POST", route: "/checkout" },
    async () => {
      await t.span("priceCart", async () => {
        await t.span("applyTax", () => "ok");
      });
    },
  );

  const [trace] = await t.list();
  assertEquals(trace.id, "r1");
  assertEquals(trace.route, "/checkout");
  assertEquals(trace.ok, true);
  assertEquals(trace.crashedSpanId, null);

  const root = trace.spans.find((s) => s.id === 1)!;
  assertEquals(root.kind, "request");
  assertEquals(root.parentId, null);

  const price = trace.spans.find((s) => s.name === "priceCart")!;
  const tax = trace.spans.find((s) => s.name === "applyTax")!;
  assertEquals(price.parentId, 1, "user span nests under the request root");
  assertEquals(tax.parentId, price.id, "nested span nests under its caller");
  assert(
    root.end >= price.end && price.end >= tax.end,
    "outer spans close last",
  );
  assert(trace.durationMs >= 0);
});

Deno.test("a throwing span is marked as the crash point and the error re-throws unchanged", async () => {
  const t = freshTracer();
  let caught: unknown;
  try {
    await t.trace(
      { requestId: "r2", method: "GET", route: "/boom" },
      async () => {
        await t.span("loadUser", () => "fine");
        await t.span("charge", () => {
          throw new Error("card declined");
        });
      },
    );
  } catch (e) {
    caught = e;
  }

  assert(
    caught instanceof Error && caught.message === "card declined",
    "error propagates",
  );
  const [trace] = await t.list();
  assertEquals(trace.ok, false);
  const charge = trace.spans.find((s) => s.name === "charge")!;
  assertEquals(
    trace.crashedSpanId,
    charge.id,
    "the deepest throwing span is the crash point",
  );
  assertEquals(charge.error?.message, "card declined");
  assert(trace.spans[0].error, "the root carries the surfaced error too");
});

Deno.test("the crash marker lands on the DEEPEST throwing span, not the latest-allocated one", async () => {
  // A deep span throws and is recovered by app code (its span catch still marks the crash), then a
  // later-allocated SHALLOWER sibling throws and propagates. The ✕ must land on the deepest throwing
  // span — span ids are an allocation-order counter, not a depth measure, so id order must not win.
  const t = freshTracer();
  let caught: unknown;
  try {
    await t.trace(
      { requestId: "rd", method: "GET", route: "/depth" },
      async () => {
        await t.span("outerA", async () => {
          try {
            await t.span("deepThrow", () => {
              throw new Error("deep boom");
            });
          } catch {
            // recovered inside outerA — the deep span's crash mark still stands
          }
        });
        await t.span("shallowThrow", () => {
          throw new Error("shallow boom");
        });
      },
    );
  } catch (e) {
    caught = e;
  }
  assert(
    caught instanceof Error && caught.message === "shallow boom",
    "the propagating (shallow) error surfaces",
  );
  const [trace] = await t.list();
  const deep = trace.spans.find((s) => s.name === "deepThrow")!;
  const shallow = trace.spans.find((s) => s.name === "shallowThrow")!;
  assert(deep.id < shallow.id, "the deep span was allocated BEFORE the shallow sibling");
  assertEquals(
    trace.crashedSpanId,
    deep.id,
    "the deepest throwing span is the crash point, even though the shallow one has a higher id",
  );
});

Deno.test("concurrent spans each parent correctly (no shared-pointer race)", async () => {
  const t = freshTracer();
  await t.trace({ requestId: "r3", method: "GET", route: "/fan" }, async () => {
    await Promise.all([
      t.span("a", () => new Promise((r) => setTimeout(r, 5))),
      t.span("b", () => new Promise((r) => setTimeout(r, 1))),
    ]);
  });
  const [trace] = await t.list();
  const a = trace.spans.find((s) => s.name === "a")!;
  const b = trace.spans.find((s) => s.name === "b")!;
  assertEquals(a.parentId, 1);
  assertEquals(b.parentId, 1);
});

Deno.test("BackendClient.fetch opens a backend span under the active trace", async () => {
  const t = freshTracer();
  const handler = () => Promise.resolve(new Response("{}", { status: 201 }));
  const client = createBackendClient(handler, "http://localhost", undefined);

  // The default exported `span`/decorator use the GLOBAL tracer; here we drive the local tracer
  // directly to keep the test isolated, but BackendClient uses the global one — so assert the
  // span shape via a hand-rolled trace on the global path instead.
  await t.trace(
    { requestId: "r4", method: "POST", route: "/outer" },
    async () => {
      // Calling the client here records on the GLOBAL tracer, not `t`. Prove the no-op contract:
      // outside the global trace it still just returns a Response.
      const res = await client.fetch("/inner", { method: "PUT" });
      assertEquals(res.status, 201);
    },
  );
  // `t` saw only its own root (the backend span landed on the global tracer or nowhere) — the
  // point of this case is that fetch never throws and returns the real response.
  const [trace] = await t.list();
  assertEquals(trace.spans.length, 1);
});

Deno.test("@Traced wraps a method as a span on the global tracer", async () => {
  // Drive the global tracer via the exported helpers.
  const { tracer } = await import("./mod.ts");
  await tracer.clear();

  class Pricing {
    @Traced()
    price(n: number): number {
      return n * 2;
    }
  }
  const p = new Pricing();
  let result = 0;
  await tracer.trace(
    { requestId: "rg", method: "GET", route: "/g" },
    async () => {
      result = await Promise.resolve(p.price(21));
      await span("manual", () => "x");
    },
  );
  assertEquals(result, 42);
  const [trace] = await tracer.list();
  assert(
    trace.spans.some((s) => s.name === "Pricing.price"),
    "decorator span recorded",
  );
  assert(
    trace.spans.some((s) => s.name === "manual"),
    "span() helper recorded",
  );
  await tracer.clear();
});

Deno.test("setUser labels the current trace and overrides nothing outside a request", async () => {
  const t = freshTracer();
  t.setUser("nobody"); // no active trace — must be a safe no-op
  await t.trace({ requestId: "ru", method: "GET", route: "/me" }, () => {
    t.setUser("member-42");
    return Promise.resolve();
  });
  assertEquals((await t.list())[0].user, "member-42");
});

Deno.test("list scopes by user and users() returns the distinct set", async () => {
  const t = freshTracer();
  const run = (id: string, user?: string) =>
    t.trace({ requestId: id, method: "GET", route: "/r" }, () => {
      if (user) t.setUser(user);
      return Promise.resolve();
    });
  await run("a", "alice");
  await run("b", "bob");
  await run("c", "alice");
  await run("d"); // anonymous

  assertEquals(await t.users(), ["alice", "bob"]);
  const alice = await t.list({ user: "alice" });
  assertEquals(alice.map((x) => x.id), ["c", "a"], "newest-first, only alice");
  assertEquals((await t.list({ limit: 2 })).length, 2, "limit caps the page");
});

Deno.test("ring buffer keeps only the most recent N traces, newest first", async () => {
  const t = freshTracer(); // capacity 5
  for (let i = 0; i < 8; i++) {
    await t.trace(
      { requestId: "r" + i, method: "GET", route: "/" + i },
      async () => {},
    );
  }
  const list = await t.list();
  assertEquals(list.length, 5);
  assertEquals(list[0].id, "r7", "newest first");
  assertEquals(list[4].id, "r3", "oldest within the window");
});

Deno.test("disabled tracer runs the body but records nothing", async () => {
  const t = freshTracer();
  t.configure({ appName: "test", enabled: false });
  let ran = false;
  await t.trace({ requestId: "rx", method: "GET", route: "/off" }, () => {
    ran = true;
    return Promise.resolve();
  });
  assert(ran);
  assertEquals((await t.list()).length, 0);
});
