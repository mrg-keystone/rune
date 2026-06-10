/**
 * Order endpoints for the emulator + headless runner from their **explicit** process metadata —
 * `order` (a hint) and `dependsOn` (hard edges). No field inference: dependencies are declared on
 * `@Endpoint`, this just topologically sorts them and reports any cycles so the caller can warn /
 * fall back to seeds rather than hang.
 */

export interface ProcessOperation {
  /** Endpoint id — the handler method name / OpenAPI operationId. */
  id: string;
  /** Ids that must run before this one. Unknown ids are ignored for ordering. */
  dependsOn?: string[];
  /** Ascending position hint; ties and unspecified orders fall back to id. */
  order?: number;
}

export interface ProcessGraph {
  /** Best-effort topological run order (cycle members are appended after the acyclic prefix). */
  order: string[];
  /** Strongly-connected components of size > 1, plus any self-dependency, that block a clean order. */
  cycles: string[][];
}

/** Topologically order operations by their explicit `dependsOn` edges, tie-broken by `order` then id. */
export function processOrder(ops: ProcessOperation[]): ProcessGraph {
  const ids = new Set(ops.map((o) => o.id));
  const byId = new Map(ops.map((o) => [o.id, o]));
  // edge dep -> dependent; only keep edges to known ids.
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const o of ops) {
    indegree.set(o.id, 0);
    dependents.set(o.id, []);
  }
  for (const o of ops) {
    for (const dep of o.dependsOn ?? []) {
      if (!ids.has(dep) || dep === o.id) continue;
      dependents.get(dep)!.push(o.id);
      indegree.set(o.id, (indegree.get(o.id) ?? 0) + 1);
    }
  }

  const rank = (id: string) => byId.get(id)?.order ?? Number.POSITIVE_INFINITY;
  const pick = (pool: string[]) =>
    pool.sort((a, b) => (rank(a) - rank(b)) || (a < b ? -1 : a > b ? 1 : 0));

  const order: string[] = [];
  let available = pick([...ids].filter((id) => indegree.get(id) === 0));
  while (available.length > 0) {
    const id = available.shift()!;
    order.push(id);
    for (const next of dependents.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) available.push(next);
    }
    available = pick(available);
  }

  const cycles = order.length === ids.size ? [] : findCycles(ops, ids);
  // Append cycle members (in id order) so the runner still attempts them via seeds.
  if (cycles.length > 0) {
    const placed = new Set(order);
    for (const id of [...ids].sort()) if (!placed.has(id)) order.push(id);
  }
  return { order, cycles };
}

/** Tarjan SCC over the dependency edges; returns components of size > 1 and self-loops. */
function findCycles(ops: ProcessOperation[], ids: Set<string>): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  const selfLoops: string[][] = [];
  for (const o of ops) {
    for (const dep of o.dependsOn ?? []) {
      if (!ids.has(dep)) continue;
      if (dep === o.id) selfLoops.push([o.id]);
      else adj.get(dep)!.push(o.id);
    }
  }

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const strongConnect = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v)!) {
      if (!idx.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) components.push(comp.sort());
    }
  };

  for (const id of ids) if (!idx.has(id)) strongConnect(id);
  return [...components, ...selfLoops];
}
