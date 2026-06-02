import type { Context, MiddlewareHandler } from "#hono";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";

const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id"];
// Redact credentials so they never land in logs — including the process-private in-process key,
// which would otherwise let anyone with log access forge in-process trust.
const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  INTERNAL_REQUEST_HEADER,
]);
const LOGGABLE_BODY = /(application\/json|text\/)/i;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const UNSAFE_REQUEST_ID = /[^A-Za-z0-9._-]/g;

/**
 * Builds the Hono middleware that opens a request scope and emits the ingress/egress logs.
 * Register it before any routes so it wraps every handler.
 */
export function createRequestLoggingMiddleware(logger: Logger): MiddlewareHandler {
  return (c, next) => {
    const requestId = resolveRequestId(c);
    c.header("x-request-id", requestId);

    return logger.runInRequest(requestId, async () => {
      const { method } = c.req;
      const route = c.req.path;

      logger.lifecycle("ingress", "info", method, route, {
        routePath: c.req.routePath,
        headers: headersToObject(c.req.raw.headers),
        query: c.req.query(),
        body: await readBody(c.req.raw.clone()),
      });

      try {
        await next();
      } finally {
        const status = c.res.status;
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        logger.lifecycle("egress", level, method, route, {
          status,
          headers: headersToObject(c.res.headers),
          body: await readBody(c.res.clone()),
        });
        // Every log fired its Datadog request as it happened; wait for them all to return
        // before sending the response, on any status. settle() never rejects (a failed send
        // raises a Postmark alert instead of throwing).
        await logger.settle();
      }
    });
  };
}

function resolveRequestId(c: Context): string {
  for (const header of REQUEST_ID_HEADERS) {
    const value = c.req.header(header);
    if (value) return sanitizeRequestId(value);
  }
  return crypto.randomUUID();
}

/**
 * A client-supplied request id is echoed into logs and the response header, so strip it to a
 * safe charset and cap its length — prevents log forging/injection and unbounded log growth.
 * Falls back to a generated id if nothing usable remains.
 */
function sanitizeRequestId(value: string): string {
  const cleaned = value.replace(UNSAFE_REQUEST_ID, "").slice(0, MAX_REQUEST_ID_LENGTH);
  return cleaned.length > 0 ? cleaned : crypto.randomUUID();
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "***" : value;
  });
  return out;
}

/** Reads a JSON/text body for logging; skips binary, oversized, or unreadable bodies. */
async function readBody(source: Request | Response): Promise<unknown> {
  try {
    const type = source.headers.get("content-type") ?? "";
    if (!LOGGABLE_BODY.test(type)) return undefined;
    if (Number(source.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      return "[omitted: too large]";
    }
    const text = await source.text();
    if (!text) return undefined;
    if (text.length > MAX_BODY_BYTES) return "[omitted: too large]";
    if (type.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  } catch {
    return undefined;
  }
}
