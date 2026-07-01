import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";
import { Public } from "@foundation/domain/business/public-route/mod.ts";
import { span, tracer, traceUser } from "./mod.ts";

// The calc endpoints are @Public so a network caller reaches them (there is no localhost trust);
// tracing is unaffected. The /docs/_traces control plane trusts only the in-process client
// (internal key, via backend.fetch) or a dev/* bearer — off-host network calls are denied.
const loopback = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
};
const offhost = {
  remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
};
// deno-lint-ignore no-explicit-any
const conn = (info: unknown) => info as any;

class InDto {
  @ApiProperty()
  n!: number;
}
class OutDto {
  @ApiProperty()
  doubled!: number;
}

@EndpointController("calc")
class CalcController {
  @Public()
  @Endpoint({ input: InDto, output: OutDto, order: 1 })
  async work(body: InDto): Promise<OutDto> {
    // A user function shows up as its own segment inside the request bar.
    const doubled = await span("double", async () => {
      await span("inner-add", () => body.n + body.n);
      return body.n * 2;
    });
    return { doubled };
  }

  @Public()
  @Endpoint({ path: "boom", input: InDto, output: OutDto, order: 2 })
  async boom(_body: InDto): Promise<OutDto> {
    await span("explode", () => {
      throw new Error("kaboom");
    });
    return { doubled: 0 };
  }

  @Public()
  @Endpoint({ path: "labeled", input: InDto, output: OutDto, order: 3 })
  labeled(body: InDto): OutDto {
    // The app labels the trace with its own notion of a user.
    traceUser("member-" + body.n);
    return { doubled: body.n };
  }
}

const mod = endpointModule("Calc", [CalcController]);

const post = (path: string, body: unknown) =>
  new Request("http://app" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("a real request records a trace with the user span nested under the request root", async () => {
  const api = await bootstrapServer("traceapp", mod);
  await tracer.clear();

  const res = await api.handler(post("/calc", { n: 21 }), conn(loopback));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).doubled, 42);

  const list = await tracer.list();
  const trace = list.find((t) => t.route === "/calc");
  assert(trace, "the request was traced");
  assertEquals(trace!.method, "POST");
  assertEquals(trace!.status, 200);
  assertEquals(trace!.ok, true);

  const root = trace!.spans.find((s) => s.id === 1)!;
  assertEquals(root.kind, "request");
  const dbl = trace!.spans.find((s) => s.name === "double")!;
  const inner = trace!.spans.find((s) => s.name === "inner-add")!;
  assertEquals(dbl.parentId, 1, "user span under the request root");
  assertEquals(inner.parentId, dbl.id, "nested user span under its caller");
});

Deno.test("a crashing request marks the crash on the exact span that threw", async () => {
  const api = await bootstrapServer("traceapp", mod);
  await tracer.clear();

  const res = await api.handler(post("/calc/boom", { n: 1 }), conn(loopback));
  assert(res.status >= 500, "the handler throw surfaces as a 5xx");

  const trace = (await tracer.list()).find((t) => t.route === "/calc/boom")!;
  assert(trace, "the crash was traced");
  assertEquals(trace.ok, false);
  const explode = trace.spans.find((s) => s.name === "explode")!;
  assertEquals(trace.crashedSpanId, explode.id);
  assertEquals(explode.error?.message, "kaboom");
});

Deno.test("traceUser labels the trace; an unlabeled call stays anonymous", async () => {
  const api = await bootstrapServer("traceapp", mod);
  await tracer.clear();

  await api.handler(post("/calc/labeled", { n: 42 }), conn(loopback));
  await api.handler(post("/calc", { n: 1 }), conn(loopback));

  const labeled = (await tracer.list()).find((t) =>
    t.route === "/calc/labeled"
  )!;
  assertEquals(labeled.user, "member-42");

  // No token + no traceUser() → no user (a @Public caller is unauthenticated).
  const anon = (await tracer.list()).find((t) => t.route === "/calc")!;
  assertEquals(anon.user, undefined);
});

Deno.test("/docs/_traces is control-plane gated and tooling routes are not traced", async () => {
  const api = await bootstrapServer("traceapp", mod);
  await tracer.clear();

  // Prime one real trace, then load the map (a /docs tooling route).
  await api.handler(post("/calc", { n: 2 }), conn(loopback));
  await api.handler(new Request("http://app/docs/_map"), conn(loopback));

  // Off-host callers are refused the data.
  const denied = await api.handler(
    new Request("http://app/docs/_traces"),
    conn(offhost),
  );
  assertEquals(denied.status, 403);

  // The in-process client gets the JSON; the map view did NOT create a trace of its own.
  const ok = await api.backend.fetch(new Request("http://app/docs/_traces"));
  assertEquals(ok.status, 200);
  const data = await ok.json();
  assert(data.traces.some((t: { route: string }) => t.route === "/calc"));
  assert(
    !data.traces.some((t: { route: string }) => t.route.startsWith("/docs")),
    "tooling routes are excluded from tracing",
  );
});
