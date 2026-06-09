import { resolve } from "#std/path";
import { planManifest } from "@rune/domain/business/rune-manifest/mod.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// `rune check <file.rune>` — validate a spec WITHOUT generating anything. Runs
// the same parser + rules as `rune sync` and the LSP; exit 0 = clean, 2 = errors.
export async function runCheck(args: string[]): Promise<number> {
  const runePath = args.find((a) => !a.startsWith("--"));
  if (!runePath) {
    console.error("Usage: rune check <rune-file>");
    return 2;
  }

  let text: string;
  try {
    text = await Deno.readTextFile(resolve(runePath));
  } catch (e) {
    console.error(
      `${RED}error: cannot read ${runePath}: ${
        e instanceof Error ? e.message : e
      }${RESET}`,
    );
    return 2;
  }

  const plan = planManifest(runePath, text, new Set(), {});
  if (plan.errors.length === 0) {
    console.log(`${GREEN}${runePath}: OK — no errors${RESET}`);
    return 0;
  }

  console.error(
    `${BOLD}${RED}${plan.errors.length} error(s) in ${runePath}:${RESET}`,
  );
  for (const e of plan.errors) console.error(`  ${e}`);
  return 2;
}
