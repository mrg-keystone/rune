import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
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
