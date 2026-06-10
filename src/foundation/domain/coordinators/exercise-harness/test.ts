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
