import type { EntryTarget, PipelineContext } from "@/core/dto/types.ts";
import {
  type CseNode,
  parse,
  type StepLike,
} from "@rune/domain/business/rune-parse/mod.ts";
import { isProjectSpec } from "@rune/domain/business/rune-bindings/mod.ts";

// rune-service-presence: every boundary call `service:noun.verb(...)` must name a
// service declared by a matching `[SRV] <transport>:<service>: <ENV,…>` in the
// same spec. The `service:` prefix replaced the old fixed db:/fs:/… kinds — there
// are no builtin boundaries anymore, so an undeclared service is a spec error.

export async function check(
  path: string,
  target: EntryTarget,
  ctx: PipelineContext,
): Promise<string[] | null> {
  if (target !== "rune") return null;
  if (!isProjectSpec(path)) return null;

  const text = await ctx.getFileContent(path);
  const ast = parse(text);

  const declared = new Set(ast.srvs.map((s) => s.name));
  const used = new Map<string, number>(); // service -> first line
  for (const req of ast.reqs) collectServices(req.steps, used);

  const violations: string[] = [];
  for (const [service, line] of used) {
    if (!declared.has(service)) {
      violations.push(
        `Undeclared service "${service}" (boundary at line ${line + 1}) — ` +
          `add \`[SRV] <transport>:${service}: <ENV,…>\` (transport: sk/hp/ws/sc)`,
      );
    }
  }
  return violations.length > 0 ? violations : null;
}

function collectServices(
  steps: StepLike[] | CseNode["steps"],
  out: Map<string, number>,
): void {
  for (const step of steps) {
    if (step.kind === "boundary") {
      if (!out.has(step.service)) out.set(step.service, step.line);
    } else if (step.kind === "ply") {
      for (const cse of step.cases) collectServices(cse.steps, out);
    }
  }
}

export const SYSTEM_PROMPT =
  `You are enforcing the rune-service-presence rule.

Every boundary call uses a declared service prefix: \`service:noun.verb(...)\`.
The service must be declared once in the same spec:
  [SRV] <transport>:<service>: <ENV_VAR, ENV_VAR2>
where transport is one of sk (sdk) / hp (http) / ws (websocket) / sc (sidecar).

An undeclared service means a boundary points at a backing service the spec never
described (its transport + config are unknown).`;

export function buildPrompt(
  violations: string[],
  path: string,
  _target: EntryTarget,
): string {
  return `Rune file: ${path}
Undeclared services:
${violations.map((v) => `  - ${v}`).join("\n")}

Add a [SRV] declaration for each service, or change the boundary prefix to a
service that is already declared.`;
}
