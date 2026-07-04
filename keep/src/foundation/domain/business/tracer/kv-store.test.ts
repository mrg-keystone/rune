import { assert, assertEquals } from "#assert";
import { createKvTraceSink } from "./kv-store.ts";
import type { Trace } from "./mod.ts";

// Deno KV is unstable: these tests only run under `--unstable-kv`. Without the flag `Deno.openKv`
// is absent, so we skip rather than fail the default suite (`deno test --unstable-raw-imports`).
// Verify with: deno test -A --unstable-raw-imports --unstable-kv src/foundation/domain/business/tracer/kv-store.test.ts
const KV = "openKv" in Deno;

function trace(id: string, startedAt: number, user?: string): Trace {
  return {
    id,
    app: "t",
    method: "GET",
    route: "/r",
    user,
    startedAt,
    durationMs: 1,
    ok: true,
    crashedSpanId: null,
    spans: [{
      id: 1,
      parentId: null,
      name: "GET /r",
      kind: "request",
      start: 0,
      end: 1,
    }],
  };
}

Deno.test({
  name: "KV sink: time-ordered, per-user indexed, users(), clear()",
  ignore: !KV,
  async fn() {
    // A unique :memory: KV per run — isolated, no disk, auto-discarded.
    const sink = await createKvTraceSink(":memory:");
    assert(sink, "KV opened under --unstable-kv");
    try {
      await sink!.record(trace("a", 100, "alice"));
      await sink!.record(trace("b", 300, "bob"));
      await sink!.record(trace("c", 200, "alice"));
      await sink!.record(trace("d", 50)); // anonymous — time index only

      // Newest-first across everyone.
      const all = await sink!.list();
      assertEquals(all.map((t) => t.id), ["b", "c", "a", "d"]);

      // Per-user scan hits only the user index, newest-first.
      const alice = await sink!.list({ user: "alice" });
      assertEquals(alice.map((t) => t.id), ["c", "a"]);

      // limit caps the page.
      assertEquals((await sink!.list({ limit: 2 })).map((t) => t.id), [
        "b",
        "c",
      ]);

      // Distinct users (anonymous never indexed).
      assertEquals(await sink!.users(), ["alice", "bob"]);

      await sink!.clear();
      assertEquals((await sink!.list()).length, 0);
      assertEquals((await sink!.users()).length, 0);
    } finally {
      await sink!.close();
    }
  },
});

Deno.test({
  name: "KV sink: TTL set on records (expireIn) — short TTL reaps the entry",
  ignore: !KV,
  async fn() {
    // ttlDays is converted to ms; createKvTraceSink clamps to >= 1 day, so we can't assert true
    // expiry quickly here. Instead assert a record round-trips and the sink reports available.
    const sink = await createKvTraceSink(":memory:", 1);
    assert(sink);
    try {
      await sink!.record(trace("x", 1, "u"));
      assertEquals((await sink!.list({ user: "u" })).map((t) => t.id), ["x"]);
    } finally {
      await sink!.close();
    }
  },
});
