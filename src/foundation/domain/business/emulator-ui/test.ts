import { assert, assertEquals, assertStringIncludes } from "#assert";
import { emulatorShellHtml, orderedEndpoints } from "./mod.ts";
import type { OpenApiDocument } from "@types";

// A two-endpoint cake-style doc: create (order 1) → fetch (order 2, depends on create, binds id).
const doc: OpenApiDocument = {
  info: { title: "Users" },
  paths: {
    "/users": {
      post: {
        operationId: "create",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateUserDto" } } } },
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserDto" } } } } },
        "x-keep-process": { order: 1, dependsOn: [], bind: {}, method: "post", path: "" },
      },
    },
    "/users/fetch": {
      post: {
        operationId: "fetch",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/UserRefDto" } } } },
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserDto" } } } } },
        "x-keep-process": { order: 2, dependsOn: ["create"], bind: { id: "create.id" }, method: "post", path: "fetch" },
      },
    },
  },
  components: {
    schemas: {
      CreateUserDto: { properties: { name: { type: "string" } } },
      UserRefDto: { properties: { id: { type: "string" } } },
      UserDto: { properties: { id: { type: "string" }, name: { type: "string" } } },
    },
  },
};

Deno.test("orderedEndpoints - sorts by process order + dependency, extracts fields", () => {
  const eps = orderedEndpoints(doc);
  assertEquals(eps.map((e) => e.id), ["create", "fetch"]);
  assertEquals(eps[1].dependsOn, ["create"]);
  assertEquals(eps[1].bind, { id: "create.id" });
  assertEquals(eps[0].inputFields, ["name"]);
  assertEquals(eps[1].inputFields, ["id"]);
});

Deno.test("emulatorShellHtml - renders an ordered, chainable page", () => {
  const html = emulatorShellHtml("Users", doc);
  assertStringIncludes(html, "<title>Users · emulator</title>");
  assertStringIncludes(html, "Run all in order");
  // The endpoint payload (ids, order, bind) is embedded for the client.
  assertStringIncludes(html, '"id":"create"');
  assertStringIncludes(html, '"id":"fetch"');
  assertStringIncludes(html, '"bind":{"id":"create.id"}');
  // create (order 1) appears before fetch (order 2) in the embedded list.
  assert(html.indexOf('"id":"create"') < html.indexOf('"id":"fetch"'));
});
