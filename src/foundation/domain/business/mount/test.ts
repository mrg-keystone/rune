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
