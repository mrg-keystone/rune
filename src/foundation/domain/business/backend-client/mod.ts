import type { FetchHandler } from "@types";

const DEFAULT_BASE_URL = "http://localhost";

/**
 * Header carrying the process-private internal key. The in-process client stamps it; the token
 * auth middleware trusts a request only when its value matches the key minted at boot. The key
 * never leaves the process, so a network client cannot forge this header.
 */
export const INTERNAL_REQUEST_HEADER = "x-danet-internal";

/**
 * In-process HTTP client. Its `fetch` is a drop-in for the global `fetch`: it dispatches
 * against a `FetchHandler` (Hono's `app.fetch`) so every call runs the EXACT server
 * pipeline — guards, pipes, interceptors, exception filters, middleware — without binding
 * a port or touching the network.
 *
 * When constructed with an `internalKey`, every request is stamped with
 * `INTERNAL_REQUEST_HEADER` so it is recognized as in-process and skips token auth.
 */
export class BackendClient {
  constructor(
    private readonly handler: FetchHandler,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly internalKey?: string,
  ) {}

  /**
   * Drop-in replacement for the global `fetch` — same signature, returns the raw `Response`.
   * Dispatches fully in-process (no port, no TCP). Relative inputs (e.g. `/health`) resolve
   * against `baseUrl`, so they work here even though global `fetch` would reject them.
   */
  fetch: typeof fetch = (input, init) => {
    const base = input instanceof Request
      ? (init ? new Request(input, init) : input)
      : new Request(this.resolve(input), init);
    return Promise.resolve(this.handler(this.stamp(base)));
  };

  /** Tags the request as in-process so the auth middleware skips the token requirement. */
  private stamp(request: Request): Request {
    if (!this.internalKey) return request;
    const headers = new Headers(request.headers);
    headers.set(INTERNAL_REQUEST_HEADER, this.internalKey);
    return new Request(request, { headers });
  }

  private resolve(input: string | URL): string {
    return new URL(input, this.baseUrl).toString();
  }
}

export function createBackendClient(
  handler: FetchHandler,
  baseUrl?: string,
  internalKey?: string,
): BackendClient {
  return new BackendClient(handler, baseUrl, internalKey);
}
