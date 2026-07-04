import { assertEquals, assertRejects } from "#assert";
import { createInfraClient, InfraError } from "./mod.ts";

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

/** A stub fetch that captures the last request and returns a canned response by URL. */
function captureFetch(
  routes: Record<string, () => Response>,
): { impl: typeof fetch; box: { last?: Captured } } {
  const box: { last?: Captured } = {};
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch { /* non-JSON body */ }
    box.last = { url, method: init?.method ?? "GET", body };
    const handler = routes[url];
    return Promise.resolve(
      handler ? handler() : new Response("no route", { status: 500 }),
    );
  }) as typeof fetch;
  return { impl, box };
}

/** A stub fetch routing by URL to canned responses. */
function stubFetch(
  routes: Record<string, () => Response>,
): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const handler = routes[url];
    if (!handler) {
      return Promise.resolve(new Response("no route", { status: 500 }));
    }
    return Promise.resolve(handler());
  }) as typeof fetch;
}

const BASE = "https://infra.test";

Deno.test("jwks fetches the default /authz/jwks URL and reads {JwkKeyDtos}", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/authz/jwks`]: () =>
        Response.json({
          JwkKeyDtos: [{ kid: "k1", alg: "EdDSA", publicKey: "x-material" }],
        }),
    }),
  });
  const jwks = await client.jwks();
  assertEquals(jwks.keys.length, 1);
  assertEquals(jwks.keys[0].kid, "k1");
  assertEquals(jwks.keys[0].alg, "EdDSA");
  assertEquals(jwks.keys[0].publicKey, "x-material");
});

Deno.test("jwks also accepts the plain {keys} shape", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/authz/jwks`]: () =>
        Response.json({
          keys: [{ kid: "k2", alg: "EdDSA", publicKey: "y" }],
        }),
    }),
  });
  const jwks = await client.jwks();
  assertEquals(jwks.keys.length, 1);
  assertEquals(jwks.keys[0].kid, "k2");
});

Deno.test("jwks honors an explicit jwksUrl override", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    jwksUrl: "https://cdn.test/jwks.json",
    fetchImpl: stubFetch({
      "https://cdn.test/jwks.json": () => Response.json({ JwkKeyDtos: [] }),
    }),
  });
  assertEquals((await client.jwks()).keys, []);
});

Deno.test("revocationStatus reads the revokeAll flag from /authz/status", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/authz/status`]: () =>
        Response.json({ revokeAll: true, polledAt: "2026-06-14T00:00:00Z" }),
    }),
  });
  const status = await client.revocationStatus();
  assertEquals(status.revokeAll, true);
  assertEquals(status.polledAt, "2026-06-14T00:00:00Z");
});

Deno.test("revocationStatus honors an explicit revocationPath override", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    revocationPath: "/custom/status",
    fetchImpl: stubFetch({
      [`${BASE}/custom/status`]: () => Response.json({ revokeAll: true }),
    }),
  });
  assertEquals((await client.revocationStatus()).revokeAll, true);
});

Deno.test("a trailing slash on baseUrl is trimmed", async () => {
  const client = createInfraClient({
    baseUrl: `${BASE}/`,
    fetchImpl: stubFetch({
      [`${BASE}/authz/status`]: () => Response.json({ revokeAll: false }),
    }),
  });
  assertEquals((await client.revocationStatus()).revokeAll, false);
});

Deno.test("exchange POSTs {token} to /api/authz/exchange and returns the signed bearer", async () => {
  const cap = captureFetch({
    [`${BASE}/api/authz/exchange`]: () =>
      Response.json({ token: "BEARER-XYZ" }),
  });
  const client = createInfraClient({ baseUrl: BASE, fetchImpl: cap.impl });
  const bearer = await client.exchange("mtk_opaque");
  assertEquals(bearer, "BEARER-XYZ");
  assertEquals(cap.box.last?.method, "POST");
  assertEquals(cap.box.last?.url, `${BASE}/api/authz/exchange`);
  assertEquals(cap.box.last?.body, { token: "mtk_opaque" });
});

Deno.test("login POSTs {idToken,email} to /api/session/login and returns the bearer", async () => {
  const cap = captureFetch({
    [`${BASE}/api/session/login`]: () => Response.json({ token: "FB-BEARER" }),
  });
  const client = createInfraClient({ baseUrl: BASE, fetchImpl: cap.impl });
  const bearer = await client.login("fb-id-token", "a@b.com");
  assertEquals(bearer, "FB-BEARER");
  assertEquals(cap.box.last?.body, {
    idToken: "fb-id-token",
    email: "a@b.com",
  });
});

Deno.test("exchange/login honor path overrides", async () => {
  const cap = captureFetch({
    [`${BASE}/x/exch`]: () => Response.json({ token: "T" }),
  });
  const client = createInfraClient({
    baseUrl: BASE,
    exchangePath: "/x/exch",
    fetchImpl: cap.impl,
  });
  assertEquals(await client.exchange("t"), "T");
});

Deno.test("exchangeProfile surfaces infra's real {name,email} alongside the bearer", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/api/authz/exchange`]: () =>
        Response.json({
          token: "BEARER-XYZ",
          name: "Alfred Pennyworth",
          email: "alfred@wayne.co",
        }),
    }),
  });
  assertEquals(await client.exchangeProfile("mtk_opaque"), {
    token: "BEARER-XYZ",
    name: "Alfred Pennyworth",
    email: "alfred@wayne.co",
  });
});

Deno.test("loginProfile reads a profile nested under `user`", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/api/session/login`]: () =>
        Response.json({
          token: "FB-BEARER",
          user: { name: "Bruce", email: "bruce@wayne.co" },
        }),
    }),
  });
  assertEquals(await client.loginProfile("fb-id", "bruce@wayne.co"), {
    token: "FB-BEARER",
    name: "Bruce",
    email: "bruce@wayne.co",
  });
});

Deno.test("exchangeProfile omits name/email when an older infra returns only a token", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/api/authz/exchange`]: () => Response.json({ token: "T-ONLY" }),
    }),
  });
  const env = await client.exchangeProfile("t");
  assertEquals(env.token, "T-ONLY");
  assertEquals(env.name, undefined);
  assertEquals(env.email, undefined);
});

Deno.test("exchange throws InfraError on a non-2xx", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/api/authz/exchange`]: () =>
        new Response("nope", { status: 401 }),
    }),
  });
  const err = await assertRejects(() => client.exchange("bad"), InfraError);
  assertEquals(err.status, 401);
});

Deno.test("exchange throws when infra returns no token", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/api/authz/exchange`]: () => Response.json({ notToken: 1 }),
    }),
  });
  const err = await assertRejects(() => client.exchange("t"), InfraError);
  assertEquals(err.status, 502);
});
