import { assertEquals } from "#std/assert";
import { join } from "#std/path";
import { runCheck } from "./mod.ts";

const VALID = `[MOD] m

[TYP] id: string
    an id
[DTO] ThingDto: id
    a thing
[NON] thing
    a thing`;

// Same spec but the DTO references a property with no [TYP] — the rule the
// `check` contract advertises (every [DTO] field must resolve).
const MISSING_TYP = `[MOD] m

[TYP] id: string
    an id
[DTO] ThingDto: id, extra
    a thing
[NON] thing
    a thing`;

Deno.test("runCheck — exit 0 on a valid spec", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "thing.rune");
  await Deno.writeTextFile(file, VALID);
  try {
    assertEquals(await runCheck([file]), 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runCheck — exit 2 on a missing-[TYP] spec", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "thing.rune");
  await Deno.writeTextFile(file, MISSING_TYP);
  try {
    assertEquals(await runCheck([file]), 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runCheck — exit 2 when no spec path is given", async () => {
  assertEquals(await runCheck([]), 2);
});
