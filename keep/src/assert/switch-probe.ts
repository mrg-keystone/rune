// Subprocess probe: with RUNE_ASSERT=off the invalid payload must pass through
// untouched; otherwise assert must throw. Prints which behavior it observed.
// Run by test.ts in a child process — the env switch is read at module load.
import { IsString } from "class-validator";
import { assert, RuneAssertError } from "./mod.ts";

class ProbeDto {
  @IsString()
  id!: string;
}

const bad = { id: 42 };
try {
  const out = assert(ProbeDto, bad) as unknown;
  // passthrough returns the ORIGINAL object, not a transformed copy
  console.log(out === bad ? "passthrough" : "transformed");
} catch (e) {
  console.log(e instanceof RuneAssertError ? "enforced" : "unexpected");
}
