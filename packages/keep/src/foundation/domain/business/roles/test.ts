import "#reflect-metadata";
import { assertEquals } from "#assert";
import { requiredRoles, Roles } from "./mod.ts";

class Ctrl {
  @Roles("admin")
  remove() {}
  list() {}
}

@Roles("staff")
class StaffCtrl {
  @Roles("admin")
  remove() {}
  read() {}
}

Deno.test("@Roles on a method is read for that handler", () => {
  assertEquals(
    requiredRoles({
      getHandler: () => Ctrl.prototype.remove,
      getClass: () => Ctrl,
    }),
    [
      "admin",
    ],
  );
  assertEquals(
    requiredRoles({
      getHandler: () => Ctrl.prototype.list,
      getClass: () => Ctrl,
    }),
    [],
  );
});

Deno.test("method-level @Roles overrides class-level", () => {
  assertEquals(
    requiredRoles({
      getHandler: () => StaffCtrl.prototype.remove,
      getClass: () => StaffCtrl,
    }),
    ["admin"],
  );
});

Deno.test("class-level @Roles applies when the method has none", () => {
  assertEquals(
    requiredRoles({
      getHandler: () => StaffCtrl.prototype.read,
      getClass: () => StaffCtrl,
    }),
    ["staff"],
  );
});

Deno.test("requiredRoles is [] without the decorator", () => {
  class Plain {
    go() {}
  }
  assertEquals(
    requiredRoles({
      getHandler: () => Plain.prototype.go,
      getClass: () => Plain,
    }),
    [],
  );
});
