import { define } from "../../utils.ts";

// Filesystem-validation bridge: scan a real project directory and return its
// source files (+ any .rune spec) so the generated-target rules can run over
// real on-disk code, not just the studio's rendered output.

// CWD is the studio dir; rune repo root is ../.. (survives bundling)
const REPO = `${Deno.cwd()}/..`;
const SKIP = new Set([
  "node_modules",
  "_fresh",
  ".git",
  "target",
  "dist",
  ".deno",
  ".playwright-mcp",
  ".claude",
  "vendor",
]);
const SRC = /\.(ts|tsx|js|jsx)$/;

export const handler = define.handlers({
  async POST(ctx) {
    const { dir } = await ctx.req.json().catch(() => ({ dir: "." }));
    const root = (dir && String(dir).startsWith("/"))
      ? String(dir)
      : `${REPO}/${dir || "."}`;
    const files: { path: string; content: string }[] = [];
    const runeTexts: string[] = [];
    let count = 0;

    async function walk(d: string, prefix: string) {
      let entries: AsyncIterable<Deno.DirEntry>;
      try {
        entries = Deno.readDir(d);
      } catch {
        return;
      }
      for await (const e of entries) {
        if (count > 3000) return;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory) {
          if (SKIP.has(e.name)) continue;
          await walk(`${d}/${e.name}`, rel);
        } else if (e.name.endsWith(".rune")) {
          try {
            runeTexts.push(await Deno.readTextFile(`${d}/${e.name}`));
          } catch { /* skip */ }
        } else if (SRC.test(e.name)) {
          try {
            const info = await Deno.stat(`${d}/${e.name}`);
            if (info.size > 250_000) continue;
            files.push({
              path: rel,
              content: await Deno.readTextFile(`${d}/${e.name}`),
            });
            count++;
          } catch { /* skip */ }
        }
      }
    }

    try {
      await Deno.stat(root.replace(/\/$/, ""));
    } catch {
      return Response.json({ error: `directory not found: ${root}` }, {
        status: 404,
      });
    }
    await walk(root.replace(/\/$/, ""), "");
    files.sort((a, b) => a.path.localeCompare(b.path));
    return Response.json({
      root,
      fileCount: files.length,
      files,
      runeText: runeTexts.join("\n\n\n"),
    });
  },
});
