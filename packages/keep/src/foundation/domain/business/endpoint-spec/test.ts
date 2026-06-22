import { assertEquals } from "#assert";
import { endpointsFromDoc, exampleFromSchema } from "./mod.ts";
import type { OpenApiDocument } from "@types";

// A doc exercising every extraction branch: typed scalars, enum, default, nested $ref object,
// schema-less object (properties but no type), array, and path/query parameters.
const doc: OpenApiDocument = {
  info: { title: "Orders" },
  paths: {
    "/orders/{orderId}": {
      post: {
        operationId: "place",
        parameters: [
          { name: "orderId", in: "path", required: true },
          { name: "dryRun", in: "query" },
          { name: "x-trace", in: "header" }, // headers are not editable params
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlaceOrderDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 1,
          dependsOn: [],
          bind: {},
          method: "post",
          path: "",
        },
      },
    },
  },
  components: {
    schemas: {
      PlaceOrderDto: {
        required: ["sku", "quantity"],
        properties: {
          sku: { type: "string" },
          quantity: { type: "integer" },
          gift: { type: "boolean" },
          tier: { type: "string", enum: ["standard", "express"] },
          note: { type: "string", default: "n/a" },
          address: { $ref: "#/components/schemas/AddressDto" },
          tags: { type: "array", items: { type: "string" } },
          // danet sometimes emits nested objects without a `type` keyword.
          meta: { properties: { source: { type: "string" } } },
        },
      },
      AddressDto: {
        properties: { street: { type: "string" }, zip: { type: "string" } },
      },
      OrderDto: { properties: { orderId: { type: "string" } } },
    },
  },
};

Deno.test("endpointsFromDoc - typed fields with required flags and examples", () => {
  const [ep] = endpointsFromDoc(doc);
  const byName = new Map(ep.inputSchema.map((f) => [f.name, f]));

  assertEquals(byName.get("sku"), {
    name: "sku",
    type: "string",
    required: true,
    example: "",
  });
  assertEquals(byName.get("quantity"), {
    name: "quantity",
    type: "integer",
    required: true,
    example: 0,
  });
  assertEquals(byName.get("gift")?.example, false);
  // enum → its first member; default → the declared default.
  assertEquals(byName.get("tier")?.example, "standard");
  assertEquals(byName.get("note")?.example, "n/a");
  // stub defaults to false when the vendor extension doesn't carry it.
  assertEquals(ep.stub, false);
});

Deno.test("endpointsFromDoc - nested $ref objects recurse into a full example", () => {
  const [ep] = endpointsFromDoc(doc);
  const address = ep.inputSchema.find((f) => f.name === "address")!;
  assertEquals(address.type, "object");
  assertEquals(address.example, { street: "", zip: "" });
});

Deno.test("endpointsFromDoc - object without a `type` keyword still counts as object", () => {
  const [ep] = endpointsFromDoc(doc);
  const meta = ep.inputSchema.find((f) => f.name === "meta")!;
  assertEquals(meta.type, "object");
  assertEquals(meta.example, { source: "" });
});

Deno.test("endpointsFromDoc - arrays report type array with [] example", () => {
  const [ep] = endpointsFromDoc(doc);
  const tags = ep.inputSchema.find((f) => f.name === "tags")!;
  assertEquals(tags.type, "array");
  assertEquals(tags.example, []);
});

Deno.test("endpointsFromDoc - extracts path/query params, ignores headers", () => {
  const [ep] = endpointsFromDoc(doc);
  assertEquals(ep.params, [
    { name: "orderId", in: "path", required: true },
    { name: "dryRun", in: "query", required: false },
  ]);
});

Deno.test("exampleFromSchema - normalizes array-shaped type declarations", () => {
  assertEquals(
    exampleFromSchema(doc, { type: ["integer", "null"] } as never),
    0,
  );
  assertEquals(exampleFromSchema(doc, { type: ["array"] } as never), []);
});

Deno.test("exampleFromSchema - self-referencing schemas stop at the depth limit", () => {
  const cyclic: OpenApiDocument = {
    paths: {},
    components: {
      schemas: {
        Node: {
          type: "object",
          properties: { next: { $ref: "#/components/schemas/Node" } },
        },
      },
    },
  };
  // Must terminate (depth cap), not recurse forever.
  const example = exampleFromSchema(cyclic, {
    $ref: "#/components/schemas/Node",
  } as never) as Record<string, unknown>;
  assertEquals(typeof example, "object");
});
