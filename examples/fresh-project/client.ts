// Import CSS files here for hot module reloading to work.
import "./assets/styles.css";

// --- Keep token auto-injection (browser) ----------------------------------------------------
// Seeds a token once from `?token=`, persists it in localStorage, and attaches it as
// `Authorization: Bearer` on same-origin `/api/*` calls only (every other fetch passes straight
// through, unwrapped); drops it on a 401. Idempotent across HMR. To opt out, skip the patch line
// at the bottom and call `apiFetch` explicitly.
//
// Tradeoff: localStorage persistence means any XSS on this origin can read the token. An
// httpOnly cookie avoids that, but JS can't read it to set the header; this demo favors the
// header flow. For higher-risk apps prefer short-lived tokens and/or an httpOnly-cookie scheme.
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
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Resolve the URL WITHOUT reconstructing the request — for non-/api calls we hand `input`/`init`
  // straight to native fetch, so streaming/duplex bodies and exotic init combos are never mangled.
  const url = input instanceof Request
    ? input.url
    : input instanceof URL
    ? input.href
    : String(input);
  if (!sameOriginApi(url)) return nativeFetch(input, init);

  const req = new Request(input, init);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !req.headers.has("authorization")) {
    req.headers.set("authorization", `Bearer ${token}`);
  }
  const res = await nativeFetch(req);
  if (token && res.status === 401) localStorage.removeItem(TOKEN_KEY);
  return res;
}

// Patch the global fetch (idempotent — always re-points to the current apiFetch over native).
globalThis.fetch = apiFetch;
