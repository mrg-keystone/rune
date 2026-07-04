import { assert, assertEquals } from "#assert";
import {
  createKvSessionStore,
  createMemorySessionStore,
  intakeSession,
  type NewSession,
  resolveSession,
  type SessionExchange,
  type SessionStore,
} from "./mod.ts";
import { createTestSigner } from "@foundation/domain/business/token/session.testkit.ts";

const signer = await createTestSigner();

/** An opaque-credential intake whose bearer expires at `exp` (Unix seconds). */
async function opaque(exp: number): Promise<NewSession> {
  return {
    credential: "mtk_opaque_handle",
    credentialKind: "opaque",
    bearer: await signer.sign({ creator: "u@x.com", sessionExp: exp }),
    sessionExpiry: exp,
    email: "u@x.com",
    name: "U",
    grants: ["read"],
    claims: { app: "read" },
  };
}

Deno.test("memory store: create → read → destroy round-trip", async () => {
  const store = createMemorySessionStore();
  const id = await store.create(await opaque(9_999_999_999));
  const rec = await store.read(id);
  assert(rec);
  assertEquals(rec!.id, id);
  assertEquals(rec!.credential, "mtk_opaque_handle");
  assertEquals(rec!.grants, ["read"]);
  await store.destroy(id);
  assertEquals(await store.read(id), null);
});

Deno.test("memory store: read of an unknown id is null; available() is true", async () => {
  const store = createMemorySessionStore();
  assertEquals(await store.read("nope"), null);
  assertEquals(await store.available(), true);
});

Deno.test("memory store: write overwrites the record", async () => {
  const store = createMemorySessionStore();
  const id = await store.create(await opaque(1000));
  const rec = (await store.read(id))!;
  await store.write({ ...rec, bearer: "NEW", sessionExpiry: 2000 });
  const after = (await store.read(id))!;
  assertEquals(after.bearer, "NEW");
  assertEquals(after.sessionExpiry, 2000);
});

Deno.test("resolveSession: a healthy session is returned untouched (no exchange)", async () => {
  const store = createMemorySessionStore();
  const id = await store.create(await opaque(10_000));
  let calls = 0;
  const rec = await resolveSession(store, id, {
    now: 5_000, // well before expiry
    exchange: () => {
      calls++;
      return Promise.resolve("SHOULD-NOT-BE-CALLED");
    },
  });
  assert(rec);
  assertEquals(calls, 0);
});

Deno.test("resolveSession: near-expiry opaque session silently re-exchanges and persists", async () => {
  const store = createMemorySessionStore();
  const id = await store.create(await opaque(1_000));
  const freshExp = 999_000;
  const freshBearer = await signer.sign({
    creator: "u@x.com",
    sessionExp: freshExp,
  });
  let seen = "";
  const rec = await resolveSession(store, id, {
    now: 990, // within the 120s skew of expiry 1000
    exchange: (cred) => {
      seen = cred;
      return Promise.resolve(freshBearer);
    },
  });
  assert(rec);
  assertEquals(seen, "mtk_opaque_handle"); // re-exchanged the ORIGINAL credential
  assertEquals(rec!.bearer, freshBearer);
  assertEquals(rec!.sessionExpiry, freshExp); // decoded from the fresh bearer
  // …and the refresh was persisted (bumping the record).
  assertEquals((await store.read(id))!.bearer, freshBearer);
});

Deno.test("resolveSession: a firebase session is NOT re-exchanged (idToken can't be replayed)", async () => {
  const store = createMemorySessionStore();
  const base = await opaque(1_000);
  const id = await store.create({
    ...base,
    credentialKind: "firebase",
    credential: "fb-id",
  });
  let calls = 0;
  const rec = await resolveSession(store, id, {
    now: 990,
    exchange: () => {
      calls++;
      return Promise.resolve("X");
    },
  });
  assert(rec);
  assertEquals(calls, 0);
  assertEquals(rec!.bearer, base.bearer); // unchanged
});

Deno.test("resolveSession: a failed re-exchange returns the stale record, never throws", async () => {
  const store = createMemorySessionStore();
  const id = await store.create(await opaque(1_000));
  const rec = await resolveSession(store, id, {
    now: 990,
    exchange: () => Promise.reject(new Error("infra down")),
  });
  assert(rec);
  assertEquals(rec!.sessionExpiry, 1_000); // untouched — verification downstream will reject if lapsed
});

Deno.test("resolveSession: an unknown id resolves to null", async () => {
  const store = createMemorySessionStore();
  assertEquals(await resolveSession(store, "gone", { now: 1 }), null);
});

Deno.test("intakeSession: opaque token → exchange → stored session + profile", async () => {
  const store = createMemorySessionStore();
  const bearer = await signer.sign({
    creator: "u@x.com",
    claims: { app: "read,write" },
  });
  const infra: SessionExchange = {
    exchange: (t) => Promise.resolve(t === "mtk_1" ? bearer : "wrong"),
    login: () => Promise.reject(new Error("not used")),
  };
  const res = await intakeSession(
    store,
    infra,
    { credential: "mtk_1", credentialKind: "opaque" },
    "app",
  );
  assertEquals(res.grants, ["read", "write"]); // per-app projection
  assertEquals(res.email, "u@x.com");
  const rec = (await store.read(res.id))!;
  assertEquals(rec.credential, "mtk_1"); // ORIGINAL credential kept for silent refresh
  assertEquals(rec.bearer, bearer);
});

Deno.test("intakeSession: firebase idToken routes through login()", async () => {
  const store = createMemorySessionStore();
  const bearer = await signer.sign({
    creator: "f@x.com",
    claims: { app: "x" },
  });
  let via = "";
  const infra: SessionExchange = {
    exchange: () => {
      via = "exchange";
      return Promise.resolve("no");
    },
    login: (id, email) => {
      via = `login:${id}:${email}`;
      return Promise.resolve(bearer);
    },
  };
  const res = await intakeSession(
    store,
    infra,
    { credential: "fb-id", credentialKind: "firebase", email: "f@x.com" },
    "app",
  );
  assertEquals(via, "login:fb-id:f@x.com");
  assertEquals(res.grants, ["x"]);
});

// ── Deno KV backend (only under --unstable-kv) ───────────────────────────────
const KV = "openKv" in Deno;

Deno.test({
  name: "KV store: create/read/write/destroy against :memory: KV",
  ignore: !KV,
  async fn() {
    const store = await createKvSessionStore(":memory:");
    assert(store, "KV opened under --unstable-kv");
    const s = store as SessionStore;
    try {
      const id = await s.create(await opaque(9_999_999_999));
      const rec = await s.read(id);
      assert(rec);
      assertEquals(rec!.credential, "mtk_opaque_handle");
      await s.write({ ...rec!, bearer: "B2" });
      assertEquals((await s.read(id))!.bearer, "B2");
      await s.destroy(id);
      assertEquals(await s.read(id), null);
    } finally {
      await s.close();
    }
  },
});
