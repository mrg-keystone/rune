import "#reflect-metadata";
import { assertEquals } from "#assert";
import { claims, requiredClaims } from "./mod.ts";

class Ctrl {
  @claims(["docs"])
  internal() {}
  open() {}
}

@claims(["staff"])
class StaffCtrl {
  @claims(["admin"])
  remove() {}
  read() {}
}

Deno.test("@claims on a method is read for that handler", () => {
  assertEquals(
    requiredClaims({
      getHandler: () => Ctrl.prototype.internal,
      getClass: () => Ctrl,
    }),
    ["docs"],
  );
  assertEquals(
    requiredClaims({
      getHandler: () => Ctrl.prototype.open,
      getClass: () => Ctrl,
    }),
    [],
  );
});

Deno.test("method-level @claims overrides class-level", () => {
  assertEquals(
    requiredClaims({
      getHandler: () => StaffCtrl.prototype.remove,
      getClass: () => StaffCtrl,
    }),
    ["admin"],
  );
});

Deno.test("class-level @claims applies when the method has none", () => {
  assertEquals(
    requiredClaims({
      getHandler: () => StaffCtrl.prototype.read,
      getClass: () => StaffCtrl,
    }),
    ["staff"],
  );
});

Deno.test("requiredClaims is [] without the decorator", () => {
  class Plain {
    go() {}
  }
  assertEquals(
    requiredClaims({
      getHandler: () => Plain.prototype.go,
      getClass: () => Plain,
    }),
    [],
  );
});
