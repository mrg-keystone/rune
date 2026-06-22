import "reflect-metadata";
import { bootstrapServer } from "@mrg-keystone/keep";
import { httpModule } from "./src/cake/entrypoints/http/mod.ts";

// One module per rune; keep serves the process emulator at /docs/cake.
export const api = await bootstrapServer("cake", httpModule, { port: 8722 });

if (import.meta.main) {
  await api.listen();
  console.log("🍰 cake app on http://localhost:8722 — emulator at /docs/cake");
}
