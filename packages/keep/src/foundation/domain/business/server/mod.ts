import { Type } from "@types";

export class Server {
  private _modules: Set<unknown> = new Set();
  get modules(): Type[] {
    return Array.from(this._modules) as Type[];
  }

  get moduleNames(): string[] {
    return this.modules.map((m) => m.name);
  }

  registerModule(module: Type) {
    this._modules.add(module);
  }

  static create(): Server {
    const server = new Server();
    return server;
  }

  private constructor() {}
}
