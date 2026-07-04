import { assertEquals } from "#assert";
import { Grants, requiredGrants } from "./mod.ts";

class Ctrl {
  @Grants("admin", "deploy")
  remove() {}
  plain() {}
}

@Grants("staff")
class Decorated {
  @Grants("admin")
  remove() {}
  inherits() {}
}

const ctx = (cls: unknown, handler: unknown) => ({
  getHandler: () => handler,
  getClass: () => cls,
});

Deno.test("@Grants on a method is read for that handler (any-of list)", () => {
  assertEquals(
    requiredGrants(ctx(Ctrl, Ctrl.prototype.remove)),
    ["admin", "deploy"],
  );
});

Deno.test("a handler with no @Grants requires none (closed by default at the guard)", () => {
  assertEquals(requiredGrants(ctx(Ctrl, Ctrl.prototype.plain)), []);
});

Deno.test("method-level @Grants overrides class-level", () => {
  assertEquals(
    requiredGrants(ctx(Decorated, Decorated.prototype.remove)),
    ["admin"],
  );
});

Deno.test("class-level @Grants applies when the method has none", () => {
  assertEquals(
    requiredGrants(ctx(Decorated, Decorated.prototype.inherits)),
    ["staff"],
  );
});
