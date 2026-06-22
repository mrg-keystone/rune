// Hand-authored L4 fixture with deliberate violations — exercises the linter
// so the L4 gate proves rules actually fire (not just that output is clean).
import { helper } from "../../../../shared/helper.ts"; // import-aliases: relative ../
import { z } from "npm:zod"; // external-imports: bare npm:

export function widget(): unknown {
  return helper(z);
}
