import { assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext, LspContext, LspCapabilities } from "@core/dto/types.ts";

const nullLspCtx: PipelineContext = {
  targetDir: "/tmp",
  files: [],
  dirs: [],
  getFileContent: async () => "",
  getImports: async () => [],
  lsp: null,
};

function mockLsp(
  exportsByDir: Record<string, Array<{ name: string; kind: string; type: string }>>,
  typesBySymbol: Record<string, string> = {},
): LspContext {
  return {
    capabilities: {
      documentSymbol: true, hover: true, references: true,
      implementation: true, definition: true, diagnostics: false,
    } as LspCapabilities,
    getExportTypes: async (relPath: string) => {
      const dir = relPath.split("/").slice(-2, -1)[0];
      return exportsByDir[dir] ?? [];
    },
    getSiblingExportSignatures: async (_businessDir, featureDirs) => {
      const result = new Map();
      for (const dir of featureDirs) {
        result.set(dir, exportsByDir[dir] ?? []);
      }
      return result;
    },
    getSymbolType: async (_relPath, symbolName) => typesBySymbol[symbolName] ?? null,
    findSymbolReferences: async () => [],
    findSymbolImplementations: async () => [],
    findSymbolDefinition: async () => [],
    getDiagnostics: async () => [],
  };
}

Deno.test("check — skips non-folder targets", async () => {
  const result = await check("src/orders/domain/business", "ts", nullLspCtx);
  assertEquals(result, null);
});

Deno.test("check — skips non-business directories", async () => {
  const result = await check("src/orders/domain/data", "folder", nullLspCtx);
  assertEquals(result, null);
});

Deno.test("check — returns null when lsp is null", async () => {
  const ctx: PipelineContext = {
    ...nullLspCtx,
    dirs: [
      "src/orders/domain/business/feat-a",
      "src/orders/domain/business/feat-b",
      "src/orders/domain/business/feat-c",
    ],
  };
  const result = await check("src/orders/domain/business", "folder", ctx);
  assertEquals(result, null);
});

Deno.test("check — returns null with fewer than 3 siblings", async () => {
  const ctx: PipelineContext = {
    ...nullLspCtx,
    dirs: [
      "src/orders/domain/business/feat-a",
      "src/orders/domain/business/feat-b",
    ],
    lsp: mockLsp({}),
  };
  const result = await check("src/orders/domain/business", "folder", ctx);
  assertEquals(result, null);
});

Deno.test("check — flags 3+ siblings with same exports and compatible types", async () => {
  const sharedExports = [
    { name: "check", kind: "Function", type: "unknown" },
    { name: "buildPrompt", kind: "Function", type: "unknown" },
  ];
  const ctx: PipelineContext = {
    ...nullLspCtx,
    dirs: [
      "src/orders/domain/business/feat-a",
      "src/orders/domain/business/feat-b",
      "src/orders/domain/business/feat-c",
    ],
    lsp: mockLsp(
      { "feat-a": sharedExports, "feat-b": sharedExports, "feat-c": sharedExports },
      { check: "(path: string) => Promise<string[] | null>", buildPrompt: "(v: string[]) => string" },
    ),
  };
  const result = await check("src/orders/domain/business", "folder", ctx);
  assertEquals(result !== null, true);
  assertEquals(result![0].includes("poly structure"), true);
});

Deno.test("check — does not flag when exports differ across siblings", async () => {
  const ctx: PipelineContext = {
    ...nullLspCtx,
    dirs: [
      "src/orders/domain/business/feat-a",
      "src/orders/domain/business/feat-b",
      "src/orders/domain/business/feat-c",
    ],
    lsp: mockLsp({
      "feat-a": [{ name: "check", kind: "Function", type: "" }],
      "feat-b": [{ name: "validate", kind: "Function", type: "" }],
      "feat-c": [{ name: "process", kind: "Function", type: "" }],
    }),
  };
  const result = await check("src/orders/domain/business", "folder", ctx);
  assertEquals(result, null);
});
