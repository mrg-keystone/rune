import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "./mod.ts";

// The /docs/_* control plane trusts ONLY the in-process client (internal key) or an infra bearer
// with a dev/* grant — there is NO localhost bypass. `server.backend.fetch` dispatches in-process
// (stamps the internal key); `server.handler` is the network dispatcher (strips it), so off-host
// and no-conn network calls are denied.
const offhost = {
  remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
};

// deno-lint-ignore no-explicit-any
const conn = (info: unknown) => info as any;

const runReq = (body?: unknown) =>
  new Request("http://app/docs/_run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ── fixtures ─────────────────────────────────────────────────────────────────
// A producer module and a consumer module wired only by a `$token` contract input.
class TokenDto {
  @ApiProperty()
  token!: string;
}
class UseDto {
  @ApiProperty()
  token!: string;
}
class UsedDto {
  @ApiProperty()
  usedId!: string;
}

@EndpointController("producer")
class ProducerController {
  @Endpoint({ output: TokenDto, order: 1 })
  mint(): TokenDto {
    return { token: "tok-1" };
  }
}

@EndpointController("consumer")
class ConsumerController {
  @Endpoint({
    input: UseDto,
    output: UsedDto,
    order: 1,
    bind: { token: "$token" },
  })
  use(body: UseDto): UsedDto {
    if (!body?.token) {
      throw new Error("missing token — $input was not satisfied");
    }
    return { usedId: "u-" + body.token };
  }
}

const ProducerModule = endpointModule("Producer", [ProducerController]);
const ConsumerModule = endpointModule("Consumer", [ConsumerController]);

// A forced cycle: two endpoints with explicit mutual dependsOn.
class PingDto {
  @ApiProperty()
  ok!: boolean;
}

@EndpointController("ring")
class CycleController {
  @Endpoint({ path: "ping", output: PingDto, order: 1, dependsOn: "pong" })
  ping(): PingDto {
    return { ok: true };
  }

  @Endpoint({ path: "pong", output: PingDto, order: 2, dependsOn: "ping" })
  pong(): PingDto {
    return { ok: true };
  }
}

const CycleModule = endpointModule("Cycle", [CycleController]);

// ── acceptance ───────────────────────────────────────────────────────────────
Deno.test("POST /docs/_run - in-process walks the composed process, ok:true", async () => {
  const server = await bootstrapServer("run-app", [
    ProducerModule,
    ConsumerModule,
  ]);
  try {
    const res = await server.backend.fetch(runReq({}));
    assertEquals(res.status, 200);
    const report = await res.json();
    assertEquals(report.ok, true);
    assertEquals(report.failed, []);
    assertEquals(report.cycles, []);
    // The producer's mint auto-satisfies the consumer's $token (synthetic edge), zero seeds.
    assert(
      report.order.indexOf("mint") < report.order.indexOf("use"),
      `producer must run first: ${report.order}`,
    );
    // Every row carries its module — bare ids collide across composed modules.
    const use = report.passed.find((r: { id: string }) => r.id === "use");
    assertEquals(use.module, "consumer");
  } finally {
    await server.stop();
  }
});

Deno.test("POST /docs/_run - non-localhost and missing conn info are denied (403)", async () => {
  const server = await bootstrapServer("run-app", [
    ProducerModule,
    ConsumerModule,
  ]);
  try {
    assertEquals((await server.handler(runReq({}), conn(offhost))).status, 403);
    // The network handler strips the internal key ⇒ a no-conn network call fails closed.
    assertEquals((await server.handler(runReq({}))).status, 403);
  } finally {
    await server.stop();
  }
});

Deno.test("POST /docs/_run - seeds in the body satisfy an input with no producer", async () => {
  const server = await bootstrapServer("run-app", ConsumerModule);
  try {
    const res = await server.backend.fetch(
      runReq({ seeds: { token: "seed-9" } }),
    );
    assertEquals(res.status, 200);
    const report = await res.json();
    assertEquals(report.ok, true);
    assertEquals(report.failed, []);
  } finally {
    await server.stop();
  }
});

Deno.test("POST /docs/_run - a forced cycle returns ok:false with the cycle named", async () => {
  const server = await bootstrapServer("run-app", CycleModule);
  try {
    const res = await server.backend.fetch(runReq({}));
    assertEquals(res.status, 200);
    const report = await res.json();
    assertEquals(report.ok, false);
    assert(report.cycles.length > 0, "the cycle must be reported");
    assertEquals([...report.cycles[0]].sort(), ["ping", "pong"]);
  } finally {
    await server.stop();
  }
});

Deno.test("POST /docs/_run - dryRun reports unresolved inputs without executing", async () => {
  const server = await bootstrapServer("run-app", ConsumerModule);
  try {
    const res = await server.backend.fetch(runReq({ dryRun: true }));
    assertEquals(res.status, 200);
    const report = await res.json();
    // $token has no producer and no seed here ⇒ flagged; nothing ran.
    assertEquals(report.unresolvedInputs, ["$token"]);
    assertEquals(report.cycles, []);
    assertEquals(report.passed, undefined);
  } finally {
    await server.stop();
  }
});

Deno.test("POST /docs/_heal - control-plane gated, 503 when no healer is configured", async () => {
  const savedUrl = Deno.env.get("PRIVATE_CLAUDE_URL");
  Deno.env.delete("PRIVATE_CLAUDE_URL");
  const server = await bootstrapServer("run-app", ConsumerModule);
  try {
    const req = () =>
      new Request("http://app/docs/_heal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: { id: "use" } }),
      });
    // deny-by-default: off-host and missing conn info (network handler) both 403
    assertEquals((await server.handler(req(), conn(offhost))).status, 403);
    assertEquals((await server.handler(req())).status, 403);
    // in-process (trusted) but unconfigured → explicit 503 naming the env var
    const res = await server.backend.fetch(req());
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.includes("PRIVATE_CLAUDE_URL"), true);
  } finally {
    if (savedUrl !== undefined) Deno.env.set("PRIVATE_CLAUDE_URL", savedUrl);
    await server.stop();
  }
});
