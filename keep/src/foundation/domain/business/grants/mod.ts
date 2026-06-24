import "#reflect-metadata";

/**
 * Restricts a controller or route handler to callers holding **at least one** of the listed grants
 * (ANY-of). Grants are app-scoped strings infra assigns to a user — carried in the verified session
 * bearer's claim map under the app's own name (`claims[appName] = "grant1,grant2"`) — and enforced by
 * the global credential guard *after* authentication.
 *
 * Authorization is **deny-by-default (fail-closed)**: a controller route with no decorator requires
 * a grant nobody can name and is therefore closed. The only ways to reach a route are:
 *
 * - `@Public()` — no grant required at all.
 * - `@Grants("admin")` — the caller's app grants must include `admin` (any-of when several listed).
 * - the **`*` universal grant** — a caller whose app grants include `*` reaches every endpoint as if
 *   it were `@Public` (subject to the guard's skeleton policy — see the credential guard).
 *
 * ```ts
 * @Grants("admin")
 * @Delete(":id")
 * remove() {}
 * ```
 */
export const GRANTS_METADATA_KEY = "keep:grants";

// deno-lint-ignore no-explicit-any
export function Grants(...grants: string[]): any {
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(GRANTS_METADATA_KEY, grants, descriptor.value);
    } else {
      Reflect.defineMetadata(GRANTS_METADATA_KEY, grants, target);
    }
  };
}

/**
 * The grants required by the current execution context. A method-level `@Grants` overrides a
 * class-level one; returns `[]` when neither is present (which, being non-`@Public`, the guard
 * treats as closed unless the caller holds the `*` universal grant).
 */
// deno-lint-ignore no-explicit-any
export function requiredGrants(context: any): string[] {
  const handler = typeof context?.getHandler === "function"
    ? context.getHandler()
    : undefined;
  const cls = typeof context?.getClass === "function"
    ? context.getClass()
    : undefined;
  const onMethod = handler &&
    Reflect.getMetadata(GRANTS_METADATA_KEY, handler);
  if (Array.isArray(onMethod)) return onMethod;
  const onClass = cls && Reflect.getMetadata(GRANTS_METADATA_KEY, cls);
  return Array.isArray(onClass) ? onClass : [];
}
