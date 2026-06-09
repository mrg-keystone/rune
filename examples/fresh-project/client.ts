// Import CSS files here for hot module reloading to work.
import "./assets/styles.css";

// --- Danet token auto-injection (browser) ---------------------------------------------------
// Seeds a token once from `?token=`, keeps it in localStorage, and attaches it as
// `Authorization: Bearer <token>` on requests — dropping it when one comes back 401.
//
// Blast radius: this wraps the GLOBAL `fetch`, but it only *touches* same-origin `/api/*`
// requests — every other fetch (Fresh's own, cross-origin, assets) passes straight through
// untouched. The wrap is idempotent across HMR. If you'd rather not patch the global at all,
// don't run the patch line below and call the exported `apiFetch` explicitly instead.
const TOKEN_KEY = "danet:token";

const sameOriginApi = (url: string): boolean => {
  try {
    const u = new URL(url, location.origin);
    return u.origin === location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
};

// Seed from the URL once, then strip it so the token doesn't linger in history / the address bar.
const here = new URL(location.href);
const seeded = here.searchParams.get("token");
if (seeded) {
  localStorage.setItem(TOKEN_KEY, seeded);
  here.searchParams.delete("token");
  history.replaceState(history.state, "", here.toString());
}

// Capture the REAL fetch once — HMR re-runs this module, so never wrap a previous wrapper.
const store = globalThis as unknown as { __danetNativeFetch?: typeof fetch };
store.__danetNativeFetch ??= globalThis.fetch.bind(globalThis);
const nativeFetch = store.__danetNativeFetch;

/** A `fetch` that injects the stored token on same-origin `/api/*` calls and clears it on 401. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const token = localStorage.getItem(TOKEN_KEY);
  const api = sameOriginApi(req.url);
  if (token && api && !req.headers.has("authorization")) {
    req.headers.set("authorization", `Bearer ${token}`);
  }
  const res = await nativeFetch(req);
  if (token && api && res.status === 401) localStorage.removeItem(TOKEN_KEY);
  return res;
}

// Patch the global fetch (idempotent — always re-points to the current apiFetch over native).
globalThis.fetch = apiFetch;
