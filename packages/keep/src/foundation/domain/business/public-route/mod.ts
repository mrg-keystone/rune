import "#reflect-metadata";

/**
 * Marks a controller or a single route handler as **public** — i.e. no credential is required
 * to reach it. Authorization is deny-by-default; `@Public()` is the only opt-out. Apply it to a
 * class (all routes) or a method (that route only).
 *
 * Public means auth-*optional*, not auth-*ignored*: if a valid credential is present it is still
 * verified and its identity attached for logging, it just isn't required.
 *
 * ```ts
 * @Controller("inbound")
 * class WebhookController {
 *   @Public()           // gated by its own webhook secret, not a danet token
 *   @Post()
 *   receive() {}
 * }
 * ```
 */
export const PUBLIC_METADATA_KEY = "danet:isPublic";

// deno-lint-ignore no-explicit-any
export function Public(): any {
  // Mirrors Danet's own SetMetadata: method-level metadata lives on the method function
  // (descriptor.value), class-level on the constructor — matching what the guard reads via
  // context.getHandler() / context.getClass().
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, target);
    }
  };
}

/** Reads whether the current execution context's handler or controller is `@Public`. */
// deno-lint-ignore no-explicit-any
export function isPublicContext(context: any): boolean {
  const handler = typeof context?.getHandler === "function"
    ? context.getHandler()
    : undefined;
  const cls = typeof context?.getClass === "function"
    ? context.getClass()
    : undefined;
  return Boolean(
    (handler && Reflect.getMetadata(PUBLIC_METADATA_KEY, handler)) ||
      (cls && Reflect.getMetadata(PUBLIC_METADATA_KEY, cls)),
  );
}
