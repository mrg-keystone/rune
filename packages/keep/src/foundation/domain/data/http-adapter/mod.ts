import type { Cotr, FetchHandler, HttpMethod, Type } from "@types";
import { SwaggerModule } from "#danet/swagger";
import { DanetApplication } from "#danet/core";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";

/**
 * Removes the in-process trust header from an inbound request. The header marks requests minted
 * by the in-process client as trusted (auth-exempt); stripping it on the network boundary means
 * a request arriving over the network — however it was mounted or whatever it sends — can NEVER
 * impersonate an in-process call. The in-process client dispatches via `inProcessHandler`, which
 * does not strip, so its own trust marker survives.
 */
function stripInternalHeader(req: Request): Request {
  if (!req.headers.has(INTERNAL_REQUEST_HEADER)) return req;
  const headers = new Headers(req.headers);
  headers.delete(INTERNAL_REQUEST_HEADER);
  return new Request(req, { headers });
}

export abstract class HttpAdapter {
  constructor(public defaultPort?: number) {}
  abstract listen(...args: unknown[]): Promise<void>;
  abstract grabComponent<T extends Type<any>>(cotr: T): InstanceType<T>;
}

export class DanetHttpAdapter extends HttpAdapter {
  app: DanetApplication = new DanetApplication();
  private initialized = false;
  constructor(defaultPort?: number) {
    super(defaultPort);
  }

  /** Initialize the module tree (register controllers, run bootstrap hooks). Idempotent. */
  async init(rootModule: Type) {
    if (this.initialized) return;
    await this.app.init(rootModule);
    this.initialized = true;
  }

  /**
   * The standalone **network** dispatcher — what `Deno.serve` runs and what you mount in a
   * composed app. It strips the in-process trust header so no inbound request can impersonate an
   * in-process call, then forwards Deno's connection `info` (as the request env) so
   * `remoteAddr`/loopback detection survives when mounted behind another listener.
   */
  get handler(): FetchHandler {
    const hono = this.app.router;
    return (req: Request, info?: Deno.ServeHandlerInfo) =>
      hono.fetch(stripInternalHeader(req), info);
  }

  /**
   * The **in-process** dispatcher used by the `BackendClient`. It does NOT strip the trust
   * header, so the client's in-process marker is honored. Never expose this to network traffic —
   * routing inbound requests through it (or through `backend.fetch`) bypasses auth by design.
   */
  get inProcessHandler(): FetchHandler {
    const hono = this.app.router;
    return (req: Request, info?: Deno.ServeHandlerInfo) =>
      hono.fetch(req, info);
  }

  async listen(rootModule: Type) {
    const port = this.defaultPort ?? 3000;
    await this.init(rootModule);
    await this.app.listen(port);
  }

  registerSwaggerDocument(
    atPath: string,
    document: Parameters<typeof SwaggerModule.setup>[2],
  ) {
    SwaggerModule.setup(atPath, this.app, document);
  }

  registerRoute(
    method: Lowercase<HttpMethod>,
    path: string,
    handler: (...args: unknown[]) => unknown,
  ) {
    //@ts-ignore: methods are in router
    const registerFn = this.app.router[method];
    registerFn.call(this.app.router, path, handler);
  }

  grabComponent = <T extends Cotr>(cotr: T): InstanceType<T> =>
    this.app.get(cotr);

  async stop() {
    await this.app.close();
  }
}
