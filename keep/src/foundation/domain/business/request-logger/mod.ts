import type { Context, MiddlewareHandler } from "#hono";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { tracer } from "@foundation/domain/business/tracer/mod.ts";
import { traceShipper } from "@foundation/domain/business/tracer/ship.ts";

const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id"];
// Redact credentials so they never land in logs — including the process-private in-process key,
// which would otherwise let anyone with log access forge in-process trust. Matched
// case-insensitively (see headersToObject), so list lowercase.
const REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  INTERNAL_REQUEST_HEADER,
]);
// Query params carrying a credential — redacted so a `?token=` (accepted by the auth guard for
// link/seed flows) never lands in logs.
const REDACTED_QUERY = new Set(["token", "access_token"]);
const LOGGABLE_BODY = /(application\/json|text\/)/i;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const UNSAFE_REQUEST_ID = /[^A-Za-z0-9._-]/g;

/**
 * Builds the Hono middleware that opens a request scope and emits the ingress/egress logs.
 * Register it before any routes so it wraps every handler.
 */
export function createRequestLoggingMiddleware(
  logger: Logger,
): MiddlewareHandler {
  return (c, next) => {
    const requestId = resolveRequestId(c);
    c.header("x-request-id", requestId);

    return logger.runInRequest(requestId, async () => {
      const { method } = c.req;
      const route = c.req.path;

      logger.lifecycle("ingress", "info", method, route, {
        routePath: c.req.routePath,
        headers: headersToObject(c.req.raw.headers),
        query: redactQuery(c.req.query()),
        body: await readBody(c.req.raw.clone()),
      });

      try {
        // Open a trace for the whole request so `/docs/_trace` can render its waterfall. Skip
        // the framework's own tooling routes (`/docs/*`, `/_token`…) — they'd just be noise — and
        // skip when a trace is already open: an in-process `backend.fetch` re-enters this
        // middleware, and its work already nests under the parent's backend span.
        if (tracer.enabled && shouldTrace(route) && !tracer.current()) {
          await tracer.trace(
            { requestId, method, route },
            () => next(),
            (t) => {
              t.status = c.res.status;
              if (c.res.status >= 400) t.ok = false;
              // Label the trace by user: the app's explicit `traceUser()` wins; otherwise fall
              // back to the verified token identity the auth guard recorded on the request.
              if (!t.user) t.user = logger.currentRequest()?.source;
              // Fire-and-forget the trace to the OTLP endpoint (a Datadog Agent), and register
              // the promise so settle() awaits it in the same flush as the logs, right before the
              // response returns. No-op (null) when shipping is disabled.
              const shipped = traceShipper.ship(t);
              if (shipped) logger.currentRequest()?.pending.push(shipped);
            },
          );
        } else {
          await next();
        }
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

/**
 * Framework tooling routes (`/docs/*`, `/_token`…) and browser-chrome noise (`/favicon.ico`)
 * carry no app logic worth tracing — keep the buffer to real traffic.
 */
function shouldTrace(route: string): boolean {
  return !(route === "/docs" || route.startsWith("/docs/") ||
    route.startsWith("/_") || route === "/favicon.ico");
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
  const cleaned = value.replace(UNSAFE_REQUEST_ID, "").slice(
    0,
    MAX_REQUEST_ID_LENGTH,
  );
  return cleaned.length > 0 ? cleaned : crypto.randomUUID();
}

function redactQuery(query: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    out[key] = REDACTED_QUERY.has(key.toLowerCase()) ? "***" : value;
  }
  return out;
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
