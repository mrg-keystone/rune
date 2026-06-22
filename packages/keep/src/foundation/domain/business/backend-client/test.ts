import { assertEquals, assertExists } from "#assert";
import {
  BackendClient,
  createBackendClient,
  INTERNAL_REQUEST_HEADER,
} from "./mod.ts";
import type { FetchHandler } from "@types";

// Records the requests the handler saw, so tests can assert on them.
function spyHandler(respond: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const handler: FetchHandler = (req) => {
    calls.push(req);
    return respond(req);
  };
  return { handler, calls };
}

Deno.test("createBackendClient returns a BackendClient", () => {
  assertExists(createBackendClient(() => new Response()));
});

Deno.test("fetch: dispatches a relative path and returns the raw Response", async () => {
  const { handler, calls } = spyHandler(() =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    })
  );
  const client = new BackendClient(handler);

  const res = await client.fetch("/health");

  assertEquals(calls[0].method, "GET");
  assertEquals(new URL(calls[0].url).pathname, "/health");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("fetch: forwards RequestInit (method, headers, body)", async () => {
  const { handler, calls } = spyHandler(async (req) =>
    new Response(await req.text(), { status: 201 })
  );
  const client = new BackendClient(handler);

  const res = await client.fetch("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Alice" }),
  });

  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].headers.get("content-type"), "application/json");
  assertEquals(res.status, 201);
  assertEquals(await res.text(), JSON.stringify({ name: "Alice" }));
});

Deno.test("fetch: accepts a Request object", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(handler);

  await client.fetch(new Request("http://localhost/ping", { method: "PUT" }));

  assertEquals(calls[0].method, "PUT");
  assertEquals(calls[0].url, "http://localhost/ping");
});

Deno.test("fetch: merges init over a Request input", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(handler);

  await client.fetch(new Request("http://localhost/ping"), {
    method: "DELETE",
  });

  assertEquals(calls[0].method, "DELETE");
});

Deno.test("baseUrl is used when resolving relative input", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(handler, "http://localhost:9999");

  await client.fetch("/ping");

  assertEquals(calls[0].url, "http://localhost:9999/ping");
});

Deno.test("fetch: stamps the internal key header when configured", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(
    handler,
    "http://localhost",
    "secret-internal-key",
  );

  await client.fetch("/health");
  assertEquals(
    calls[0].headers.get(INTERNAL_REQUEST_HEADER),
    "secret-internal-key",
  );
});

Deno.test("fetch: stamps the internal key on a Request input too", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(
    handler,
    "http://localhost",
    "secret-internal-key",
  );

  await client.fetch(new Request("http://localhost/ping", { method: "POST" }));
  assertEquals(
    calls[0].headers.get(INTERNAL_REQUEST_HEADER),
    "secret-internal-key",
  );
  assertEquals(calls[0].method, "POST");
});

Deno.test("fetch: does not stamp a header when no internal key is configured", async () => {
  const { handler, calls } = spyHandler(() => new Response("ok"));
  const client = new BackendClient(handler);

  await client.fetch("/health");
  assertEquals(calls[0].headers.get(INTERNAL_REQUEST_HEADER), null);
});

Deno.test("fetch: is a structural match for the global fetch signature", () => {
  const client = new BackendClient(() => new Response());
  // Assignable to `typeof fetch` — proves it's a true drop-in at the type level.
  const asGlobal: typeof fetch = client.fetch;
  assertExists(asGlobal);
});
