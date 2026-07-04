import "#reflect-metadata";

/**
 * Authorization decorators. keep authorizes a request against the grants + identity carried in an
 * infra-signed session bearer (verified offline). Three decorators, enforced by the global
 * credential guard AFTER authentication, **deny-by-default (fail-closed)**:
 *
 * - `@Public()` — no credential required (see `public-route`).
 * - `@LoggedIn("monsterrg.com", …)` — the caller's identity (`creator`, a Firebase email) must be
 *   under one of the listed domains. A machine token (non-email creator) never satisfies it.
 * - `@Grant("developer", …)` — the caller must hold at least ONE of the listed grants (any-of),
 *   scoped to THIS app (a bare name `developer` is checked against the app's grants). A dynamic form
 *   `@Grant("::key")` looks up `key` in the request (path param → query → header → body) and requires
 *   the FOUND VALUE to be a grant the caller holds.
 *
 * Stacked decorators combine with **AND**: `@LoggedIn(...)` + `@Grant(...)` requires both. A
 * controller route with NEITHER (and not `@Public`) is closed to everyone but the `*` universal grant.
 *
 * ```ts
 * @LoggedIn("monsterrg.com")
 * @Grant("admin")
 * @Delete(":id")
 * remove() {}
 * ```
 */
export const GRANTS_METADATA_KEY = "keep:grants";
export const LOGGEDIN_METADATA_KEY = "keep:loggedin";

/** Prefix marking a dynamic grant arg: `@Grant("::key")` → require the request's `key` value. */
export const DYNAMIC_GRANT_PREFIX = "::";

// deno-lint-ignore no-explicit-any
function define(key: string, value: unknown): any {
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(key, value, descriptor.value);
    } else {
      Reflect.defineMetadata(key, value, target);
    }
  };
}

/** Restrict to callers holding at least one of `grants` (any-of), scoped to this app. */
// deno-lint-ignore no-explicit-any
export function Grant(...grants: string[]): any {
  return define(GRANTS_METADATA_KEY, grants);
}

/**
 * @deprecated Use {@link Grant}. Retained as an alias so existing `@Grants(...)` call sites keep
 * working during migration — identical behavior.
 */
// deno-lint-ignore no-explicit-any
export function Grants(...grants: string[]): any {
  return Grant(...grants);
}

/** Restrict to callers whose identity (`creator` email) is under one of `domains`. */
// deno-lint-ignore no-explicit-any
export function LoggedIn(...domains: string[]): any {
  return define(LOGGEDIN_METADATA_KEY, domains);
}

// deno-lint-ignore no-explicit-any
function readMeta(context: any, key: string): string[] {
  const handler = typeof context?.getHandler === "function" ? context.getHandler() : undefined;
  const cls = typeof context?.getClass === "function" ? context.getClass() : undefined;
  const onMethod = handler && Reflect.getMetadata(key, handler);
  if (Array.isArray(onMethod)) return onMethod;
  const onClass = cls && Reflect.getMetadata(key, cls);
  return Array.isArray(onClass) ? onClass : [];
}

/**
 * The grants required by the current context (`@Grant`). A method-level decorator overrides a
 * class-level one; `[]` when neither is present (which, being non-`@Public`, the guard treats as
 * closed unless the caller holds the `*` universal grant). Entries may be dynamic (`::key`).
 */
// deno-lint-ignore no-explicit-any
export function requiredGrants(context: any): string[] {
  return readMeta(context, GRANTS_METADATA_KEY);
}

/** The domains required by the current context (`@LoggedIn`); `[]` when none. */
// deno-lint-ignore no-explicit-any
export function requiredDomains(context: any): string[] {
  return readMeta(context, LOGGEDIN_METADATA_KEY);
}
