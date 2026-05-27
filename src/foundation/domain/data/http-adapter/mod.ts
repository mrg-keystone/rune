import type { Type, Cotr, HttpMethod, FetchHandler } from "@types";
import { SwaggerModule } from "#danet/swagger";
import { DanetApplication } from "#danet/core";

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

  /** The standalone request dispatcher — identical to the handler `Deno.serve` runs. */
  get handler(): FetchHandler {
    const hono = this.app.router;
    return (req: Request) => hono.fetch(req);
  }

  async listen(rootModule: Type) {
    const port = this.defaultPort ?? 3000;
    await this.init(rootModule);
    await this.app.listen(port);
  }

  registerSwaggerDocument(atPath: string, document: Parameters<typeof SwaggerModule.setup>[2]) {
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

  grabComponent = <T extends Cotr>(cotr: T): InstanceType<T> => this.app.get(cotr);

  async stop() {
    await this.app.close();
  }
}
