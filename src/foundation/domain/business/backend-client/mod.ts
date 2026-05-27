import type { FetchHandler } from "@types";

const DEFAULT_BASE_URL = "http://localhost";

/**
 * In-process HTTP client. Its `fetch` is a drop-in for the global `fetch`: it dispatches
 * against a `FetchHandler` (Hono's `app.fetch`) so every call runs the EXACT server
 * pipeline — guards, pipes, interceptors, exception filters, middleware — without binding
 * a port or touching the network.
 */
export class BackendClient {
  constructor(
    private readonly handler: FetchHandler,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  /**
   * Drop-in replacement for the global `fetch` — same signature, returns the raw `Response`.
   * Dispatches fully in-process (no port, no TCP). Relative inputs (e.g. `/health`) resolve
   * against `baseUrl`, so they work here even though global `fetch` would reject them.
   */
  fetch: typeof fetch = (input, init) => {
    const request = input instanceof Request
      ? (init ? new Request(input, init) : input)
      : new Request(this.resolve(input), init);
    return Promise.resolve(this.handler(request));
  };

  private resolve(input: string | URL): string {
    return new URL(input, this.baseUrl).toString();
  }
}

export function createBackendClient(handler: FetchHandler, baseUrl?: string): BackendClient {
  return new BackendClient(handler, baseUrl);
}
