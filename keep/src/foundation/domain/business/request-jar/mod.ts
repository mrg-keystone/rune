// The REQUEST-BOUND in-process client: exactly `fetch` minus the HTTP hop.
// A fresh, attribute-aware cookie jar is minted per incoming request (THE
// CARDINAL INVARIANT — the jar dies with the request; the raw scope-less
// client carries no jar at all, so a singleton capture has nothing to leak),
// the incoming request's own cookies ride every call, `Set-Cookie` from
// in-process responses is honored bidirectionally (later same-scope calls
// carry it; the composing layer collects it onto the outer browser response),
// and every URL observable reports the deployment's WIRE URL — origin + the
// layer's mount + the route path — byte-identical to a browser island's call.

import type { FetchHandler } from "@types";

interface JarCookie {
  name: string;
  value: string;
  /** Attributes: absent on cookies seeded from the incoming Cookie header
   *  (the browser sends bare pairs), parsed from Set-Cookie otherwise. */
  path?: string;
  domain?: string;
  secure?: boolean;
  expires?: number; // epoch ms; undefined = session
}

function parseSetCookie(line: string): JarCookie | null {
  const parts = line.split(";");
  const eq = parts[0].indexOf("=");
  if (eq <= 0) return null;
  const cookie: JarCookie = {
    name: parts[0].slice(0, eq).trim(),
    value: parts[0].slice(eq + 1).trim(),
  };
  for (const raw of parts.slice(1)) {
    const [k, ...rest] = raw.trim().split("=");
    const v = rest.join("=");
    switch (k.toLowerCase()) {
      case "path":
        cookie.path = v || "/";
        break;
      case "domain":
        cookie.domain = v.replace(/^\./, "").toLowerCase();
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "max-age": {
        const secs = Number(v);
        if (Number.isFinite(secs)) cookie.expires = Date.now() + secs * 1000;
        break;
      }
      case "expires": {
        // Max-Age wins over Expires (RFC 6265) — only use when unset.
        if (cookie.expires === undefined) {
          const t = Date.parse(v);
          if (Number.isFinite(t)) cookie.expires = t;
        }
        break;
      }
    }
  }
  return cookie;
}

function pathMatches(cookiePath: string | undefined, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true;
  return requestPath === cookiePath ||
    requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : cookiePath + "/");
}

function domainMatches(cookieDomain: string | undefined, host: string): boolean {
  if (!cookieDomain) return true; // host-only default for seeded cookies
  const h = host.toLowerCase();
  return h === cookieDomain || h.endsWith("." + cookieDomain);
}

/**
 * The per-request cookie jar — attribute-aware, faithful to the browser: it
 * matches Path/Domain/Secure (and never sends an expired cookie) when choosing
 * which cookies ride a later same-scope call, and forwards every `Set-Cookie`
 * VERBATIM onto the outer response, never stripping HttpOnly/Secure/Path.
 * Concurrency behaves like the browser's own jar under concurrent page
 * fetches: each call reads jar state at dispatch and applies its Set-Cookie
 * on receipt; last write wins per cookie name.
 */
export class RequestJar {
  private cookies = new Map<string, JarCookie>();
  /** Every Set-Cookie line seen this scope, verbatim, for the outer response. */
  readonly collected: string[] = [];

  constructor(cookieHeader?: string | null) {
    for (const pair of (cookieHeader ?? "").split(";")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      if (name) this.cookies.set(name, { name, value: pair.slice(eq + 1).trim() });
    }
  }

  /** The Cookie header for a call to `url` right now, or null when none apply. */
  headerFor(url: URL): string | null {
    const now = Date.now();
    const parts: string[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires !== undefined && c.expires <= now) continue;
      if (c.secure && url.protocol !== "https:") continue;
      if (!domainMatches(c.domain, url.hostname)) continue;
      if (!pathMatches(c.path, url.pathname)) continue;
      parts.push(`${c.name}=${c.value}`);
    }
    return parts.length ? parts.join("; ") : null;
  }

  /** Apply a response's Set-Cookie headers: update the jar (an expired/cleared
   *  cookie is removed) and record each line verbatim for the outer response. */
  apply(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      this.collected.push(line);
      const cookie = parseSetCookie(line);
      if (!cookie) continue;
      if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie);
      }
    }
  }
}

/** Wrap `res` so `url` reports the wire URL (Response.url is an internal slot
 *  the constructor can't set; a same-prototype proxy reports it faithfully). */
function withWireUrl(res: Response, wireUrl: string): Response {
  return new Proxy(res, {
    get(target, prop, receiver) {
      if (prop === "url") return wireUrl;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Response;
}

export interface RequestBoundClient {
  fetch: typeof fetch;
  /** The jar backing this client — the composing layer reads `collected` off
   *  it to forward Set-Cookie onto the outer browser response. */
  jar: RequestJar;
}

/**
 * Mint the request-bound client `Backend` provisions into the frontend for ONE
 * incoming request. `origin` is the deployment origin (from the incoming
 * request), `mount` the layer's mount (`/api`).
 *
 * URL semantics (exactly fetch):
 * - a route-space path (`/users`) mounts ONCE → wire URL `origin/api/users`,
 *   dispatched in-process;
 * - a same-origin absolute URL carrying the mount (`https://host/api/users`)
 *   dispatches in-process through the mount — island code ports to SSR
 *   verbatim;
 * - any other absolute URL is a real network fetch (what a page's fetch does).
 *
 * Cookie semantics: the jar rides per the browser model; an explicit `Cookie`
 * in init REPLACES the jar's for that call (fetch's replace-never-merge rule);
 * `credentials: "omit"` suppresses both sending and applying.
 */
export function requestBoundClient(
  inner: FetchHandler,
  incomingReq: Request,
  mount = "/api",
): RequestBoundClient {
  const jar = new RequestJar(incomingReq.headers.get("cookie"));
  const origin = new URL(incomingReq.url).origin;
  const base = `/${mount.replace(/^\/+|\/+$/g, "")}`;

  const clientFetch: typeof fetch = async (input, init) => {
    // Resolve the caller's input to a wire URL + a route-space dispatch path.
    let given: URL;
    let req: Request | null = null;
    if (input instanceof Request) {
      req = init ? new Request(input, init) : input;
      given = new URL(req.url);
    } else {
      given = new URL(String(input), origin + base + "/");
    }
    if (given.origin !== origin) {
      // Cross-origin: a real network call, exactly like a page's fetch.
      return await fetch(input as URL | RequestInfo, init);
    }
    let routePath: string;
    if (given.pathname === base || given.pathname.startsWith(base + "/")) {
      routePath = given.pathname.slice(base.length) || "/";
    } else {
      // A route-space path given as absolute-at-origin (no mount): mount once.
      routePath = given.pathname;
    }
    const wireUrl = origin + base + (routePath === "/" ? "/" : routePath) +
      given.search;
    const dispatchUrl = origin + routePath + given.search;

    const headers = new Headers(req ? req.headers : init?.headers);
    const credentials = (init?.credentials ?? (req?.credentials)) ?? "same-origin";
    const applyJar = credentials !== "omit";
    if (!headers.has("cookie") && applyJar) {
      const cookie = jar.headerFor(new URL(wireUrl));
      if (cookie !== null) headers.set("cookie", cookie);
    }
    if (!applyJar && !((req ? req.headers : new Headers(init?.headers)).has("cookie"))) {
      headers.delete("cookie");
    }

    const dispatch = new Request(dispatchUrl, {
      method: req?.method ?? init?.method ?? "GET",
      headers,
      body: req ? req.body : init?.body,
      redirect: req?.redirect ?? init?.redirect,
      // deno-lint-ignore no-explicit-any
      ...(req?.body || init?.body ? { duplex: "half" } as any : {}),
    });
    const res = await inner(dispatch);
    if (applyJar) jar.apply(res);
    return withWireUrl(res, wireUrl);
  };

  return { fetch: clientFetch, jar };
}

/** Append a jar's collected Set-Cookie lines onto the outer response — the
 *  composing layer's half of the bidirectional Set-Cookie contract. Verbatim,
 *  attributes intact. No-ops when nothing was collected. */
export function collectSetCookies(res: Response, jar: RequestJar): Response {
  if (jar.collected.length === 0) return res;
  const headers = new Headers(res.headers);
  for (const line of jar.collected) headers.append("set-cookie", line);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
