import { assert, assertEquals } from "#std/assert";
import { join } from "#std/path";
import { runSync } from "./mod.ts";

const SPEC = `[MOD] orders
[REQ] orders.place(PlaceDto): OrderDto
    cart.total(): money
    [RET] OrderDto


[NON] cart
    the shopping cart
[TYP] money: number
    a monetary amount

[DTO] PlaceDto: money
    place-order input
[DTO] OrderDto: money
    the resulting order
`;

Deno.test("sync scaffolds, then preserves fill-ins and prunes orphans", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "specs"), { recursive: true });
    const runePath = join(root, "specs", "orders.rune");
    await Deno.writeTextFile(runePath, SPEC);

    // First sync: scaffold the canonical layout.
    assertEquals(await runSync([runePath, "--root", root]), 0);
    const cartMod = join(root, "src/orders/domain/business/cart/mod.ts");
    assert(
      (await Deno.stat(cartMod)).isFile,
      "cart/mod.ts should be scaffolded",
    );

    // sync makes a fresh project compile out of the box: it writes a deno.json
    // with the import aliases the generated code uses (@/, #zod, #std/*).
    const denoJson = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
    assertEquals(denoJson.imports["@/"], "./");
    assertEquals(denoJson.imports["#zod"], "npm:zod");

    // Fill in cart, and plant an orphan feature the spec doesn't declare.
    const filled = "// my implementation\nexport class Cart {}\n";
    await Deno.writeTextFile(cartMod, filled);
    const orphan = join(root, "src/orders/domain/business/legacy");
    await Deno.mkdir(orphan, { recursive: true });
    await Deno.writeTextFile(
      join(orphan, "mod.ts"),
      "export class Legacy {}\n",
    );

    // Second sync (no --force): cart preserved; legacy is a dev-owned orphan, so
    // it is HELD BACK, not deleted — a spec edit must never silently drop code.
    assertEquals(await runSync([runePath, "--root", root]), 0);
    assertEquals(await Deno.readTextFile(cartMod), filled);
    assert(
      await exists(orphan),
      "dev-owned orphan must NOT be pruned without --force",
    );

    // Third sync with --force: now the orphan is actually pruned.
    assertEquals(await runSync([runePath, "--root", root, "--force"]), 0);
    assertEquals(
      await Deno.readTextFile(cartMod),
      filled,
      "cart still preserved",
    );
    assert(
      !(await exists(orphan)),
      "orphan legacy/ folder should be pruned with --force",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
