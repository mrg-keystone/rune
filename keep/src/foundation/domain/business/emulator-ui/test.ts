import { assert, assertEquals, assertStringIncludes } from "#assert";
import {
  type AppEndpoint,
  emulatorShellHtml,
  orderedEndpoints,
} from "./mod.ts";
import type { OpenApiDocument } from "@types";

// A two-endpoint cake-style doc: create (order 1) → fetch (order 2, depends on create, binds id).
const doc: OpenApiDocument = {
  info: { title: "Users" },
  paths: {
    "/users": {
      post: {
        operationId: "create",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUserDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserDto" },
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
    "/users/fetch": {
      post: {
        operationId: "fetch",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UserRefDto" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserDto" },
              },
            },
          },
        },
        "x-keep-process": {
          order: 2,
          dependsOn: ["create"],
          bind: { id: "create.id" },
          method: "post",
          path: "fetch",
        },
      },
    },
  },
  components: {
    schemas: {
      CreateUserDto: { properties: { name: { type: "string" } } },
      UserRefDto: { properties: { id: { type: "string" } } },
      UserDto: {
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
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

Deno.test("orderedEndpoints - carries typed field schemas for the body editor", () => {
  const eps = orderedEndpoints(doc);
  assertEquals(eps[0].inputSchema, [
    { name: "name", type: "string", required: false, example: "" },
  ]);
  assertEquals(eps[1].inputSchema, [
    { name: "id", type: "string", required: false, example: "" },
  ]);
});

Deno.test("emulatorShellHtml - renders an ordered, chainable page", () => {
  const html = emulatorShellHtml("Users", doc);
  assertStringIncludes(html, "<title>Users · emulator</title>");
  assertStringIncludes(html, "process emulator");
  assertStringIncludes(html, "Run all in order");
  // The endpoint payload (ids, order, bind) is embedded for the client.
  assertStringIncludes(html, '"id":"create"');
  assertStringIncludes(html, '"id":"fetch"');
  assertStringIncludes(html, '"bind":{"id":"create.id"}');
  // create (order 1) appears before fetch (order 2) in the embedded list.
  assert(html.indexOf('"id":"create"') < html.indexOf('"id":"fetch"'));
});

Deno.test("emulatorShellHtml - embeds the composed producers index in the payload", () => {
  const html = emulatorShellHtml("Users", doc, {
    producers: { memberId: "members:enroll" },
  });
  assertStringIncludes(html, '"producers":{"memberId":"members:enroll"}');
  // Without the option the index is still present — just empty.
  const bare = emulatorShellHtml("Users", doc);
  assertStringIncludes(bare, '"producers":{}');
});

Deno.test("emulatorShellHtml - per-route copy button + collapsed run-all follow", () => {
  const html = emulatorShellHtml("Users", doc);
  // Each step's request address bar carries a button that copies that route's full URL.
  assertStringIncludes(html, "copy-route");
  assertStringIncludes(html, "copy route");
  // Run-all keeps boxes collapsed and scrolls the active/stopped step into view rather than
  // auto-expanding it (the follow-without-expand helper).
  assertStringIncludes(html, "ensureRowVisible");
});

Deno.test("emulatorShellHtml - app-wide setup picker: embeds the composed endpoint index", () => {
  const appEndpoints: AppEndpoint[] = [
    {
      module: "users",
      id: "create",
      method: "POST",
      path: "/users",
      description: "",
      bind: {},
      inputSchema: [
        { name: "name", type: "string", required: false, example: "" },
      ],
      params: [],
    },
    {
      module: "billing",
      id: "charge",
      method: "POST",
      path: "/billing/charge",
      description: "",
      bind: { userId: "create.id" },
      inputSchema: [
        { name: "userId", type: "string", required: true, example: "" },
      ],
      params: [],
    },
  ];
  const html = emulatorShellHtml("Users", doc, { appEndpoints });
  // The picker element + the foreign module's endpoint riding the payload.
  assertStringIncludes(html, 'id="setup-add"');
  assertStringIncludes(html, '"module":"billing"');
  assertStringIncludes(html, '"id":"charge"');
  // Without the option the index is still present — just empty.
  assertStringIncludes(emulatorShellHtml("Users", doc), '"appEndpoints":[]');
});

Deno.test("emulatorShellHtml - module setup card, persist checkboxes, and fixtures wiring", () => {
  const html = emulatorShellHtml("Users", doc);
  // The Module setup rail card with its Save fixtures + Run setup controls.
  assertStringIncludes(html, 'id="setup-card"');
  assertStringIncludes(html, "Module setup");
  assertStringIncludes(html, 'id="save-fixtures"');
  assertStringIncludes(html, 'id="run-setup"');
  // Each step can be snapshotted into setup from its Request panel.
  assertStringIncludes(html, "add-setup");
  assertStringIncludes(html, "+ setup");
  // Environment variables get a persist checkbox, and the client writes/reads the artifact.
  assertStringIncludes(html, "data-persist");
  assertStringIncludes(html, "/docs/_fixtures");
  assertStringIncludes(html, "fixtures/cake.json");
});

Deno.test("emulatorShellHtml - expectations, scenarios, diff, and project heal rules wiring", () => {
  const html = emulatorShellHtml("Users", doc);
  // Per-step expectations: status pin + body checks, evaluated on every send.
  assertStringIncludes(html, "a-status");
  assertStringIncludes(html, "+ check");
  assertStringIncludes(html, "assert-results");
  // Scenarios rail card + save form; loaded from /docs/_scenarios.
  assertStringIncludes(html, 'id="scenarios-card"');
  assertStringIncludes(html, 'id="save-scenario"');
  assertStringIncludes(html, "/docs/_scenarios");
  // Response diff vs the previous run.
  assertStringIncludes(html, "changed vs previous run");
  // Project heal rules are fetched from the localhost-only door.
  assertStringIncludes(html, "/docs/_heal-rules");
  // An open tab merges external writes to its own session key (map Run all, foreign setup).
  assertStringIncludes(html, "e.key === KEY");
  // The QuickBooks-era hardcoded slugs must be gone from the shipped client.
  assert(!html.includes("not-in-catalog"));
  assert(!html.includes("eligibleTextFids"));
});

Deno.test("emulatorShellHtml - dev reload script injected only when opts.dev", () => {
  // The poller hits the sibling `_dev` endpoint — its fetch is the script's signature.
  const dev = emulatorShellHtml("Users", doc, { dev: true });
  assertStringIncludes(dev, 'fetch("_dev")');

  const plain = emulatorShellHtml("Users", doc);
  assert(!plain.includes('fetch("_dev")'));
  const off = emulatorShellHtml("Users", doc, { dev: false });
  assert(!off.includes('fetch("_dev")'));
});

Deno.test("emulatorShellHtml - spec text cannot break out of the inline script tag", () => {
  const hostile = structuredClone(doc);
  hostile.paths!["/users"].post.description =
    '</script><script>alert("pwned")</script>';
  const html = emulatorShellHtml("Users", hostile);
  // `<` is unicode-escaped inside the JSON payload, so the literal tag never appears.
  assert(!html.includes("</script><script>alert"));
  assertStringIncludes(html, "\\u003c/script>");
});
