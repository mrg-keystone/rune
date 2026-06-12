import { assert, assertEquals, assertStringIncludes } from "#assert";
import { buildMapModel, mapShellHtml } from "./mod.ts";
import type { OpenApiDocument, SwaggerDocEntry } from "@types";

// A two-module composed app, checkout-style:
// - members: join → outputs memberId (the producer for shop's $memberId).
// - shop: start (binds $memberId, outputs ticketId) → pay (binds start.ticketId, flow "card",
//   and binds $couponId which NOTHING produces — the unfulfilled-input badge case).
const membersDoc: OpenApiDocument = {
  info: { title: "members" },
  paths: {
    "/members/join": {
      post: {
        operationId: "join",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JoinDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MemberDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 1,
          dependsOn: [],
          bind: {},
          method: "post",
          path: "join",
        },
      },
    },
  },
  components: {
    schemas: {
      JoinDto: { properties: { name: { type: "string" } } },
      MemberDto: { properties: { memberId: { type: "string" } } },
    },
  },
};

const shopDoc: OpenApiDocument = {
  info: { title: "shop" },
  paths: {
    "/shop/start": {
      post: {
        operationId: "start",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StartDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TicketDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 1,
          dependsOn: [],
          bind: { memberId: "$memberId" },
          method: "post",
          path: "start",
        },
      },
    },
    "/shop/pay": {
      post: {
        operationId: "pay",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PayDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaymentDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 2,
          dependsOn: ["start"],
          bind: { ticketId: "start.ticketId", couponId: "$couponId" },
          flows: ["card"],
          method: "post",
          path: "pay",
        },
      },
    },
  },
  components: {
    schemas: {
      StartDto: {
        properties: {
          memberId: { type: "string" },
          item: { type: "string" },
        },
      },
      TicketDto: { properties: { ticketId: { type: "string" } } },
      PayDto: {
        properties: {
          ticketId: { type: "string" },
          couponId: { type: "string" },
        },
      },
      PaymentDto: { properties: { paymentId: { type: "string" } } },
    },
  },
};

const docs: SwaggerDocEntry[] = [
  { path: "/members", doc: membersDoc },
  { path: "/shop", doc: shopDoc },
];

Deno.test("buildMapModel - one module-qualified node per endpoint, in module lanes", () => {
  const model = buildMapModel(docs);
  assertEquals(model.nodes.map((n) => n.key).sort(), [
    "members:join",
    "shop:pay",
    "shop:start",
  ]);
  assertEquals(model.lanes.map((l) => l.module), ["members", "shop"]);
  assertEquals(model.lanes.map((l) => l.docsPath), [
    "/docs/members",
    "/docs/shop",
  ]);
  // Lanes stack without overlapping.
  assert(model.lanes[1].y >= model.lanes[0].y + model.lanes[0].h);
  assertEquals(model.flows, ["card"]);
});

Deno.test("buildMapModel - solid bind edges inside a module, dashed $input edges across", () => {
  const model = buildMapModel(docs);
  const bind = model.edges.find((e) => e.kind === "bind");
  assertEquals(bind, {
    from: "shop:start",
    to: "shop:pay",
    label: "ticketId",
    kind: "bind",
    flows: ["card"],
  });
  const input = model.edges.find((e) => e.kind === "input");
  assertEquals(input, {
    from: "members:join",
    to: "shop:start",
    label: "$memberId",
    kind: "input",
    flows: [],
  });
});

Deno.test("buildMapModel - an unproduced $input becomes a node badge, not an edge", () => {
  const model = buildMapModel(docs);
  const pay = model.nodes.find((n) => n.key === "shop:pay")!;
  assertEquals(pay.inputs, ["couponId"]);
  assert(
    !model.edges.some((e) => e.label === "$couponId"),
    "no producer exists for couponId — it must not get an edge",
  );
});

Deno.test("buildMapModel - rank (longest-path depth) positions dependents in later columns", () => {
  const model = buildMapModel(docs);
  const byKey = new Map(model.nodes.map((n) => [n.key, n]));
  const join = byKey.get("members:join")!;
  const start = byKey.get("shop:start")!;
  const pay = byKey.get("shop:pay")!;
  // join (rank 0) → start (rank 1, via the $memberId contract) → pay (rank 2).
  assert(start.x > join.x, "start must sit right of its producer join");
  assert(pay.x > start.x, "pay must sit right of its producer start");
});

Deno.test("mapShellHtml - embeds nodes, both edge kinds, and lanes in the payload", () => {
  const html = mapShellHtml("checkout", docs);
  assertStringIncludes(html, "<title>checkout · system map</title>");
  assertStringIncludes(html, "system map");
  assertStringIncludes(html, "window.__KEEP_MAP__");
  assertStringIncludes(html, '"key":"members:join"');
  assertStringIncludes(html, '"key":"shop:start"');
  assertStringIncludes(html, '"key":"shop:pay"');
  assertStringIncludes(
    html,
    '"from":"shop:start","to":"shop:pay","label":"ticketId","kind":"bind"',
  );
  assertStringIncludes(
    html,
    '"from":"members:join","to":"shop:start","label":"$memberId","kind":"input"',
  );
  assertStringIncludes(html, '"module":"members"');
  assertStringIncludes(html, '"inputs":["couponId"]');
});

Deno.test("mapShellHtml - Run all button drives the localhost /docs/_run walk", () => {
  const html = mapShellHtml("checkout", docs);
  assertStringIncludes(html, 'id="runall"');
  assertStringIncludes(html, ">Run all<");
  // The button POSTs the sibling headless-run door and pulses nodes while the walk is in flight.
  assertStringIncludes(html, '"/docs/_run"');
  assertStringIncludes(html, "circle.dot.run");
  // Results are written back INTO the cake sessions (one source of truth for run state),
  // streamed row by row, module by module, with the cake's defaults (untagged-only walk,
  // typed env vars as seeds, per-module skips).
  assertStringIncludes(html, "function writeBackRow");
  assertStringIncludes(html, "keep:emulator:globals");
  assertStringIncludes(html, "stream: true");
  assertStringIncludes(html, 'orderBy: "module"');
  assertStringIncludes(html, 'flow: "__main"');
  assertStringIncludes(html, "sessionSeeds");
  assertStringIncludes(html, "sessionSkips");
});

Deno.test("mapShellHtml - dev reload script injected only when opts.dev", () => {
  const dev = mapShellHtml("checkout", docs, { dev: true });
  assertStringIncludes(dev, 'fetch("_dev")');
  const plain = mapShellHtml("checkout", docs);
  assert(!plain.includes('fetch("_dev")'));
});

Deno.test("mapShellHtml - spec text cannot break out of the inline script tag", () => {
  const hostile = structuredClone(docs);
  hostile[1].doc.paths!["/shop/start"].post.description =
    '</script><script>alert("pwned")</script>';
  const html = mapShellHtml("checkout", hostile);
  // `<` is unicode-escaped inside the JSON payload, so the literal tag never appears.
  assert(!html.includes("</script><script>alert"));
  assertStringIncludes(html, "\\u003c/script>");
});

// ── the plural/echo contract on the map ───────────────────────────────────────
// A producer returns a COLLECTION (tableNames); the consumer needs ONE element ($tableName) and
// echoes it back. The echo must not count as the producer; the plural collection must.
const catalogDoc: OpenApiDocument = {
  info: { title: "catalog" },
  paths: {
    "/catalog/discover": {
      post: {
        operationId: "discover",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DiscoverOutDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 1,
          dependsOn: [],
          bind: {},
          method: "post",
          path: "discover",
        },
      },
    },
    "/catalog/enable": {
      post: {
        operationId: "enable",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EnableDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EnabledDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 2,
          dependsOn: [],
          bind: { tableName: "$tableName" },
          method: "post",
          path: "enable",
        },
      },
    },
  },
  components: {
    schemas: {
      DiscoverOutDto: {
        properties: {
          tableNames: { type: "array", items: { type: "string" } },
        },
      },
      EnableDto: { properties: { tableName: { type: "string" } } },
      EnabledDto: {
        properties: {
          tableName: { type: "string" },
          enabled: { type: "boolean" },
        },
      },
    },
  },
};

Deno.test("buildMapModel - a plural collection producer draws the $input edge; the echo does not", () => {
  const model = buildMapModel([{ path: "/catalog", doc: catalogDoc }]);
  const input = model.edges.find((e) => e.kind === "input");
  // The dashed contract edge comes from the COLLECTION producer (same module is fine now) —
  // never from `enable` itself, whose tableName output is an echo of its own input.
  assertEquals(input, {
    from: "catalog:discover",
    to: "catalog:enable",
    label: "$tableName",
    kind: "input",
    flows: [],
  });
  // Produced ⇒ no amber unfulfilled-input badge.
  const enable = model.nodes.find((n) => n.key === "catalog:enable")!;
  assertEquals(enable.inputs, []);
  // And the producer sits in an earlier column than its consumer.
  const discover = model.nodes.find((n) => n.key === "catalog:discover")!;
  assert(
    enable.x > discover.x,
    "consumer must sit right of the plural producer",
  );
});

Deno.test("mapShellHtml - failed run-all steps deep-link into their cake (heal takeover)", () => {
  const html = mapShellHtml("checkout", docs);
  assertStringIncludes(html, "Click a step to open its cake");
  assertStringIncludes(html, "the heal panel has the failure loaded");
});
