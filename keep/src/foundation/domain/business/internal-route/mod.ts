import "#reflect-metadata";

/**
 * Marks a controller or a single route handler as **internal** — an endpoint meant to be reached
 * only by the trusted in-process client (`api.backend.fetch`), never by an outside caller. The
 * canonical case is a background loop's tick endpoint (an orchestrator heartbeat, a queue drainer)
 * that the app dispatches to itself.
 *
 * This decorator changes NOTHING about enforcement: authorization is still deny-by-default, so an
 * `@Internal` route stays fail-closed to external callers exactly as a bare one does (reachable
 * only in-process, or by a caller holding the `*` universal grant). What it changes is INTENT: it
 * records that the route's bareness is deliberate, so the boot-time route audit stops flagging it
 * as a possibly-forgotten `@Grant`/`@LoggedIn`. Use it precisely when the right posture IS "no
 * external caller, reached in-process" — not as a way to skip gating a route that outsiders call.
 *
 * ```ts
 * @Controller("http")
 * class OrchestratorController {
 *   @Internal()          // called only by the in-process client's tick loop
 *   @Post("orchestrator-tick")
 *   tick() {}
 * }
 * ```
 */
export const INTERNAL_METADATA_KEY = "keep:internal";

// deno-lint-ignore no-explicit-any
export function Internal(): any {
  // Mirrors Danet's SetMetadata / keep's @Public: method-level metadata lives on the method
  // function (descriptor.value), class-level on the constructor — matching what the audit reads
  // via context.getHandler() / context.getClass().
  return (
    // deno-lint-ignore no-explicit-any
    target: any,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor && descriptor.value) {
      Reflect.defineMetadata(INTERNAL_METADATA_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(INTERNAL_METADATA_KEY, true, target);
    }
  };
}

/**
 * @deprecated spelling alias for {@link Internal}. `@InProcessOnly()` reads more literally at some
 * call sites; identical behavior.
 */
// deno-lint-ignore no-explicit-any
export function InProcessOnly(): any {
  return Internal();
}

/** Reads whether the current execution context's handler or controller is `@Internal`. */
// deno-lint-ignore no-explicit-any
export function isInternalContext(context: any): boolean {
  const handler = typeof context?.getHandler === "function"
    ? context.getHandler()
    : undefined;
  const cls = typeof context?.getClass === "function"
    ? context.getClass()
    : undefined;
  return Boolean(
    (handler && Reflect.getMetadata(INTERNAL_METADATA_KEY, handler)) ||
      (cls && Reflect.getMetadata(INTERNAL_METADATA_KEY, cls)),
  );
}
