import { assertEquals } from "#assert";
import { InjectClass, InjectFactory, InjectValue } from "./mod.ts";

Deno.test("InjectValue stores provide and useValue", () => {
  const inject = new InjectValue("TOKEN", "my-value");
  assertEquals(inject.provide, "TOKEN");
  assertEquals(inject.useValue, "my-value");
});

Deno.test("InjectFactory stores provide and useFactory", () => {
  const factory = () => "created";
  const inject = new InjectFactory("TOKEN", factory);
  assertEquals(inject.provide, "TOKEN");
  assertEquals(inject.useFactory(), "created");
});

Deno.test("InjectClass stores provide and useClass", () => {
  class MyService {}
  const inject = new InjectClass("TOKEN", MyService);
  assertEquals(inject.provide, "TOKEN");
  assertEquals(inject.useClass, MyService);
});
