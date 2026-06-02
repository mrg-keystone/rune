import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

// Dev only: force the open tab to reload on every change so edits to code AND
// the keywords.json data file always reflect without the new-tab dance.
const alwaysFullReload = {
  name: "always-full-reload",
  // deno-lint-ignore no-explicit-any
  handleHotUpdate({ server }: any) {
    server.ws.send({ type: "full-reload", path: "*" });
    return [];
  },
};

export default defineConfig({
  // Share the shape-checker engine (WO-5) — the same modules the CLI runs, so
  // the in-browser preview is byte-identical to engine output.
  resolve: {
    alias: {
      "@shape-checker": new URL("../../../src/shape-checker", import.meta.url).pathname,
      "@core": new URL("../../../src/core", import.meta.url).pathname,
    },
  },
  server: { headers: { "cache-control": "no-store" } },
  plugins: [fresh(), tailwindcss(), alwaysFullReload],
});
