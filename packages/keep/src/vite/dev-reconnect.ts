// Dev-only HMR helper for Fresh + Vite apps.
//
// `devReconnect()` injects a tiny client snippet that recovers a stale tab when
// the dev server comes back. Vite's HMR client reloads on a clean restart, but
// if the server is down a while, or the HMR WebSocket goes half-open (e.g.
// Safari throttling a backgrounded tab), the tab can stay stale forever — you
// reload and "nothing changed", or a new tab shows it. On disconnect this polls
// the server and reloads the moment it answers again.
//
// The plugin runs at build time (Vite config), NOT in the browser; it *injects*
// a virtual module into the client entry so the snippet ships with the code and
// projects don't have to paste it into client.ts. `apply: "serve"` keeps it out
// of production builds entirely.
//
// NOTE: the recovery is a `location.reload()`. On Safari, a full reload can
// serve island ES-modules from cache (stale) — so if you edited an *island*
// during the outage, the recovered tab may show it stale until the next HMR
// patch. For the common "I restarted the server" case it's fine.

const VIRTUAL = "virtual:keep/dev-reconnect";
const RESOLVED = "\0" + VIRTUAL;

const CLIENT_SNIPPET = `
if (import.meta.hot) {
  let recovering = false;
  import.meta.hot.on("vite:ws:disconnect", () => {
    if (recovering) return;
    recovering = true;
    const t = setInterval(async () => {
      try {
        await fetch("/", { cache: "no-store" });
        clearInterval(t);
        location.reload();
      } catch {
        /* still down — keep polling */
      }
    }, 1000);
  });
}
`;

export interface DevReconnectOptions {
  /**
   * Substring identifying the client entry module to inject into.
   * Defaults to "/client.ts" (the Fresh convention).
   */
  clientEntry?: string;
}

/** Vite plugin: ship the dev reconnect-recovery snippet with the client bundle. */
export function devReconnect(opts: DevReconnectOptions = {}) {
  const clientEntry = opts.clientEntry ?? "/client.ts";
  return {
    name: "keep:dev-reconnect",
    apply: "serve" as const, // dev only — never in the production build
    resolveId(id: string) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id: string) {
      if (id === RESOLVED) return CLIENT_SNIPPET;
    },
    transform(code: string, id: string) {
      const clean = id.split("?")[0];
      if (clean.endsWith(clientEntry) && !code.includes(VIRTUAL)) {
        return { code: `import ${JSON.stringify(VIRTUAL)};\n${code}`, map: null };
      }
    },
  };
}
