const DEFAULT_CODE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".css",
  ".map",
  ".json",
  ".wasm",
];

// Content-type substrings that mark a response as code-like (pages, APIs, partial data, …).
const CODE_CONTENT_TYPES = [
  "text/html",
  "text/css",
  "javascript",
  "application/json",
  "application/wasm",
];

/**
 * The slice of a Fresh middleware context this helper reads. Declared structurally (rather than
 * importing Fresh's `FreshContext`) so the package stays Fresh-agnostic — exactly like
 * `withBasePath`, which leans on the package's own `FetchHandler` instead of a Fresh type. Fresh's
 * real `FreshContext<State>` carries these two members (plus more), so the returned middleware is
 * assignable wherever Fresh expects one: `app.use(noCodeCache())` / `define.middleware(...)`.
 */
export interface NoCodeCacheContext {
  req: Request;
  next: () => Promise<Response>;
}

export type NoCodeCacheOptions = {
  /** Extra path suffixes to treat as code (merged with the defaults), e.g. `[".xml"]`. */
  extensions?: string[];
};

/**
 * The middleware returned by {@link noCodeCache}. Structurally a Fresh middleware, so it can be
 * handed straight to `app.use(...)` / `define.middleware(...)`.
 */
export type NoCodeCacheMiddleware = (
  ctx: NoCodeCacheContext,
) => Promise<Response>;

/**
 * Cache-buster middleware: stamps aggressive no-store headers on every code-like response so a
 * browser, proxy, or edge/CDN never serves a stale build. "Code-like" = a Fresh build asset
 * (`/_fresh/…`), a request for a known code file extension, or a response whose content-type is
 * HTML/CSS/JS/JSON/WASM. Everything else (images, fonts, downloads, …) is passed through
 * untouched so it stays cacheable.
 *
 * ```ts
 * // Fresh main.ts
 * import { noCodeCache } from "@mrg-keystone/keep";
 * app.use(noCodeCache());
 * app.use(staticFiles());
 * ```
 */
export function noCodeCache(
  options: NoCodeCacheOptions = {},
): NoCodeCacheMiddleware {
  const extensions = new Set([
    ...DEFAULT_CODE_EXTENSIONS,
    ...(options.extensions ?? []),
  ]);

  return async (ctx: NoCodeCacheContext): Promise<Response> => {
    const res = await ctx.next();

    if (!isCodeLike(ctx.req, res, extensions)) {
      return res;
    }

    const out = mutableResponse(res);
    applyNoCacheHeaders(out.headers);

    return out;
  };
}

function isCodeLike(
  req: Request,
  res: Response,
  extensions: Set<string>,
) {
  const url = new URL(req.url);
  const path = url.pathname.toLowerCase();
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";

  // Fresh runtime / island / build output
  if (path.startsWith("/_fresh/")) return true;

  // Direct code file requests
  for (const ext of extensions) {
    if (path.endsWith(ext)) return true;
  }

  // Pages / APIs / partial data / code-ish responses, by content-type.
  return CODE_CONTENT_TYPES.some((t) => contentType.includes(t));
}

function applyNoCacheHeaders(headers: Headers) {
  headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");

  // CDN / edge layers
  headers.set("Deno-CDN-Cache-Control", "no-store");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Surrogate-Control", "no-store");

  // Avoid validator-based revalidation for code
  headers.delete("ETag");
}

function mutableResponse(res: Response) {
  // Some Response headers can be immutable depending on how the response was made.
  // Re-wrapping makes header mutation safe without consuming the body.
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
}
