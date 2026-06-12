import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "./mod.ts";

// Same loopback/off-host conn shapes as the other bootstrap-server int tests.
const loopback = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
};
const offhost = {
  remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
};
// deno-lint-ignore no-explicit-any
const conn = (info: unknown) => info as any;

const jsonReq = (path: string, body?: unknown) =>
  new Request(`http://app${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined
      ? undefined
      : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

class CreateDto {
  @ApiProperty()
  name!: string;
}
class OutDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
}

@EndpointController("things")
class ThingsController {
  @Endpoint({ input: CreateDto, output: OutDto, order: 1 })
  create(body: CreateDto): OutDto {
    return { id: "t-1", name: body?.name ?? "default" };
  }
}
const ThingsModule = endpointModule("Things", [ThingsController]);

Deno.test("/docs/_scenarios - POST saves a file, GET lists it back; bad payloads are 400", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("scen-app", ThingsModule);
  try {
    assertEquals(
      (await (await server.handler(jsonReq("/docs/_scenarios"), conn(loopback)))
        .json()).scenarios,
      [],
    );
    const saved = await server.handler(
      jsonReq("/docs/_scenarios", {
        name: "Happy Path",
        module: "things",
        flow: "card",
        steps: [{ id: "create", body: '{"name":"from-scenario"}' }],
      }),
      conn(loopback),
    );
    assertEquals(saved.status, 200);
    // The file lands under fixtures/scenarios/<slug>.json.
    const onDisk = JSON.parse(
      await Deno.readTextFile(`${dir}/scenarios/happy-path.json`),
    );
    assertEquals(onDisk.module, "things");

    const list =
      (await (await server.handler(jsonReq("/docs/_scenarios"), conn(loopback)))
        .json()).scenarios;
    assertEquals(list.length, 1);
    assertEquals(list[0].name, "Happy Path");

    // A scenario without identity fields is rejected.
    assertEquals(
      (await server.handler(
        jsonReq("/docs/_scenarios", { steps: [] }),
        conn(loopback),
      ))
        .status,
      400,
    );
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("/docs/_run - scenario param replays a saved scenario's literal bodies + flow", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("scen-app", ThingsModule);
  try {
    await server.handler(
      jsonReq("/docs/_scenarios", {
        name: "named run",
        module: "things",
        steps: [{
          id: "create",
          // One literal field and one {{ref}} field: the literal must reach the endpoint,
          // the ref must be dropped (the runner's own bind machinery owns those).
          body: '{"name":"from-scenario","other":"{{create.id}}"}',
        }],
      }),
      conn(loopback),
    );
    const res = await server.handler(
      jsonReq("/docs/_run", { scenario: "Named Run" }),
      conn(loopback),
    );
    assertEquals(res.status, 200);
    const report = await res.json();
    assertEquals(report.ok, true);
    const create = report.passed.find((r: { id: string }) => r.id === "create");
    // The harness rows now carry the response body + ms — the scenario's literal arrived.
    assertEquals(create.body, { id: "t-1", name: "from-scenario" });
    assert(typeof create.ms === "number", "rows carry per-call ms");

    // An unknown scenario is a clear 404.
    assertEquals(
      (await server.handler(
        jsonReq("/docs/_run", { scenario: "nope" }),
        conn(loopback),
      ))
        .status,
      404,
    );
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("/docs/_heal-rules + /docs/_scenarios - localhost-only (403 off-host and without conn info)", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("scen-app", ThingsModule);
  try {
    for (
      const path of ["/docs/_heal-rules", "/docs/_scenarios"]
    ) {
      assertEquals(
        (await server.handler(jsonReq(path), conn(offhost))).status,
        403,
      );
      assertEquals((await server.handler(jsonReq(path))).status, 403);
    }
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("/docs/_heal-rules - serves the normalized project rules file", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("scen-app", ThingsModule);
  try {
    // No file yet → the empty rule set.
    assertEquals(
      await (await server.handler(jsonReq("/docs/_heal-rules"), conn(loopback)))
        .json(),
      { v: 1, slugs: {} },
    );
    await Deno.writeTextFile(
      `${dir}/heal-rules.json`,
      JSON.stringify({
        v: 1,
        slugs: {
          "not-enabled": [
            // The rune generator's extra fields (todo) must pass through untouched.
            {
              kind: "run-step",
              match: "/enable/i",
              why: "track first",
              todo: true,
            },
          ],
        },
      }),
    );
    const rules = await (await server.handler(
      jsonReq("/docs/_heal-rules"),
      conn(loopback),
    )).json();
    assertEquals(rules.slugs["not-enabled"][0].match, "/enable/i");
    assertEquals(rules.slugs["not-enabled"][0].todo, true);
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});
