import { assert, assertEquals, assertStringIncludes } from "#assert";
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

// Honest-fallback message (feedback/bug-auth-silent-legacy-fallback.md, fix #4): when Deno KV is
// unavailable, the KV store must NOT claim "Falling back to in-memory sessions" — it doesn't perform
// the fallback (it returns null); the caller's `?? createMemorySessionStore` does. Run in a
// subprocess WITHOUT --unstable-kv (so KV is genuinely unavailable) and with a FRESH `warnedOnce`.
Deno.test("KV unavailable → store warns without claiming a fallback, and returns null", async () => {
  const modUrl = new URL("./mod.ts", import.meta.url).href;
  const child = `
    import { createKvSessionStore } from ${JSON.stringify(modUrl)};
    const warns = [];
    const ow = console.warn; console.warn = (...a) => warns.push(a.map(String).join(" "));
    const store = await createKvSessionStore(undefined);
    console.warn = ow;
    console.log(JSON.stringify({ store: store === null ? "null" : "store", warns }));
  `;
  const tmp = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(tmp, child);
  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      // deliberately NO --unstable-kv → Deno.openKv is absent → the KV-unavailable branch
      args: ["run", "-A", "--config", new URL("../../../../../deno.json", import.meta.url).pathname, tmp],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await cmd.output();
    const out = new TextDecoder().decode(stdout).trim().split("\n").at(-1)!;
    const { store, warns } = JSON.parse(out) as { store: string; warns: string[] };
    assertEquals(store, "null", "createKvSessionStore must return null when KV is unavailable");
    const kvWarn = warns.find((l) => /Deno KV is unavailable/.test(l));
    assert(kvWarn, `expected a KV-unavailable warning, got: ${JSON.stringify(warns)}`);
    assertEquals(/falling back to in-memory/i.test(kvWarn!), false, "KV store must not claim a fallback it doesn't perform");
    assertStringIncludes(kvWarn!, "will not persist");
  } finally {
    await Deno.remove(tmp);
  }
});

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
    exchangeProfile: (t) =>
      Promise.resolve({ token: t === "mtk_1" ? bearer : "wrong" }),
    loginProfile: () => Promise.reject(new Error("not used")),
  };
  const res = await intakeSession(
    store,
    infra,
    { credential: "mtk_1", credentialKind: "opaque" },
    "app",
  );
  assertEquals(res.grants, ["read", "write"]); // per-app projection
  assertEquals(res.email, "u@x.com");
  assertEquals(res.name, "u@x.com"); // no infra profile → falls back to the bearer's creator
  const rec = (await store.read(res.id))!;
  assertEquals(rec.credential, "mtk_1"); // ORIGINAL credential kept for silent refresh
  assertEquals(rec.bearer, bearer);
});

Deno.test("intakeSession: infra's real name+email win over the bearer's creator", async () => {
  const store = createMemorySessionStore();
  const bearer = await signer.sign({
    creator: "mrg-keystone~alfred", // a machine principal, NOT a usable profile
    claims: { app: "read" },
  });
  const infra: SessionExchange = {
    exchangeProfile: () =>
      Promise.resolve({ token: bearer, name: "Alfred Pennyworth", email: "alfred@wayne.co" }),
    loginProfile: () => Promise.reject(new Error("not used")),
  };
  const res = await intakeSession(
    store,
    infra,
    { credential: "mtk_1", credentialKind: "opaque" },
    "app",
  );
  assertEquals(res.name, "Alfred Pennyworth");
  assertEquals(res.email, "alfred@wayne.co");
  const rec = (await store.read(res.id))!;
  assertEquals(rec.name, "Alfred Pennyworth"); // real profile cached for /auth/me
  assertEquals(rec.email, "alfred@wayne.co");
});

Deno.test("intakeSession: firebase idToken routes through login()", async () => {
  const store = createMemorySessionStore();
  const bearer = await signer.sign({
    creator: "f@x.com",
    claims: { app: "x" },
  });
  let via = "";
  const infra: SessionExchange = {
    exchangeProfile: () => {
      via = "exchange";
      return Promise.resolve({ token: "no" });
    },
    loginProfile: (id, email) => {
      via = `login:${id}:${email}`;
      return Promise.resolve({ token: bearer });
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
