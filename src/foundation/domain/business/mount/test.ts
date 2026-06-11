import { assertEquals } from "#assert";
import { embed, withBasePath } from "./mod.ts";
import type { EmbedContext } from "./mod.ts";
import { createBackendClient } from "@foundation/domain/business/backend-client/mod.ts";
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
  const mounted = withBasePath("/api", handler);

  const res = await mounted(new Request("http://app/api/users"));
  assertEquals(res.status, 200);
  assertEquals(seen[0], "/users");
});

Deno.test("the bare base path maps to root", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler);

  await mounted(new Request("http://app/api"));
  assertEquals(seen[0], "/");
});

Deno.test("non-matching paths return 404 without dispatching", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler);

  const res = await mounted(new Request("http://app/health"));
  assertEquals(res.status, 404);
  assertEquals(seen.length, 0);
});

Deno.test("a prefix that is only a substring does not match", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("/api", handler);

  const res = await mounted(new Request("http://app/apiv2/x"));
  assertEquals(res.status, 404);
  assertEquals(seen.length, 0);
});

Deno.test("normalizes a base path given with/without slashes", async () => {
  const { handler, seen } = spy();
  const mounted = withBasePath("api/", handler);

  await mounted(new Request("http://app/api/orders/1"));
  assertEquals(seen[0], "/orders/1");
});

Deno.test("forwards Deno conn info to the mounted handler", async () => {
  let seenInfo: unknown;
  const handler: FetchHandler = (_req, info) => {
    seenInfo = info;
    return new Response("ok");
  };
  const mounted = withBasePath("/api", handler);
  const info = {
    remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
  };
  // deno-lint-ignore no-explicit-any
  await mounted(new Request("http://app/api/users"), info as any);
  assertEquals(seenInfo, info);
});

function freshCtx(url: string, info?: Deno.ServeHandlerInfo) {
  const ctx: EmbedContext & { nextCalls: number } = {
    req: new Request(url),
    info,
    state: {},
    nextCalls: 0,
    next() {
      this.nextCalls++;
      return new Response("from-fresh");
    },
  };
  return ctx;
}

Deno.test("embed: dispatches /api paths to the backend with the prefix stripped", async () => {
  const { handler, seen } = spy();
  const middleware = embed({ handler, backend: createBackendClient(handler) });

  const res = await middleware(freshCtx("http://app/api/users"));
  assertEquals(await res.text(), "ok");
  assertEquals(seen[0], "/users");
});

Deno.test("embed: forwards Fresh conn info to the backend handler", async () => {
  let seenInfo: unknown;
  const handler: FetchHandler = (_req, info) => {
    seenInfo = info;
    return new Response("ok");
  };
  const info = {
    remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
  };
  const middleware = embed({ handler, backend: createBackendClient(handler) });

  // deno-lint-ignore no-explicit-any
  await middleware(freshCtx("http://app/api/users", info as any));
  assertEquals(seenInfo, info);
});

Deno.test("embed: other paths get state.api and fall through to next()", async () => {
  const { handler, seen } = spy();
  const backend = createBackendClient(handler);
  const middleware = embed({ handler, backend });

  const ctx = freshCtx("http://app/users");
  const res = await middleware(ctx);
  assertEquals(await res.text(), "from-fresh");
  assertEquals(ctx.nextCalls, 1);
  assertEquals(ctx.state.api, backend);
  assertEquals(seen.length, 0);
});

Deno.test("embed: the bare mount path maps to the backend root", async () => {
  const { handler, seen } = spy();
  const middleware = embed({ handler, backend: createBackendClient(handler) });

  await middleware(freshCtx("http://app/api"));
  assertEquals(seen[0], "/");
});

Deno.test("embed: a prefix that is only a substring falls through to Fresh", async () => {
  const { handler, seen } = spy();
  const middleware = embed({ handler, backend: createBackendClient(handler) });

  const ctx = freshCtx("http://app/apiv2/x");
  const res = await middleware(ctx);
  assertEquals(await res.text(), "from-fresh");
  assertEquals(seen.length, 0);
});

Deno.test("embed: honors a custom mount path", async () => {
  const { handler, seen } = spy();
  const middleware = embed({ handler, backend: createBackendClient(handler) }, {
    at: "/backend",
  });

  await middleware(freshCtx("http://app/backend/orders/1"));
  assertEquals(seen[0], "/orders/1");

  const ctx = freshCtx("http://app/api/users");
  await middleware(ctx);
  assertEquals(ctx.nextCalls, 1);
  assertEquals(seen.length, 1);
});

Deno.test("preserves method, headers, and query", async () => {
  const seen: Request[] = [];
  const handler: FetchHandler = (req) => {
    seen.push(req);
    return new Response("ok");
  };
  const mounted = withBasePath("/api", handler);

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
