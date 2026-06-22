import "#reflect-metadata";

/**
 * Restricts a controller or route handler to callers holding **at least one** of the listed
 * roles. Roles come from the verified credential — Firebase custom claims (`roles`/`role`) or a
 * session bearer's comma-separated `role` claim — and are enforced by the global credential guard
 * *after* authentication.
 *
 * `@Roles` is the **role-claim sugar** over `@claims`: the guard treats `@Roles("admin")` and
 * `@claims(["admin"])` identically (ANY-of against the caller's app-scoped role claims), and unions
 * both when present. It is kept as a convenience for the common role case.
 *
 * `@Roles` implies authentication: a role-gated route always requires a valid credential (so it
 * overrides `@Public`). Trusted origins (in-process / localhost) bypass it, like all auth.
 *
 * ```ts
 * @Roles("admin")
 * @Delete(":id")
 * remove() {}
 * ```
 */
export const ROLES_METADATA_KEY = "danet:roles";

// deno-lint-ignore no-explicit-any
export function Roles(...roles: string[]): any {
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(ROLES_METADATA_KEY, roles, descriptor.value);
    } else {
      Reflect.defineMetadata(ROLES_METADATA_KEY, roles, target);
    }
  };
}

/**
 * The roles required by the current execution context. A method-level `@Roles` overrides a
 * class-level one; returns `[]` when neither is present.
 */
// deno-lint-ignore no-explicit-any
export function requiredRoles(context: any): string[] {
  const handler = typeof context?.getHandler === "function"
    ? context.getHandler()
    : undefined;
  const cls = typeof context?.getClass === "function"
    ? context.getClass()
    : undefined;
  const onMethod = handler && Reflect.getMetadata(ROLES_METADATA_KEY, handler);
  if (Array.isArray(onMethod)) return onMethod;
  const onClass = cls && Reflect.getMetadata(ROLES_METADATA_KEY, cls);
  return Array.isArray(onClass) ? onClass : [];
}
