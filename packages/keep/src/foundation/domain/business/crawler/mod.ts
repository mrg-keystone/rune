import "#reflect-metadata";
import { Type } from "@types";

interface ModuleMetadata {
  imports?: Type[];
  controllers?: Type[];
  injectables?: Type[];
  exports?: Type[];
}

export class Crawler {
  private filters: string[] = [];
  constructor(...filters: string[]) {
    this.filters = filters;
  }

  private filter(modules: Type[]) {
    return modules.filter((m) => !this.filters.includes(m.name));
  }

  private moduleGuard(possibleModule: unknown): possibleModule is Type {
    return (
      typeof possibleModule === "function" &&
      "name" in possibleModule &&
      typeof possibleModule.name === "string"
    );
  }

  getModuleImports(module: Type) {
    // A non-@Module function has no "module" metadata (getMetadata → undefined); guard so
    // destructuring `{ imports }` can't throw.
    const { imports } =
      (Reflect.getMetadata("module", module) ?? {}) as ModuleMetadata;
    const processed = imports?.filter(Boolean);
    return processed ?? [];
  }

  crawl(_modules: unknown[], collected: Set<Type> = new Set()): Array<Type> {
    const modules = _modules.filter(this.moduleGuard);
    // Only descend into modules we haven't already collected. Without this dedup a circular
    // import (A→B→A) would re-yield A→B→A… forever and overflow the stack. The set of FRESH
    // (newly seen) modules drives the next round; when a round adds nothing new we're done.
    const fresh = modules.filter((m) => !collected.has(m));
    fresh.forEach((m) => collected.add(m));
    if (fresh.length === 0) return this.filter(Array.from(collected));
    const newModules = fresh.map(this.getModuleImports).flat();
    return this.crawl(newModules, collected);
  }
}
