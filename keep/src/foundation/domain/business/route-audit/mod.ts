import "#reflect-metadata";
import type { Type } from "@types";
import { isPublicContext } from "@foundation/domain/business/public-route/mod.ts";
import { isInternalContext } from "@foundation/domain/business/internal-route/mod.ts";
import {
  requiredDomains,
  requiredGrants,
} from "@foundation/domain/business/grants/mod.ts";

/**
 * Boot-time authorization audit. Authorization at the credential guard is deny-by-default: a
 * controller route with NO `@Public`, NO `@Grant`, and NO `@LoggedIn` is not "ungated" — it is
 * closed to every caller except one holding the `*` universal grant (and closed to *everyone* when
 * the app runs `honorSkeleton:false`). That is safe, but it is also easy to reach by ACCIDENT: a
 * route the author simply forgot to decorate looks, from the outside, exactly like one deliberately
 * locked to `*`. This module enumerates the composed app's routes and their postures so boot can
 * name the bare ones — turning "silently `*`-only" into a conscious choice.
 *
 * (Recorded against alfred's feedback: an undecorated `create-in-flight` accepted a non-`*` token on
 * a roles-era keep. On this grants keep that same route is fail-closed, but it would still have gone
 * unnoticed as `*`-only had nothing surfaced it — which this audit now does.)
 */

// danet stores each route handler's HTTP verb under "method" and its path under "endpoint", both on
// the method function. Presence of "method" (a non-empty verb) is the reliable "this is a route"
// signal — an ordinary helper method on a controller carries neither.
const ROUTE_METHOD_KEY = "method";
const ROUTE_PATH_KEY = "endpoint";
const WS_CONTROLLER_KEY = "websocket-endpoint";

/**
 * A route's authorization posture, as the guard would enforce it:
 * - `public` — `@Public`, no credential required.
 * - `grant` / `loggedin` / `grant+loggedin` — an explicit `@Grant`/`@LoggedIn` constraint.
 * - `internal` — `@Internal`: deliberately reached only by the in-process client (enforcement is
 *   still deny-by-default, identical to `open`; the marker records that the bareness is intended).
 * - `open` — NEITHER: deny-by-default leaves it reachable only by the `*` universal grant (or by
 *   nobody, under `honorSkeleton:false`). The accidental-exposure shape.
 */
export type RoutePosture =
  | "public"
  | "grant"
  | "loggedin"
  | "grant+loggedin"
  | "internal"
  | "open";

export interface RouteAuditEntry {
  /** The controller class name. */
  controller: string;
  /** The handler method name (danet's operationId). */
  handler: string;
  /** HTTP verb, upper-cased (GET, POST, …). */
  method: string;
  /** The full route path (controller base joined with the handler route), leading-slashed. */
  route: string;
  posture: RoutePosture;
}

/**
 * Classify a handler exactly as the credential guard reads it: a synthetic context whose
 * `getHandler`/`getClass` return this method and its controller, fed to the guard's own metadata
 * readers — so a method-level decorator overrides a class-level one identically to enforcement.
 */
function classify(controller: Type, fn: object): RoutePosture {
  const ctx = { getHandler: () => fn, getClass: () => controller };
  if (isPublicContext(ctx)) return "public";
  // `@Internal` is a conscious "in-process only" declaration — same fail-closed enforcement as
  // `open`, but excluded from the audit warning below because the bareness is deliberate.
  if (isInternalContext(ctx)) return "internal";
  const hasGrant = requiredGrants(ctx).length > 0;
  const hasDomain = requiredDomains(ctx).length > 0;
  if (hasGrant && hasDomain) return "grant+loggedin";
  if (hasGrant) return "grant";
  if (hasDomain) return "loggedin";
  return "open";
}

/** Join a controller base path with a handler route into one leading-slashed path. */
function joinRoute(base: unknown, route: unknown): string {
  const parts = [base, route]
    .map((p) => (typeof p === "string" ? p.replace(/^\/+|\/+$/g, "") : ""))
    .filter((p) => p.length > 0);
  return "/" + parts.join("/");
}

/**
 * Enumerate every HTTP controller route across `modules` and classify its auth posture. WebSocket
 * controllers are skipped — they are gated at the handshake, not per message. Each controller is
 * visited once even when several modules reference it.
 */
export function auditRoutes(modules: Type[]): RouteAuditEntry[] {
  const out: RouteAuditEntry[] = [];
  const seen = new Set<Type>();
  for (const mod of modules) {
    const meta = (Reflect.getMetadata("module", mod) ?? {}) as {
      controllers?: Type[];
    };
    for (const controller of meta.controllers ?? []) {
      if (!controller || seen.has(controller)) continue;
      seen.add(controller);
      if (Reflect.getMetadata(WS_CONTROLLER_KEY, controller)) continue;
      const base = Reflect.getMetadata(ROUTE_PATH_KEY, controller);
      const proto = controller.prototype;
      if (!proto) continue;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const fn = (proto as Record<string, unknown>)[name];
        if (typeof fn !== "function") continue;
        const verb = Reflect.getMetadata(ROUTE_METHOD_KEY, fn as object);
        if (typeof verb !== "string" || verb.length === 0) continue;
        out.push({
          controller: controller.name,
          handler: name,
          method: verb.toUpperCase(),
          route: joinRoute(
            base,
            Reflect.getMetadata(ROUTE_PATH_KEY, fn as object),
          ),
          posture: classify(controller, fn as object),
        });
      }
    }
  }
  return out;
}

/** The routes with an `open` posture — neither `@Public` nor `@Grant`/`@LoggedIn`. */
export function openRoutes(modules: Type[]): RouteAuditEntry[] {
  return auditRoutes(modules).filter((r) => r.posture === "open");
}

export interface WarnOpenRoutesOptions {
  appName: string;
  /** Whether the guard honors the `*` skeleton (default true; infra runs false). Shapes the wording. */
  honorSkeleton: boolean;
  /** Sink for the (single, aggregate) warning line. */
  warn: (message: string) => void;
}

/**
 * Emit ONE aggregate warning naming every `open` route, or nothing when there are none. Returns the
 * open routes it found (for callers/tests). This is advisory: an `open` route is fail-closed, not a
 * hole — the warning exists so a bare route is a deliberate choice, not an oversight.
 */
export function warnOpenRoutes(
  modules: Type[],
  opts: WarnOpenRoutesOptions,
): RouteAuditEntry[] {
  const open = openRoutes(modules);
  if (open.length === 0) return open;
  const reach = opts.honorSkeleton
    ? "reachable only by a caller holding the `*` universal grant"
    : "reachable by no caller (this app runs honorSkeleton:false)";
  const lines = open
    .map((r) => `    ${r.method} ${r.route}  (${r.controller}.${r.handler})`)
    .join("\n");
  opts.warn(
    `[${opts.appName}] route-audit: ${open.length} controller route(s) declare neither @Public nor ` +
      `@Grant/@LoggedIn — deny-by-default leaves them ${reach}. Add @Grant(...)/@LoggedIn(...) to ` +
      `gate them explicitly, @Public() to open them, or @Internal() if the route is meant to be ` +
      `reached only by the in-process client — so a bare route is a conscious choice:\n` +
      `${lines}\n    (set KEEP_ROUTE_AUDIT=off to silence this audit.)`,
  );
  return open;
}
