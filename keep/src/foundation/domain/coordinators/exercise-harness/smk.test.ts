import "#reflect-metadata";
import { assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "@foundation/domain/coordinators/bootstrap-server/mod.ts";
import { exerciseEndpoints } from "./mod.ts";

// Opt-in: Playwright is an optional peer (`npm:playwright`) that pulls a large download. Run with
//   KEEP_PLAYWRIGHT_SMOKE=1 deno test -A --unstable-raw-imports .../smk.test.ts
// to exercise the real over-HTTP path (Playwright's APIRequestContext — no browser binary needed).
const enabled = Deno.env.get("KEEP_PLAYWRIGHT_SMOKE") === "1";

class CreateDto {
  @ApiProperty()
  name!: string;
}
class RefDto {
  @ApiProperty()
  id!: string;
}
class ThingDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
}

@EndpointController("things")
class ThingsController {
  @Endpoint({ input: CreateDto, output: ThingDto, order: 1 })
  create(body: CreateDto): ThingDto {
    return { id: "t_1", name: body.name ?? "anon" };
  }
  @Endpoint({
    path: "fetch",
    input: RefDto,
    output: ThingDto,
    order: 2,
    dependsOn: "create",
    bind: { id: "create.id" },
  })
  fetch(body: RefDto): ThingDto {
    if (!body?.id) throw new Error("missing id");
    return { id: body.id, name: "fetched" };
  }
}

const ThingsModule = endpointModule("Things", [ThingsController]);

Deno.test({
  name:
    "exerciseEndpoints - drives the chain over HTTP via Playwright (loopback, no token)",
  ignore: !enabled,
  fn: async () => {
    const port = 9555;
    const server = await bootstrapServer("smk-app", ThingsModule, { port });
    await server.listen();
    try {
      const report = await exerciseEndpoints({
        api: server,
        baseUrl: `http://localhost:${port}`,
      });
      assertEquals(report.failed.map((r) => r.id), []);
      assertEquals(report.passed.map((r) => r.id).sort(), ["create", "fetch"]);
    } finally {
      await server.stop();
    }
  },
});
