// App bootstrap (dev-owned): created once by rune sync, never overwritten —
// tune the app name, port, or keep options freely. The module registry
// (bootstrap/modules.ts) is regenerated as runes are added and removed.

import { bootstrapServer } from "@mrg-keystone/keep";
import { config } from "@/bootstrap/config.ts";
import { modules } from "@/bootstrap/modules.ts";

export const api = await bootstrapServer("agent-a976ca4e071053a7f", modules, { port: config.port });

if (import.meta.main) {
  await api.listen();
  console.log(
    `agent-a976ca4e071053a7f on http://localhost:${config.port} — emulator at /docs/<module>`,
  );
}
