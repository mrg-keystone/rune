/**
 * Field-source binding (OpenAPI's parameter model). A rune `[TYP:from=path|path*|query|header]`
 * input field is populated from the URL path / query string / request header instead of the JSON
 * body. `@Endpoint` reads the per-field source map and reassembles the FULL input DTO server-side,
 * so the coordinator's signature is unchanged — one generic binder, no per-endpoint special case.
 *
 * This module is the PURE core (assembly + primitive coercion); the danet/Hono wiring lives in
 * the endpoint decorator. `path` and `path*` are both read as named Hono params (the route uses
 * `:field` / `:field{.+}` respectively) — the only difference is whether the segment captures
 * slashes, which is a routing concern, not a binding one.
 */

/** Where an input field is populated from at the HTTP boundary. Body is the default (a field with
 * no source is absent from this map). `path*` is the slash-capturing catch-all remainder. */
export type FieldSource = "path" | "path*" | "query" | "header";

/** Reads one sourced field's raw string from a request. Mirrors the slice of Hono's `HonoRequest`
 * the decorator uses, so `@Endpoint` passes `context.req` straight through and tests pass a stub. */
export interface SourceReader {
  /** A named path param — `:field` or the catch-all `:field{.+}`. */
  param(name: string): string | undefined;
  /** A query-string value (first occurrence). */
  query(name: string): string | undefined;
  /** A request header (case-insensitive lookup). */
  header(name: string): string | undefined;
}

/** Coerces a raw wire string to the DTO field's declared primitive. */
export type Coercer = (field: string, raw: string) => unknown;

/**
 * Merge the parsed JSON body with the path/query/header-sourced fields into one plain object,
 * ready to validate against the input DTO. A sourced value OVERLAYS the body (a `from=` field is
 * authoritative over any same-named body field — the URL/header is the real source). An absent
 * source value is skipped: the body's value stands, and the DTO's own validation names a field
 * that is genuinely missing.
 */
export function assembleSourcedInput(
  body: Record<string, unknown>,
  sources: Record<string, FieldSource>,
  read: SourceReader,
  coerce?: Coercer,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const [field, source] of Object.entries(sources)) {
    const raw = source === "query"
      ? read.query(field)
      : source === "header"
      ? read.header(field)
      : read.param(field); // path | path* — both named params
    if (raw === undefined) continue;
    out[field] = coerce ? coerce(field, raw) : raw;
  }
  return out;
}

/**
 * Coerce a raw wire string (path/query/header values are always strings) to the DTO field's
 * declared primitive — matching the cake's `coerceBySchema` and the headless harness's seed
 * coercion so all three agree. A `Number` field takes a clean numeric string; a `Boolean` field
 * takes "true"/"false"; anything else (incl. string, or an unparseable number) is left untouched
 * so the DTO's own validation names it precisely.
 */
export function coerceToType(raw: string, type: unknown): unknown {
  if (type === Number) {
    const n = Number(raw);
    return raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
  }
  if (type === Boolean) {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return raw;
}
