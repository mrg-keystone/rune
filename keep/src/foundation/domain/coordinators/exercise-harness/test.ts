import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import { IsString } from "class-validator";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";
import { exerciseEndpoints } from "./mod.ts";

class CreateUserDto {
  @ApiProperty()
  name!: string;
}
class UserRefDto {
  @ApiProperty()
  id!: string;
}
class UserDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
}

@EndpointController("users")
class UsersController {
  @Endpoint({ input: CreateUserDto, output: UserDto, order: 1 })
  create(body: CreateUserDto): UserDto {
    return { id: "u_1", name: body.name ?? "anon" };
  }

  // Depends on create and binds its id; throws if the id never arrived — so a green run *proves*
  // the harness chained create's output into this request.
  @Endpoint({
    path: "fetch",
    input: UserRefDto,
    output: UserDto,
    order: 2,
    dependsOn: "create",
    bind: { id: "create.id" },
  })
  fetch(body: UserRefDto): UserDto {
    if (!body?.id) throw new Error("missing id — chaining did not happen");
    return { id: body.id, name: "fetched" };
  }
}

const UsersModule = endpointModule("Users", [UsersController]);

Deno.test("exerciseEndpoints - orders, runs, and auto-chains in-process", async () => {
  const server = await bootstrapServer("harness-app", UsersModule);
  try {
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.order, ["create", "fetch"]);
    assertEquals(report.cycles, []);
    assertEquals(report.failed.map((r) => r.id), []);
    assertEquals(report.passed.map((r) => r.id).sort(), ["create", "fetch"]);
    assert(report.iterations >= 1);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - seeds satisfy an endpoint when no producer exists", async () => {
  const server = await bootstrapServer("harness-app", UsersModule);
  try {
    // Drop the producer's contribution by seeding the id directly; fetch must still pass.
    const report = await exerciseEndpoints({
      api: server,
      overrides: { byEndpoint: { fetch: { id: "seeded" } } },
    });
    assertEquals(report.failed.map((r) => r.id), []);
  } finally {
    await server.stop();
  }
});

// ── external inputs ($var binds) ─────────────────────────────────────────────

class JoinDto {
  @ApiProperty()
  tenantId!: string;
}
class MembershipDto {
  @ApiProperty()
  membershipId!: string;
}

@EndpointController("memberships")
class MembershipsController {
  // tenantId is produced by nothing in this app — it's a declared external input.
  @Endpoint({
    input: JoinDto,
    output: MembershipDto,
    order: 1,
    bind: { tenantId: "$tenantId" },
  })
  join(body: JoinDto): MembershipDto {
    if (!body?.tenantId) {
      throw new Error("missing tenantId — $var was not resolved");
    }
    return { membershipId: `m-${body.tenantId}` };
  }
}

const MembershipsModule = endpointModule("Memberships", [
  MembershipsController,
]);

Deno.test("exerciseEndpoints - $var binds resolve from overrides.seeds", async () => {
  const server = await bootstrapServer("harness-app", MembershipsModule);
  try {
    const report = await exerciseEndpoints({
      api: server,
      overrides: { seeds: { tenantId: "t-99" } },
    });
    assertEquals(report.failed.map((r) => r.id), []);
    assertEquals(report.passed.map((r) => r.id), ["join"]);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - an unseeded $var bind leaves the field unset (endpoint fails)", async () => {
  const server = await bootstrapServer("harness-app", MembershipsModule);
  try {
    const report = await exerciseEndpoints({ api: server, maxIterations: 1 });
    assertEquals(report.failed.map((r) => r.id), ["join"]);
  } finally {
    await server.stop();
  }
});

// ── cross-module chaining (multi-module app) ─────────────────────────────────

class OrderRefDto {
  @ApiProperty()
  userId!: string;
}
class OrderDto {
  @ApiProperty()
  orderId!: string;
}

@EndpointController("orders")
class OrdersController {
  // Binds the OTHER module's create output — the runner flattens all module docs into one graph.
  @Endpoint({
    input: OrderRefDto,
    output: OrderDto,
    order: 10,
    dependsOn: "create",
    bind: { userId: "create.id" },
  })
  place(body: OrderRefDto): OrderDto {
    if (!body?.userId) {
      throw new Error("missing userId — cross-module chaining did not happen");
    }
    return { orderId: `o-${body.userId}` };
  }
}

const OrdersModule = endpointModule("Orders", [OrdersController]);

Deno.test("exerciseEndpoints - chains across modules in a composed app", async () => {
  const server = await bootstrapServer("harness-app", [
    UsersModule,
    OrdersModule,
  ]);
  try {
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.failed.map((r) => r.id), []);
    // users.create runs before orders.place, and its id feeds the cross-module bind.
    assert(report.order.indexOf("create") < report.order.indexOf("place"));
  } finally {
    await server.stop();
  }
});

// ── field-source binding (path / path* / query / header) ───────────────────

// rune always emits a class-validator decorator per [TYP] field (here @IsString from `: string`).
class ProxyReqDto {
  @ApiProperty()
  @IsString()
  target!: string; // from=path
  @ApiProperty()
  @IsString()
  rest!: string; // from=path* (catch-all remainder)
  @ApiProperty()
  @IsString()
  q!: string; // from=query
  @ApiProperty()
  @IsString()
  auth!: string; // from=header
  @ApiProperty()
  @IsString()
  payload!: string; // body
}
class ProxyEchoDto {
  @ApiProperty()
  @IsString()
  echo!: string;
}

@EndpointController("gw")
class GatewayController {
  // Mirrors what `rune manifest` emits for an [ENT] whose input DTO has [TYP:from=...] fields.
  @Endpoint({
    path: "proxy/:target/:rest{.+}",
    input: ProxyReqDto,
    output: ProxyEchoDto,
    order: 1,
    sources: { target: "path", rest: "path*", q: "query", auth: "header" },
  })
  proxy(body: ProxyReqDto): ProxyEchoDto {
    // Echo every field so a green walk PROVES each arrived from its declared source.
    return {
      echo: [body.target, body.rest, body.q, body.auth, body.payload].join("|"),
    };
  }
}

const GatewayModule = endpointModule("Gateway", [GatewayController]);

Deno.test("exerciseEndpoints - binds path/path*/query/header from sources, body for the rest", async () => {
  const server = await bootstrapServer("gw-app", GatewayModule);
  try {
    const report = await exerciseEndpoints({
      api: server,
      overrides: {
        seeds: {
          target: "api.example.com",
          rest: "v1/users/42", // a slash-spanning catch-all remainder
          q: "widgets",
          auth: "Bearer t0ken",
          payload: "hello",
        },
      },
    });
    assertEquals(report.failed.map((r) => r.id), []);
    assertEquals(report.passed.map((r) => r.id), ["proxy"]);
    // The echo proves each field was bound from its source (incl. the slash-spanning catch-all).
    const row = report.passed.find((r) => r.id === "proxy")!;
    assertEquals(
      (row.body as { echo: string }).echo,
      "api.example.com|v1/users/42|widgets|Bearer t0ken|hello",
    );
  } finally {
    await server.stop();
  }
});

// ── contract auto-wiring ($input ← composed producer) ───────────────────────

class EnrollDto {
  @ApiProperty()
  plan!: string;
}
class MemberDto {
  @ApiProperty()
  memberId!: string;
}
class GreetDto {
  @ApiProperty()
  memberId!: string;
}
class GreetedDto {
  @ApiProperty()
  greetedId!: string;
}

@EndpointController("members")
class MembersController {
  @Endpoint({ input: EnrollDto, output: MemberDto, order: 1 })
  enroll(_body: EnrollDto): MemberDto {
    return { memberId: "m-77" };
  }
}

// What greet actually received — lets the tests tell a produced value from a seeded one.
const greetReceived: string[] = [];

@EndpointController("welcome")
class WelcomeController {
  // memberId is external to THIS module ($input) — but the composed members module produces it.
  @Endpoint({
    input: GreetDto,
    output: GreetedDto,
    order: 1,
    bind: { memberId: "$memberId" },
  })
  greet(body: GreetDto): GreetedDto {
    if (!body?.memberId) {
      throw new Error("missing memberId — the contract was not auto-wired");
    }
    greetReceived.push(body.memberId);
    return { greetedId: `g-${body.memberId}` };
  }
}

const MembersModule = endpointModule("Members", [MembersController]);
const WelcomeModule = endpointModule("Welcome", [WelcomeController]);

Deno.test("exerciseEndpoints - a composed producer satisfies a $input with no seeds", async () => {
  const server = await bootstrapServer("harness-app", [
    MembersModule,
    WelcomeModule,
  ]);
  try {
    greetReceived.length = 0;
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.failed.map((r) => r.id), []);
    // The synthetic contract edge orders the producer before the consumer.
    assert(
      report.order.indexOf("enroll") < report.order.indexOf("greet"),
      `producer must run first: ${report.order}`,
    );
    assertEquals(greetReceived, ["m-77"]);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - overrides.seeds beat the composed producer", async () => {
  const server = await bootstrapServer("harness-app", [
    MembersModule,
    WelcomeModule,
  ]);
  try {
    greetReceived.length = 0;
    const report = await exerciseEndpoints({
      api: server,
      overrides: { seeds: { memberId: "seeded-1" } },
    });
    assertEquals(report.failed.map((r) => r.id), []);
    // greet echoed the SEEDED value, not the producer's capture.
    assertEquals(greetReceived, ["seeded-1"]);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - the synthetic contract edge never leaks into the doc metadata", async () => {
  // The SpecEndpoint objects are fresh per run, but their dependsOn arrays alias the doc's
  // x-keep-process (and, through it, the decorator metadata). The synthetic producer edge must
  // stay private to the run: leaking "enroll" into greet's dependsOn would block the emulator's
  // run-all (the edge points outside the page) for every later bootstrap in the same process.
  const dependsOnOf = (api: { docs: { path: string; doc: unknown }[] }) => {
    const doc = api.docs.find((d) => d.path === "/welcome")!
      .doc as {
        paths: Record<
          string,
          { post?: { "x-keep-process"?: { dependsOn?: string[] } } }
        >;
      };
    return doc.paths["/welcome"].post!["x-keep-process"]!.dependsOn ?? [];
  };
  const server = await bootstrapServer("harness-app", [
    MembersModule,
    WelcomeModule,
  ]);
  try {
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.failed.map((r) => r.id), []);
    assertEquals(dependsOnOf(server), []);
  } finally {
    await server.stop();
  }
  // A brand-new bootstrap in the same process sees clean metadata too.
  const fresh = await bootstrapServer("harness-app", [
    MembersModule,
    WelcomeModule,
  ]);
  try {
    assertEquals(dependsOnOf(fresh), []);
  } finally {
    await fresh.stop();
  }
});

// ── flows (XOR branches) + OR-bind + optional ────────────────────────────────

class StartDto {
  @ApiProperty()
  kind!: string;
}
class TicketDto {
  @ApiProperty()
  ticketId!: string;
}
class PayDto {
  @ApiProperty()
  ticketId!: string;
}
class PaymentDto {
  @ApiProperty()
  paymentId!: string;
}
class FulfillDto {
  @ApiProperty()
  paymentId!: string;
}
class DoneDto {
  @ApiProperty()
  done!: boolean;
}

@EndpointController("checkout")
class CheckoutController {
  @Endpoint({ path: "start", input: StartDto, output: TicketDto, order: 1 })
  start(_body: StartDto): TicketDto {
    return { ticketId: "t-1" };
  }

  @Endpoint({
    path: "pay-card",
    input: PayDto,
    output: PaymentDto,
    order: 2,
    dependsOn: "start",
    bind: { ticketId: "start.ticketId" },
    flows: "card",
  })
  payCard(body: PayDto): PaymentDto {
    if (!body?.ticketId) throw new Error("missing ticketId");
    return { paymentId: `card-${body.ticketId}` };
  }

  @Endpoint({
    path: "pay-cash",
    input: PayDto,
    output: PaymentDto,
    order: 2,
    dependsOn: "start",
    bind: { ticketId: "start.ticketId" },
    flows: "cash",
  })
  payCash(body: PayDto): PaymentDto {
    if (!body?.ticketId) throw new Error("missing ticketId");
    return { paymentId: `cash-${body.ticketId}` };
  }

  // The join: depends on every alternative; the OR-bind takes whichever payment ran.
  @Endpoint({
    path: "fulfill",
    input: FulfillDto,
    output: DoneDto,
    order: 3,
    dependsOn: ["payCard", "payCash"],
    bind: { paymentId: ["payCard.paymentId", "payCash.paymentId"] },
  })
  fulfill(body: FulfillDto): DoneDto {
    if (!body?.paymentId) {
      throw new Error("missing paymentId — OR-bind did not resolve");
    }
    return { done: true };
  }

  // A side quest that always fails — must not fail the report.
  @Endpoint({
    path: "survey",
    input: StartDto,
    output: DoneDto,
    order: 4,
    optional: true,
  })
  survey(_body: StartDto): DoneDto {
    throw new Error("nobody answers surveys");
  }
}

const CheckoutModule = endpointModule("Checkout", [CheckoutController]);

Deno.test("exerciseEndpoints - a flow exercises one branch; OR-bind takes the survivor", async () => {
  const server = await bootstrapServer("harness-app", CheckoutModule);
  try {
    const card = await exerciseEndpoints({ api: server, flow: "card" });
    // payCash is excluded; everything else (incl. untagged start/fulfill/survey) runs.
    assert(
      !card.order.includes("payCash"),
      `cash branch leaked into the card flow: ${card.order}`,
    );
    assertEquals(card.failed.map((r) => r.id), []);
    assertEquals(card.optionalFailed.map((r) => r.id), ["survey"]);
    assert(
      card.passed.map((r) => r.id).includes("fulfill"),
      "the join must pass via the card branch",
    );

    const cash = await exerciseEndpoints({ api: server, flow: "cash" });
    assert(!cash.order.includes("payCard"));
    assertEquals(cash.failed.map((r) => r.id), []);
  } finally {
    await server.stop();
  }
});

// ── composed-module id collisions (same operationId in two modules) ───────────

class TagDto {
  @ApiProperty()
  tag!: string;
}

@EndpointController("alpha")
class AlphaCatalog {
  @Endpoint({ output: TagDto, order: 1 })
  list(): TagDto {
    return { tag: "a" };
  }
}

@EndpointController("beta")
class BetaCatalog {
  @Endpoint({ output: TagDto, order: 1 })
  list(): TagDto {
    return { tag: "b" };
  }
}

const AlphaModule = endpointModule("Alpha", [AlphaCatalog]);
const BetaModule = endpointModule("Beta", [BetaCatalog]);

Deno.test("exerciseEndpoints - same operationId across composed modules does not collide", async () => {
  const server = await bootstrapServer("harness-app", [
    AlphaModule,
    BetaModule,
  ]);
  try {
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.failed.map((r) => r.id), []);
    // Keying results/captures by bare id would drop one `list`; both must run and be reported,
    // each tagged with its own module.
    const lists = report.passed.filter((r) => r.id === "list");
    assertEquals(lists.length, 2);
    assertEquals(new Set(lists.map((r) => r.module)).size, 2);
    assertEquals(report.order.filter((id) => id === "list").length, 2);
  } finally {
    await server.stop();
  }
});

// ── cycle-blind synthetic edges (mutual $input producers) ────────────────────

class RingAIn {
  @ApiProperty()
  b!: string;
}
class RingAOut {
  @ApiProperty()
  a!: string;
}
class RingBIn {
  @ApiProperty()
  a!: string;
}
class RingBOut {
  @ApiProperty()
  b!: string;
}

@EndpointController("ring")
class RingController {
  // Each endpoint produces the field the other consumes as a $input — first-wins synthetic
  // edges would wire alpha↔beta into a cycle.
  @Endpoint({ input: RingAIn, output: RingAOut, order: 1, bind: { b: "$b" } })
  alpha(_body: RingAIn): RingAOut {
    return { a: "A" };
  }

  @Endpoint({ input: RingBIn, output: RingBOut, order: 2, bind: { a: "$a" } })
  beta(_body: RingBIn): RingBOut {
    return { b: "B" };
  }
}

const RingModule = endpointModule("Ring", [RingController]);

Deno.test("exerciseEndpoints - mutual $input producers don't create a cycle", async () => {
  const server = await bootstrapServer("harness-app", RingModule);
  try {
    const report = await exerciseEndpoints({ api: server });
    // The cycle-creating synthetic edge is skipped, so the order stays acyclic and both pass.
    assertEquals(report.cycles, []);
    assertEquals(report.failed.map((r) => r.id), []);
  } finally {
    await server.stop();
  }
});

// ── string seeds coerced to the declared schema type ─────────────────────────

class CountDto {
  @ApiProperty()
  n!: number;
}
class EchoDto {
  @ApiProperty()
  n!: number;
}

@EndpointController("counter")
class CounterController {
  @Endpoint({ input: CountDto, output: EchoDto, order: 1 })
  echo(body: CountDto): EchoDto {
    // Throws unless it received a real number — so a green run proves coercion happened.
    if (typeof body.n !== "number") {
      throw new Error("expected a number, got " + typeof body.n);
    }
    return { n: body.n };
  }
}

const CounterModule = endpointModule("Counter", [CounterController]);

Deno.test("exerciseEndpoints - string seeds are coerced to the declared schema type", async () => {
  const server = await bootstrapServer("harness-app", CounterModule);
  try {
    // The seed is the STRING "42"; coercion makes it reach the handler as the number 42.
    const report = await exerciseEndpoints({
      api: server,
      overrides: { seeds: { n: "42" } },
    });
    assertEquals(report.failed.map((r) => r.id), []);
  } finally {
    await server.stop();
  }
});

// ── orderBy module / skip / onResult (the map's Run-all contract) ────────────

Deno.test("exerciseEndpoints - orderBy module walks lane by lane and converges on forward deps", async () => {
  // Docs order puts orders FIRST, but orders.place depends on users.create — the module-grouped
  // walk runs place before its producer exists, fails that pass, and goes green on iteration 2.
  const server = await bootstrapServer("harness-app", [
    OrdersModule,
    UsersModule,
  ]);
  try {
    const rows: string[] = [];
    const report = await exerciseEndpoints({
      api: server,
      orderBy: "module",
      onResult: (r) => rows.push(`${r.module}:${r.id}:${r.ok}`),
    });
    assertEquals(report.failed, []);
    // Lane-by-lane: the orders lane (docs order) first, then users in topological order.
    assertEquals(report.order, ["place", "create", "fetch"]);
    // The stream shows the retry: place fails first, then succeeds after users ran.
    assertEquals(rows[0], "orders:place:false");
    assert(
      rows.includes("orders:place:true"),
      `expected a green retry: ${rows}`,
    );
    const place = report.passed.find((r) => r.id === "place")!;
    assertEquals(place.attempts, 2);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - skip excludes steps from the walk and the report entirely", async () => {
  const server = await bootstrapServer("harness-app", UsersModule);
  try {
    const report = await exerciseEndpoints({
      api: server,
      skip: ["users:fetch"],
    });
    assertEquals(report.passed.map((r) => r.id), ["create"]);
    assertEquals(report.failed, []);
    assert(!report.order.includes("fetch"), "skipped steps leave the order");
  } finally {
    await server.stop();
  }
});

// ── the run-all-green contract: plural fallback, echo awareness, retry, examples ──
// These replicate the generalized failure shapes of real generated apps: a producer returns a
// COLLECTION (tableNames), consumers need ONE element ($tableName) and echo it back; a step
// fails transiently (lease-held); a required field has only its schema example.

class DiscoverOutDto {
  @ApiProperty()
  tableNames!: string[];
}
class EnableDto {
  @ApiProperty()
  tableName!: string;
}
class EnabledDto {
  @ApiProperty()
  tableName!: string; // echoes its input — must NOT count as the producer
  @ApiProperty()
  enabled!: boolean;
}

@EndpointController("catalog")
class CatalogController {
  @Endpoint({ path: "discover", output: DiscoverOutDto, order: 1 })
  discover(): DiscoverOutDto {
    return { tableNames: ["alpha", "beta"] };
  }
  @Endpoint({
    path: "enable",
    input: EnableDto,
    output: EnabledDto,
    order: 2,
    bind: { tableName: "$tableName" },
  })
  enable(body: EnableDto): EnabledDto {
    if (!body?.tableName) throw new Error("tableName should not be empty");
    return { tableName: body.tableName, enabled: true };
  }
}
const CatalogModule = endpointModule("Catalog", [CatalogController]);

@EndpointController("echo-only")
class EchoOnlyController {
  // The ONLY thing outputting tableName is this echo — nothing can bootstrap the value.
  @Endpoint({
    input: EnableDto,
    output: EnabledDto,
    order: 1,
    bind: { tableName: "$tableName" },
  })
  enable(body: EnableDto): EnabledDto {
    return { tableName: body?.tableName ?? "", enabled: true };
  }
}
const EchoOnlyModule = endpointModule("EchoOnly", [EchoOnlyController]);

Deno.test("exerciseEndpoints - $name resolves from a captured plural collection's first element", async () => {
  const server = await bootstrapServer("plural-app", CatalogModule);
  try {
    const report = await exerciseEndpoints({ api: server });
    assertEquals(report.failed, []);
    // The plural producer got the synthetic ordering edge: discover runs first, pass one.
    assert(
      report.order.indexOf("discover") < report.order.indexOf("enable"),
      `producer must run first: ${report.order}`,
    );
    const enable = report.passed.find((r) => r.id === "enable")!;
    assertEquals(enable.attempts, 1);
    assertEquals((enable.body as { tableName: string }).tableName, "alpha");
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - an echo is not a producer: dry run names the unresolved $input", async () => {
  const server = await bootstrapServer("echo-app", EchoOnlyModule);
  try {
    const report = await exerciseEndpoints({ api: server, dryRun: true });
    // Before the echo fix this reported [] — the pre-flight lied.
    assertEquals(report.unresolvedInputs, ["$tableName"]);
  } finally {
    await server.stop();
  }
});

Deno.test("exerciseEndpoints - retry slugs get delayed re-attempts instead of failing the walk", async () => {
  // Fabricated target: fails twice with the slug, then passes — like a single-writer lease.
  let calls = 0;
  const api = {
    backend: {
      fetch: (_path: string, _init?: RequestInit) => {
        calls++;
        return Promise.resolve(
          calls < 3
            ? new Response(
              JSON.stringify({ status: 500, message: "lease-held" }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
            )
            : Response.json({ done: true }),
        );
      },
    },
    docs: [{
      path: "/write",
      doc: {
        info: { title: "write" },
        paths: {
          "/write/resolve": {
            post: {
              operationId: "resolve",
              responses: {},
              "x-keep-process": {
                order: 1,
                dependsOn: [],
                bind: {},
                method: "post",
                path: "resolve",
              },
            },
          },
        },
      },
    }],
    // deno-lint-ignore no-explicit-any
  } as any;
  const report = await exerciseEndpoints({
    api,
    retry: { slugs: ["lease-held"], delayMs: 5, attempts: 3 },
  });
  assertEquals(report.failed, []);
  const resolve = report.passed.find((r) => r.id === "resolve")!;
  assertEquals(resolve.attempts, 3);

  // Without the slug declared retryable, the same failure stays failed in pass one's attempts.
  calls = 0;
  const cold = await exerciseEndpoints({ api, maxIterations: 1 });
  assertEquals(cold.failed.map((r) => r.id), ["resolve"]);
});

Deno.test("exerciseEndpoints - required unbound fields fill from a REAL schema example", async () => {
  // Fabricated target: the doc declares a required field with a meaningful example and one with
  // the empty-string placeholder — only the real example is sent.
  let seenBody: Record<string, unknown> = {};
  const api = {
    backend: {
      fetch: (_path: string, init?: RequestInit) => {
        seenBody = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(Response.json({ ok: true }));
      },
    },
    docs: [{
      path: "/geo",
      doc: {
        info: { title: "geo" },
        paths: {
          "/geo/search": {
            post: {
              operationId: "search",
              requestBody: {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/SearchDto" },
                  },
                },
              },
              responses: {},
              "x-keep-process": {
                order: 1,
                dependsOn: [],
                bind: {},
                method: "post",
                path: "search",
              },
            },
          },
        },
        components: {
          schemas: {
            SearchDto: {
              required: ["region", "query"],
              properties: {
                region: { type: "string", example: "eu-west" },
                query: { type: "string" }, // zero-value example "" — must stay absent
              },
            },
          },
        },
      },
    }],
    // deno-lint-ignore no-explicit-any
  } as any;
  await exerciseEndpoints({ api });
  assertEquals(seenBody.region, "eu-west");
  assert(
    !("query" in seenBody),
    "empty-string placeholder examples must not be sent",
  );
});
