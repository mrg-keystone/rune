import { assertEquals } from "#assert";
import { processOrder } from "./mod.ts";

Deno.test("processOrder - linear chain follows dependsOn", () => {
  const { order, cycles } = processOrder([
    { id: "bake", dependsOn: ["mix"] },
    { id: "mix", dependsOn: ["checkout"] },
    { id: "checkout", dependsOn: ["shop"] },
    { id: "shop", dependsOn: ["drive"] },
    { id: "drive" },
  ]);
  assertEquals(order, ["drive", "shop", "checkout", "mix", "bake"]);
  assertEquals(cycles, []);
});

Deno.test("processOrder - order hint breaks ties among independent nodes", () => {
  const { order } = processOrder([
    { id: "c", order: 3 },
    { id: "a", order: 1 },
    { id: "b", order: 2 },
  ]);
  assertEquals(order, ["a", "b", "c"]);
});

Deno.test("processOrder - dependency wins over order hint", () => {
  const { order } = processOrder([
    { id: "first", order: 10, dependsOn: ["zeroth"] },
    { id: "zeroth", order: 1 },
  ]);
  assertEquals(order, ["zeroth", "first"]);
});

Deno.test("processOrder - reports a cycle and still returns all ids", () => {
  const { order, cycles } = processOrder([
    { id: "a", dependsOn: ["b"] },
    { id: "b", dependsOn: ["a"] },
    { id: "c" },
  ]);
  assertEquals(cycles, [["a", "b"]]);
  assertEquals(order.length, 3);
  assertEquals(order.includes("a") && order.includes("b") && order.includes("c"), true);
});

Deno.test("processOrder - unknown dependsOn ids are ignored", () => {
  const { order, cycles } = processOrder([
    { id: "x", dependsOn: ["ghost"] },
  ]);
  assertEquals(order, ["x"]);
  assertEquals(cycles, []);
});
