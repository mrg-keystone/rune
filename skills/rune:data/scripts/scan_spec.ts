#!/usr/bin/env -S deno run -A
// scan_spec.ts — deterministic pre-pass for rune:data.
//
// Parses the module's .rune spec(s) and emits the raw data inventory the
// designer must reason over: entities, DTOs, every persistence read/write
// (boundary `service:noun.verb` steps), and — crucially — every [REQ] flow
// shaped `load(noun) … save(noun)` on the SAME noun, which is an in-place edit
// and a candidate for immutable restructuring.
//
// This is the part that must NOT be left to eyeballing: a missed entity or a
// missed mutation silently corrupts the design. The store/immutability
// DECISIONS stay with the model — this only hands it a complete, accurate map.
//
// Usage:  deno run -A scan_spec.ts spec/audits.rune [spec/core.rune ...]
//         deno run -A scan_spec.ts spec/            (scans every *.rune in dir)

interface Step { raw: string; kind: "boundary" | "static" | "instance" | "new" | "other"; service?: string; noun?: string; verb?: string; }
interface Req { name: string; input: string; output: string; steps: Step[]; }
interface Inventory {
  module: string;
  specs: string[];
  entities: string[];
  dtos: { name: string; fields: string[] }[];
  reqs: { name: string; input: string; output: string }[];
  writes: { noun: string; service: string; verb: string; req: string }[];
  reads: { noun: string; service: string; verb: string; req: string }[];
  mutationCandidates: { req: string; noun: string; evidence: string }[];
  notes: string[];
}

async function collectFiles(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of args) {
    const info = await Deno.stat(a).catch(() => null);
    if (info?.isDirectory) {
      for await (const e of Deno.readDir(a)) {
        if (e.isFile && e.name.endsWith(".rune")) out.push(`${a.replace(/\/$/, "")}/${e.name}`);
      }
    } else if (info?.isFile) out.push(a);
  }
  return out;
}

function classify(line: string): Step {
  const raw = line.trim();
  // boundary: service:noun.verb(...)   (single colon, then noun.verb)
  const b = raw.match(/^([a-zA-Z][\w]*):([a-zA-Z][\w]*)\.([a-zA-Z][\w]*)\s*\(/);
  if (b) return { raw, kind: "boundary", service: b[1], noun: b[2], verb: b[3] };
  if (/^\[NEW\]/.test(raw)) return { raw, kind: "new", noun: raw.replace(/^\[NEW\]\s*/, "").trim() };
  const stat = raw.match(/^([A-Za-z][\w]*)::([a-zA-Z][\w]*)\s*\(/);
  if (stat) return { raw, kind: "static", noun: stat[1], verb: stat[2] };
  const inst = raw.match(/^([a-zA-Z][\w]*)\.([a-zA-Z][\w]*)\s*\(/);
  if (inst) return { raw, kind: "instance", noun: inst[1], verb: inst[2] };
  return { raw, kind: "other" };
}

function isReadVerb(v?: string) { return !!v && /^(load|get|fetch|find|read|list|by[A-Z])/.test(v); }
function isWriteVerb(v?: string) { return !!v && /^(save|put|set|store|write|insert|update|persist|create|append)/.test(v); }

async function main() {
  const args = Deno.args;
  if (!args.length) { console.error("usage: scan_spec.ts <spec.rune|spec/dir> ..."); Deno.exit(2); }
  const files = await collectFiles(args);
  const inv: Inventory = { module: "", specs: files, entities: [], dtos: [], reqs: [], writes: [], reads: [], mutationCandidates: [], notes: [] };

  for (const f of files) {
    const text = await Deno.readTextFile(f);
    const lines = text.split("\n");
    let cur: Req | null = null;
    const flush = () => {
      if (!cur) return;
      inv.reqs.push({ name: cur.name, input: cur.input, output: cur.output });
      // reads/writes
      for (const s of cur.steps) {
        if (s.kind !== "boundary") continue;
        const rec = { noun: s.noun!, service: s.service!, verb: s.verb!, req: cur.name };
        if (isWriteVerb(s.verb)) inv.writes.push(rec);
        else if (isReadVerb(s.verb)) inv.reads.push(rec);
        else inv.writes.push(rec); // unknown boundary verb: treat as a persistence touch, surface it
      }
      // mutation candidate: a load and a later save on the same noun within one REQ
      const byNoun = new Map<string, { read?: number; write?: number }>();
      cur.steps.forEach((s, i) => {
        if (s.kind !== "boundary") return;
        const e = byNoun.get(s.noun!) ?? {};
        if (isReadVerb(s.verb) && e.read === undefined) e.read = i;
        if (isWriteVerb(s.verb)) e.write = i;
        byNoun.set(s.noun!, e);
      });
      for (const [noun, e] of byNoun) {
        if (e.read !== undefined && e.write !== undefined && e.write > e.read) {
          inv.mutationCandidates.push({
            req: cur.name, noun,
            evidence: `${cur.name}: load(${noun}) at step ${e.read + 1} then save(${noun}) at step ${e.write + 1} — in-place edit`,
          });
        }
      }
      cur = null;
    };

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("//")) continue;
      const mod = t.match(/^\[MOD\]\s+(\S+)/);
      if (mod) { if (!inv.module) inv.module = mod[1]; continue; }
      const non = t.match(/^\[NON\]\s+(\S+)/);
      if (non) { if (!inv.entities.includes(non[1])) inv.entities.push(non[1]); continue; }
      const dto = t.match(/^\[DTO\]\s+(\w+)\s*:\s*(.+)$/);
      if (dto) { inv.dtos.push({ name: dto[1], fields: dto[2].split(",").map((x) => x.trim()) }); continue; }
      const req = t.match(/^\[REQ\]\s+([\w.]+)\s*\(([^)]*)\)\s*:\s*(\w+)/);
      if (req) { flush(); cur = { name: req[1], input: req[2].trim(), output: req[3], steps: [] }; continue; }
      // a step belongs to the current REQ if it is indented (original line started with spaces)
      if (cur && /^\s+/.test(line) && !/^\[/.test(t)) cur.steps.push(classify(line));
    }
    flush();
  }

  // entities that are written but never declared [NON] — still real storage targets
  const declared = new Set(inv.entities);
  for (const w of inv.writes) if (!declared.has(w.noun) && !inv.entities.includes(w.noun)) {
    inv.notes.push(`'${w.noun}' is persisted (${w.service}:${w.noun}.${w.verb}) but has no [NON] declaration — confirm it is an entity.`);
  }
  if (!inv.mutationCandidates.length) inv.notes.push("No load->mutate->save flows found; writes may already be append-friendly (verify fresh-id saves).");

  console.log(JSON.stringify(inv, null, 2));
}

if (import.meta.main) await main();
