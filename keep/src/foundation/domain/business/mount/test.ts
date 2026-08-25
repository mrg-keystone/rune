import { assertEquals } from "#assert";
import { withBasePath } from "./mod.ts";
import type { FetchHandler } from "@types";

function spy() {
  const seen: string[] = [];
  const handler: FetchHandler = (req) => {
    seen.push(new URL(req.url).pathname);
    return new Response("ok");
  };
  return { handler, seen };
}

Deno.test("strips the base path before dispatching", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler)();

  const res = await mounted(new Request("http://app/api/users"));
  assertEquals(res.status, 200);
  assertEquals(seen[0], "/users");
});

Deno.test("the bare base path maps to root", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler)();

  await mounted(new Request("http://app/api"));
  assertEquals(seen[0], "/");
});

Deno.test("non-matching paths return 404 without dispatching", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler)();

  const res = await mounted(new Request("http://app/health"));
  assertEquals(res.status, 404);
  assertEquals(seen.length, 0);
});

Deno.test("a prefix that is only a substring does not match", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler)();

  const res = await mounted(new Request("http://app/apiv2/x"));
  assertEquals(res.status, 404);
  assertEquals(seen.length, 0);
});

Deno.test("normalizes a base path given with/without slashes", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("api/", handler)();

  await mounted(new Request("http://app/api/orders/1"));
  assertEquals(seen[0], "/orders/1");
});

Deno.test("forwards Deno conn info to the mounted handler", async () => {
  let seenInfo: unknown;
  const handler: FetchHandler = (_req, info) => {
    seenInfo = info;
    return new Response("ok");
  };
  const mounted = withBasePath("/api", handler)();
  const info = {
    remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
  };
  // deno-lint-ignore no-explicit-any
  await mounted(new Request("http://app/api/users"), info as any);
  assertEquals(seenInfo, info);
});

Deno.test("preserves method, headers, and query", async () => {
  const seen: Request[] = [];
  const handler: FetchHandler = (req) => {
    seen.push(req);
    return new Response("ok");
  };
  const mounted = withBasePath("/api", handler)();

  await mounted(
    new Request("http://app/api/users?role=admin", {
      method: "POST",
      headers: { "x-test": "1" },
    }),
  );

  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].headers.get("x-test"), "1");
  assertEquals(new URL(seen[0].url).search, "?role=admin");
});

Deno.test("layer form: an inner receives everything the prefix does not match", async () => {
  const { handler, seen } = spy();
  const innerSeen: string[] = [];
  const layer = withBasePath("/api", handler)((req, _info, client) => {
    innerSeen.push(new URL(req.url).pathname + ":" + String(client));
    return new Response("front");
  });
  const res = await layer(new Request("http://app/dashboard"), undefined, "CAP");
  assertEquals(await res.text(), "front");
  assertEquals(innerSeen, ["/dashboard:CAP"], "delegate forwards the third argument unchanged");
  assertEquals(seen.length, 0);
});

Deno.test("layer form: intercept also forwards the third argument", async () => {
  let seenClient: unknown;
  const layer = withBasePath("/api", (_req, _info, client) => {
    seenClient = client;
    return new Response("ok");
  })();
  await layer(new Request("http://app/api/x"), undefined, "CAP");
  assertEquals(seenClient, "CAP");
});
