import { assertEquals, assertRejects } from "#assert";
import { createInfraClient, InfraError } from "./mod.ts";

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

Deno.test("exchange returns the session bearer from a JSON {bearer} field", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/manualToken/exchange`]: () =>
        Response.json({ bearer: "eyJ.session.jwt" }),
    }),
  });
  assertEquals(await client.exchange("mtk_abc"), "eyJ.session.jwt");
});

Deno.test("exchange accepts a raw JWT text body", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/manualToken/exchange`]: () =>
        new Response("eyJ.raw.jwt", {
          headers: { "content-type": "text/plain" },
        }),
    }),
  });
  assertEquals(await client.exchange("mtk_abc"), "eyJ.raw.jwt");
});

Deno.test("exchange surfaces a 404 (revoked/unknown) as InfraError with status", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/manualToken/exchange`]: () =>
        new Response("not found", { status: 404 }),
    }),
  });
  const err = await assertRejects(
    () => client.exchange("mtk_gone"),
    InfraError,
  );
  assertEquals(err.status, 404);
});

Deno.test("exchange surfaces a 410 (expired lifetime) as InfraError", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/manualToken/exchange`]: () => new Response("", { status: 410 }),
    }),
  });
  const err = await assertRejects(() => client.exchange("mtk_old"), InfraError);
  assertEquals(err.status, 410);
});

Deno.test("jwks fetches the default /keys/jwks URL", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/keys/jwks`]: () =>
        Response.json({
          keys: [{ kid: "k1", alg: "RS256", publicKey: "pem" }],
        }),
    }),
  });
  const jwks = await client.jwks();
  assertEquals(jwks.keys.length, 1);
  assertEquals(jwks.keys[0].kid, "k1");
});

Deno.test("jwks honors an explicit jwksUrl override", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    jwksUrl: "https://cdn.test/jwks.json",
    fetchImpl: stubFetch({
      "https://cdn.test/jwks.json": () => Response.json({ keys: [] }),
    }),
  });
  assertEquals((await client.jwks()).keys, []);
});

Deno.test("revocationStatus reads the revokeAll flag", async () => {
  const client = createInfraClient({
    baseUrl: BASE,
    fetchImpl: stubFetch({
      [`${BASE}/revocation/status`]: () =>
        Response.json({ revokeAll: true, polledAt: "2026-06-14T00:00:00Z" }),
    }),
  });
  const status = await client.revocationStatus();
  assertEquals(status.revokeAll, true);
  assertEquals(status.polledAt, "2026-06-14T00:00:00Z");
});

Deno.test("a trailing slash on baseUrl is trimmed", async () => {
  const client = createInfraClient({
    baseUrl: `${BASE}/`,
    fetchImpl: stubFetch({
      [`${BASE}/revocation/status`]: () => Response.json({ revokeAll: false }),
    }),
  });
  assertEquals((await client.revocationStatus()).revokeAll, false);
});
