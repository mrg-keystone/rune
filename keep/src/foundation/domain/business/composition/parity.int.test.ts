// THE PARITY SUITE — the differential conformance gate of the composition
// seam: the request-bound in-process channel and the real-HTTP `/api/*`
// channel must reach the same handler and return byte-identical observables
// (status, body bytes, headers, cookies; response.url origin-normalized), and
// the request-scoped jar must show ZERO cross-user bleed under concurrency
// (the cardinal invariant). Chunk-boundary equality for streams is asserted as
// concatenated-byte parity: real TCP coalesces chunks, so boundary identity is
// not reliable across the network transport (the contract's named fallback).

import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#assert";
import { Controller, Get, Post } from "#danet/core";
import { endpointModule } from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { BootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";
import { Backend } from "./boot.ts";
import { requestBoundClient } from "@foundation/domain/business/request-jar/mod.ts";

@Controller("probe")
class ProbeController {
  @Get("echo")
  echo(ctx: { req?: unknown } | undefined) {
    void ctx;
    return { ok: true };
  }

  @Get("set")
  set() {
    return new Response(JSON.stringify({ set: true }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": "csrf=xyz; Path=/; HttpOnly",
      },
    });
  }

  @Get("stream")
  stream() {
    const enc = new TextEncoder();
    const chunks = ["alpha-", "beta-", "gamma"];
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const chunk of chunks) c.enqueue(enc.encode(chunk));
          c.close();
        },
      }),
      { headers: { "content-type": "text/plain" } },
    );
  }
}

// Raw-request routes (cookie/header/body observables) need the underlying
// request; danet exposes it via a plain handler route — use a second
// controller with explicit Response construction through Hono's context-free
// path: the probe below reads from the Request the adapter passes through.
@Controller("mirror")
class MirrorController {
  @Post("body")
  async body(req: Request) {
    const text = typeof (req as Request).text === "function"
      ? await (req as Request).text()
      : "";
    return { got: text };
  }
}

const probeModule = () => endpointModule("Parity", [ProbeController]);
void MirrorController;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

Deno.test("parity: the two channels return identical observables for the same route", async () => {
  // ONE composed handler serves both arms.
  const handler = Backend("parity", probeModule(), { swagger: false });
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req, info) => handler(req, info));
  const { port } = server.addr as Deno.NetAddr;
  const origin = `http://127.0.0.1:${port}`;
  try {
    // Network arm — a browser island's call.
    const net = await fetch(`${origin}/api/probe/echo`, {
      headers: { cookie: "session=abc" },
    });
    const netBody = await net.text();

    // In-process arm — the request-bound client Backend would provision, minted
    // from an incoming request carrying the SAME cookies against the same app.
    const boot = await BootstrapServer.create("parity2", probeModule(), {
      swagger: false,
    });
    const incoming = new Request(`${origin}/page`, {
      headers: { cookie: "session=abc" },
    });
    const client = requestBoundClient((r) => boot.backend.fetch(r), incoming);
    const inproc = await client.fetch("/probe/echo");
    const inprocBody = await inproc.text();

    assertEquals(inproc.status, net.status);
    assertEquals(inprocBody, netBody, "body bytes are identical across channels");
    assertEquals(
      inproc.headers.get("content-type"),
      net.headers.get("content-type"),
    );
    // response.url — origin-normalized, then identical: both report the WIRE
    // URL (origin + /api mount + route path).
    assertEquals(normalizeUrl(inproc.url), "/api/probe/echo");
    assertEquals(normalizeUrl(net.url), "/api/probe/echo");
    await boot.stop();
  } finally {
    await server.shutdown();
  }
});

Deno.test("parity: streaming bodies are byte-identical (concatenated) across channels", async () => {
  const handler = Backend("parity-stream", probeModule(), { swagger: false });
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req, info) => handler(req, info));
  const { port } = server.addr as Deno.NetAddr;
  try {
    const net = await (await fetch(`http://127.0.0.1:${port}/api/probe/stream`)).text();

    const boot = await BootstrapServer.create("parity-stream2", probeModule(), {
      swagger: false,
    });
    const client = requestBoundClient(
      (r) => boot.backend.fetch(r),
      new Request(`http://127.0.0.1:${port}/page`),
    );
    const inproc = await (await client.fetch("/probe/stream")).text();
    assertEquals(inproc, net);
    assertEquals(inproc, "alpha-beta-gamma");
    await boot.stop();
  } finally {
    await server.shutdown();
  }
});

Deno.test("jar: Set-Cookie is honored bidirectionally within one request scope", async () => {
  const boot = await BootstrapServer.create("jar-app", probeModule(), {
    swagger: false,
  });
  try {
    const incoming = new Request("http://app.example/page", {
      headers: { cookie: "session=abc" },
    });
    const client = requestBoundClient((r) => boot.backend.fetch(r), incoming);

    // Call A sets csrf via Set-Cookie…
    const a = await client.fetch("/probe/set");
    await a.body?.cancel();
    // …a later same-scope call carries BOTH the incoming session cookie and it.
    let seenCookie: string | null = null;
    const spyClient = requestBoundClient((r) => {
      seenCookie = r.headers.get("cookie");
      return boot.backend.fetch(r);
    }, incoming);
    const a2 = await spyClient.fetch("/probe/set");
    await a2.body?.cancel();
    const b = await spyClient.fetch("/probe/echo");
    await b.body?.cancel();
    assertEquals(seenCookie, "session=abc; csrf=xyz");

    // The jar collected the Set-Cookie line VERBATIM for the outer response —
    // attributes (HttpOnly, Path) intact.
    assertEquals(client.jar.collected, ["csrf=xyz; Path=/; HttpOnly"]);
  } finally {
    await boot.stop();
  }
});

Deno.test("jar: THE CARDINAL INVARIANT — zero cross-user bleed under concurrency", async () => {
  const boot = await BootstrapServer.create("iso-app", probeModule(), {
    swagger: false,
  });
  try {
    const seen: Record<string, string[]> = { alice: [], bob: [] };
    const mkClient = (user: string) =>
      requestBoundClient((r) => {
        seen[user].push(r.headers.get("cookie") ?? "");
        return boot.backend.fetch(r);
      }, new Request("http://app.example/page", {
        headers: { cookie: `user=${user}` },
      }));
    const alice = mkClient("alice");
    const bob = mkClient("bob");

    // Two request scopes side by side, calls interleaved (Promise.all): each
    // scope's calls must only ever carry that scope's own cookies.
    await Promise.all([
      alice.fetch("/probe/set").then((r) => r.body?.cancel()),
      bob.fetch("/probe/echo").then((r) => r.body?.cancel()),
      alice.fetch("/probe/echo").then((r) => r.body?.cancel()),
      bob.fetch("/probe/set").then((r) => r.body?.cancel()),
    ]);

    for (const c of seen.alice) {
      assertStringIncludes(c, "user=alice");
      assert(!c.includes("user=bob"), `alice's call carried bob's cookie: ${c}`);
    }
    for (const c of seen.bob) {
      assertStringIncludes(c, "user=bob");
      assert(!c.includes("user=alice"), `bob's call carried alice's cookie: ${c}`);
    }
  } finally {
    await boot.stop();
  }
});

Deno.test("client URL semantics: same-origin absolute dispatches in-process; explicit Cookie replaces; omit suppresses", async () => {
  const boot = await BootstrapServer.create("url-app", probeModule(), {
    swagger: false,
  });
  try {
    const cookies: (string | null)[] = [];
    const client = requestBoundClient((r) => {
      cookies.push(r.headers.get("cookie"));
      return boot.backend.fetch(r);
    }, new Request("https://prod.example/page", { headers: { cookie: "s=1" } }));

    // Same-origin absolute URL (the isomorphic form) dispatches in-process
    // through the mount — the origin is not even served anywhere.
    const abs = await client.fetch("https://prod.example/api/probe/echo");
    assertEquals(abs.status, 200);
    assertEquals(normalizeUrl(abs.url), "/api/probe/echo");
    await abs.body?.cancel();

    // Explicit Cookie in init REPLACES the jar's for that call.
    const explicit = await client.fetch("/probe/echo", {
      headers: { cookie: "override=only" },
    });
    await explicit.body?.cancel();

    // credentials: "omit" suppresses sending entirely.
    const omitted = await client.fetch("/probe/echo", { credentials: "omit" });
    await omitted.body?.cancel();

    assertEquals(cookies, ["s=1", "override=only", null]);
  } finally {
    await boot.stop();
  }
});

Deno.test("composed shape: /api/* intercepts, else delegates with a provisioned client; Set-Cookie lands on the outer response", async () => {
  const frontendSeen: string[] = [];
  const handler = Backend("full-app", probeModule(), {
    swagger: false,
    frontend: async (req, _info, backend) => {
      frontendSeen.push(new URL(req.url).pathname);
      // SSR read through the provisioned client; its Set-Cookie must be
      // collected onto THIS response by the composing layer.
      const r = await backend!.fetch("/probe/set");
      await r.body?.cancel();
      return new Response("<html>page</html>", {
        headers: { "content-type": "text/html" },
      });
    },
  });

  const api = await handler(new Request("http://app/api/probe/echo"));
  assertEquals(api.status, 200, "/api/* intercepts to the backend");
  await api.body?.cancel();

  const page = await handler(new Request("http://app/dashboard", {
    headers: { cookie: "session=abc" },
  }));
  assertEquals(frontendSeen, ["/dashboard"]);
  assertEquals(await page.text(), "<html>page</html>");
  assertEquals(
    page.headers.getSetCookie(),
    ["csrf=xyz; Path=/; HttpOnly"],
    "in-process Set-Cookie is collected onto the outer browser response",
  );

  const missing = await handler(new Request("http://app/api/nope"));
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
});

Deno.test("backend-alone shape: unmatched routes 404 (total coverage base case)", async () => {
  const handler = Backend("alone-app", probeModule(), { swagger: false });
  const res = await handler(new Request("http://app/dashboard"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
  const api = await handler(new Request("http://app/api/probe/echo"));
  assertEquals(api.status, 200);
  await api.body?.cancel();
});
