import "#reflect-metadata";

/**
 * Restricts a controller or route handler to callers holding **at least one** of the listed claims
 * (ANY-of). This generalizes {@link Roles} — `@Roles("admin")` is the role-claim sugar for
 * `@claims(["admin"])`. Required claims are matched against the caller's verified, app-scoped role
 * claims by the global credential guard *after* authentication.
 *
 * - `@claims(["docs"])` — allow callers whose scoped claims include `docs`.
 * - `@claims([])` / no decorator — any authenticated identity (the guard still denies non-`@Public`
 *   routes without a credential).
 * - The `*` skeleton key bypasses the required list entirely (unless skeleton is disabled for the
 *   service, or the token is older than the 24h cap) — see the credential guard.
 *
 * Same metadata mechanism as `@Roles`: a method-level `@claims` overrides a class-level one.
 *
 * ```ts
 * @claims(["docs"])
 * @Get("internal")
 * internal() {}
 * ```
 */
export const CLAIMS_METADATA_KEY = "danet:claims";

// deno-lint-ignore no-explicit-any
export function claims(required: string[]): any {
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(CLAIMS_METADATA_KEY, required, descriptor.value);
    } else {
      Reflect.defineMetadata(CLAIMS_METADATA_KEY, required, target);
    }
  };
}

/**
 * The claims required by the current execution context. A method-level `@claims` overrides a
 * class-level one; returns `[]` when neither is present.
 */
// deno-lint-ignore no-explicit-any
export function requiredClaims(context: any): string[] {
  const handler = typeof context?.getHandler === "function"
    ? context.getHandler()
    : undefined;
  const cls = typeof context?.getClass === "function"
    ? context.getClass()
    : undefined;
  const onMethod = handler &&
    Reflect.getMetadata(CLAIMS_METADATA_KEY, handler);
  if (Array.isArray(onMethod)) return onMethod;
  const onClass = cls && Reflect.getMetadata(CLAIMS_METADATA_KEY, cls);
  return Array.isArray(onClass) ? onClass : [];
}
