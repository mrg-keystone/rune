import { assertEquals } from "#assert";
import { getSwaggerDescription, SwaggerDescription } from "./mod.ts";

Deno.test("SwaggerDescription decorator sets metadata on class", () => {
  @SwaggerDescription("My API Description")
  class TestModule {}

  const description = getSwaggerDescription(TestModule);
  assertEquals(description, "My API Description");
});

Deno.test("getSwaggerDescription returns undefined when no decorator", () => {
  class PlainModule {}

  const description = getSwaggerDescription(PlainModule);
  assertEquals(description, undefined);
});

Deno.test("SwaggerDescription works with different descriptions", () => {
  @SwaggerDescription("Users API - Manage user accounts")
  class UsersModule {}

  @SwaggerDescription("Orders API - Handle order processing")
  class OrdersModule {}

  assertEquals(
    getSwaggerDescription(UsersModule),
    "Users API - Manage user accounts",
  );
  assertEquals(
    getSwaggerDescription(OrdersModule),
    "Orders API - Handle order processing",
  );
});
