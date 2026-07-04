import { assertEquals } from "#assert";
import {
  assembleSourcedInput,
  coerceToType,
  type FieldSource,
  type SourceReader,
} from "./mod.ts";

/** A stub request whose accessors read from fixed maps; undefined = absent. */
function reader(parts: {
  path?: Record<string, string>;
  query?: Record<string, string>;
  header?: Record<string, string>;
}): SourceReader {
  return {
    param: (n) => parts.path?.[n],
    query: (n) => parts.query?.[n],
    header: (n) => parts.header?.[n],
  };
}

Deno.test("assembleSourcedInput — empty sources returns a copy of the body", () => {
  const body = { a: 1, b: "x" };
  const out = assembleSourcedInput(body, {}, reader({}));
  assertEquals(out, { a: 1, b: "x" });
  // It is a copy — mutating the result must not touch the input body.
  out.a = 99;
  assertEquals(body.a, 1);
});

Deno.test("assembleSourcedInput — path/path*/query/header overlay the body", () => {
  const sources: Record<string, FieldSource> = {
    target: "path",
    rest: "path*",
    q: "query",
    auth: "header",
  };
  const out = assembleSourcedInput(
    { payload: "hello" },
    sources,
    reader({
      path: { target: "api.example.com", rest: "v1/users/42" },
      query: { q: "widgets" },
      header: { auth: "Bearer t0ken" },
    }),
  );
  assertEquals(out, {
    payload: "hello",
    target: "api.example.com",
    rest: "v1/users/42",
    q: "widgets",
    auth: "Bearer t0ken",
  });
});

Deno.test("assembleSourcedInput — a sourced value wins over a same-named body field", () => {
  const out = assembleSourcedInput(
    { target: "from-body" },
    { target: "path" },
    reader({ path: { target: "from-url" } }),
  );
  assertEquals(out.target, "from-url");
});

Deno.test("assembleSourcedInput — an absent source value leaves the body's value", () => {
  // No path value for `target` → the body's value stands (the DTO validates it).
  const out = assembleSourcedInput(
    { target: "kept" },
    { target: "path" },
    reader({}),
  );
  assertEquals(out.target, "kept");
  // And a missing field with no body value simply stays absent.
  const out2 = assembleSourcedInput({}, { q: "query" }, reader({}));
  assertEquals("q" in out2, false);
});

Deno.test("assembleSourcedInput — coercion is applied per field", () => {
  const out = assembleSourcedInput(
    {},
    { n: "query", flag: "query", s: "query" },
    reader({ query: { n: "42", flag: "true", s: "raw" } }),
    (_field, raw) => (raw === "42" ? 42 : raw === "true" ? true : raw),
  );
  assertEquals(out, { n: 42, flag: true, s: "raw" });
});

Deno.test("coerceToType — Number coerces clean numerics, leaves garbage", () => {
  assertEquals(coerceToType("42", Number), 42);
  assertEquals(coerceToType("-3.5", Number), -3.5);
  assertEquals(coerceToType("", Number), ""); // blank is not a number
  assertEquals(coerceToType("abc", Number), "abc"); // unparseable → left for validation
});

Deno.test("coerceToType — Boolean coerces only the canonical literals", () => {
  assertEquals(coerceToType("true", Boolean), true);
  assertEquals(coerceToType("false", Boolean), false);
  assertEquals(coerceToType("1", Boolean), "1"); // not a canonical bool literal
});

Deno.test("coerceToType — String and unknown types pass through unchanged", () => {
  assertEquals(coerceToType("hello", String), "hello");
  assertEquals(coerceToType("hello", undefined), "hello");
});
