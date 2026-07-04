import "#reflect-metadata";
import { assertEquals } from "#assert";
import { isPublicContext, Public } from "./mod.ts";

class Ctrl {
  @Public()
  open() {}
  closed() {}
}

@Public()
class PublicCtrl {}

class PlainCtrl {}

Deno.test("@Public on a method marks just that handler", () => {
  assertEquals(
    isPublicContext({
      getHandler: () => Ctrl.prototype.open,
      getClass: () => Ctrl,
    }),
    true,
  );
  assertEquals(
    isPublicContext({
      getHandler: () => Ctrl.prototype.closed,
      getClass: () => Ctrl,
    }),
    false,
  );
});

Deno.test("@Public on a class marks the controller", () => {
  assertEquals(
    isPublicContext({
      getHandler: () => undefined,
      getClass: () => PublicCtrl,
    }),
    true,
  );
});

Deno.test("an undecorated controller is not public", () => {
  assertEquals(
    isPublicContext({
      getHandler: () => PlainCtrl.prototype,
      getClass: () => PlainCtrl,
    }),
    false,
  );
});

Deno.test("isPublicContext tolerates a context without accessors", () => {
  assertEquals(isPublicContext({}), false);
});
