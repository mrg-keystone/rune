import "#reflect-metadata";
import { assert, assertEquals } from "#assert";
import { ApiProperty } from "#danet/swagger/decorators";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { bootstrapServer } from "./mod.ts";

// `server.handler(req, connInfo)` is the standalone dispatcher; the localhost gate reads the
// socket peer from connInfo (spoof-proof). Mirror the /docs/_run int test's loopback/off-host shapes.
const loopback = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
};
const offhost = {
  remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
};

// deno-lint-ignore no-explicit-any
const conn = (info: unknown) => info as any;

const getReq = () => new Request("http://app/docs/_fixtures");
const postReq = (body?: unknown) =>
  new Request("http://app/docs/_fixtures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

class CreateDto {
  @ApiProperty()
  name!: string;
}
class OutDto {
  @ApiProperty()
  id!: string;
}

@EndpointController("orders")
class OrdersController {
  @Endpoint({ input: CreateDto, output: OutDto, order: 1 })
  create(_body: CreateDto): OutDto {
    return { id: "o-1" };
  }
}
const OrdersModule = endpointModule("Orders", [OrdersController]);

Deno.test("/docs/_fixtures - POST writes cake.json, GET reads it back (localhost)", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("orders-app", OrdersModule);
  try {
    // Empty before anything is written.
    const before = await (await server.handler(getReq(), conn(loopback)))
      .json();
    assertEquals(before, { v: 1, variables: {}, modules: {} });

    // POST a page's slice — its setup plus the persisted variables.
    const postRes = await server.handler(
      postReq({
        module: "orders",
        setup: [{ id: "create", body: '{"name":"acme"}' }],
        variables: { tenantId: "t-7" },
      }),
      conn(loopback),
    );
    assertEquals(postRes.status, 200);
    const merged = await postRes.json();
    assertEquals(merged.variables, { tenantId: "t-7" });
    assertEquals(merged.modules.orders.setup, [
      { id: "create", body: '{"name":"acme"}' },
    ]);
    assert(typeof merged.savedAt === "number", "savedAt is stamped on write");

    // The file is really on disk, and GET returns the same artifact.
    const onDisk = JSON.parse(await Deno.readTextFile(`${dir}/cake.json`));
    assertEquals(onDisk.modules.orders.setup[0].id, "create");
    const got = await (await server.handler(getReq(), conn(loopback))).json();
    assertEquals(got.variables, { tenantId: "t-7" });

    // A second module's POST merges in without clobbering orders' slice.
    await server.handler(
      postReq({
        module: "members",
        setup: [{ id: "enroll" }],
        variables: { tenantId: "t-7" },
      }),
      conn(loopback),
    );
    const both = await (await server.handler(getReq(), conn(loopback))).json();
    assertEquals(both.modules.orders.setup[0].id, "create");
    assertEquals(both.modules.members.setup[0].id, "enroll");
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("/docs/_fixtures - non-localhost and missing conn info are denied (403)", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("KEEP_FIXTURES_DIR", dir);
  const server = await bootstrapServer("orders-app", OrdersModule);
  try {
    assertEquals((await server.handler(getReq(), conn(offhost))).status, 403);
    assertEquals(
      (await server.handler(postReq({}), conn(offhost))).status,
      403,
    );
    // In-process dispatch carries no conn info ⇒ fail closed.
    assertEquals((await server.handler(getReq())).status, 403);
    assertEquals((await server.handler(postReq({}))).status, 403);
  } finally {
    await server.stop();
    Deno.env.delete("KEEP_FIXTURES_DIR");
    await Deno.remove(dir, { recursive: true });
  }
});
