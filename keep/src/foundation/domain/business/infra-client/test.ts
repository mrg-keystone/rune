import { assertEquals } from "#assert";
import { createInfraClient } from "./mod.ts";

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
