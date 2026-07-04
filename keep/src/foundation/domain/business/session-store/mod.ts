/**
 * The server-side **session store** — the stateful half of the infra-only auth model. keep is, and
 * stays, a stateless verifier of infra-signed bearers; this store adds the one thing a stateless
 * verifier can't do: hold the **original credential** so a lapsed ~1h bearer can be re-minted
 * transparently, and let a request authenticate from a tiny **httpOnly cookie** instead of forcing
 * the bearer into client-readable storage.
 *
 * Shape (mirrors the sprig/keep companion design):
 *
 *   cookie:   sprig_session = <opaque session id>   (~36 bytes — never near the 4 KB cookie cap)
 *   store:    ["session", <id>] → SessionRecord     (idle TTL via expireIn — self-reaping, no sweeper)
 *
 * A `SessionRecord` keeps the ORIGINAL credential (an opaque infra token, or a Firebase idToken),
 * the current bearer, and the profile — so {@link resolveSession} can silently re-exchange the
 * opaque credential when the bearer nears expiry (one write) and continue with no 401, no re-login.
 * The opaque path survives unattended (kiosk/wallboard) sessions; a Firebase idToken is itself
 * ~1h-lived, so once it lapses that session must re-login — the bearer verification on the request
 * path enforces this either way.
 *
 * Two backends implement one {@link SessionStore} interface:
 *  - {@link createMemorySessionStore} — process-local Map with manual TTL; the default fallback,
 *    fine for a single-instance server and used by the tests.
 *  - {@link KvSessionStore} — Deno KV, using the same native per-key `expireIn` TTL as
 *    `tracer/kv-store.ts`, so idle sessions expire themselves across restarts / instances.
 *
 * Deno KV is an unstable API; like the tracer's KV sink we reach it through a minimal locally-typed
 * gate so the package stays type-checkable and publishable WITHOUT forcing `--unstable-kv`, and we
 * degrade to a disabled store (open returns null) when the flag is absent.
 */

import {
  decodeBearer,
  sessionExpiryOf,
} from "@foundation/domain/business/token/mod.ts";

/** How the ORIGINAL credential is re-exchanged: an opaque infra token, or a Firebase idToken. */
export type CredentialKind = "opaque" | "firebase";

/** The intake payload that mints a session. */
export interface NewSession {
  /** The ORIGINAL credential, kept for silent re-exchange (an opaque token or a Firebase idToken). */
  credential: string;
  credentialKind: CredentialKind;
  /** The current infra-signed session bearer (~1h). */
  bearer: string;
  /** Unix seconds the bearer lapses (from the bearer's `sessionExpiry`). */
  sessionExpiry: number;
  /** Firebase email, replayed on a `firebase` re-login. */
  email?: string;
  /** Cached profile for a `/auth/me`-style read (authoritative grants come from the verified bearer). */
  name?: string;
  grants?: string[];
  claims?: Record<string, string>;
}

/** A stored session — a {@link NewSession} plus its opaque id. */
export interface SessionRecord extends NewSession {
  id: string;
}

export interface SessionStore {
  /** Mint an opaque id, write the record with the idle TTL, and return the id. */
  create(input: NewSession): Promise<string>;
  /** Read a session by id, or `null` when absent/expired. Does NOT refresh — see {@link resolveSession}. */
  read(id: string): Promise<SessionRecord | null>;
  /** Overwrite a session (used by silent refresh); resets the idle TTL. */
  write(record: SessionRecord): Promise<void>;
  /** Delete a session (logout). */
  destroy(id: string): Promise<void>;
  /** True once the backing store is usable (a KV store returns false when KV won't open). */
  available(): Promise<boolean>;
  /** Release the backing handle. Long-lived servers never need this; tests do. */
  close(): Promise<void>;
}

const DEFAULT_IDLE_TTL_DAYS = 7;
/** Re-exchange when the bearer lapses within this many seconds. */
export const DEFAULT_REFRESH_SKEW_SECONDS = 120;

function idleTtlMs(days: number): number {
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface ResolveOptions {
  /**
   * Re-exchange the stored opaque credential for a fresh bearer (typically `infraClient.exchange`).
   * Omit to disable silent refresh (the record is returned as-is).
   */
  exchange?: (credential: string) => Promise<string>;
  /** Wall clock (Unix seconds). Default `Date.now()`. */
  now?: number;
  /** Refresh window; default {@link DEFAULT_REFRESH_SKEW_SECONDS}. */
  refreshSkewSeconds?: number;
}

/**
 * Read a session and, when its bearer is near expiry AND the credential is a re-exchangeable opaque
 * token, silently re-exchange it and persist the fresh bearer (bumping the idle TTL). Returns the
 * (possibly refreshed) record, or `null` when the session is gone. A failed re-exchange (infra
 * down, token revoked) is swallowed — the existing bearer is returned and the request-path
 * verification decides: if it has genuinely lapsed the caller gets a 401 and re-authenticates.
 */
export async function resolveSession(
  store: SessionStore,
  id: string,
  opts: ResolveOptions = {},
): Promise<SessionRecord | null> {
  const rec = await store.read(id);
  if (!rec) return null;
  const now = opts.now ?? nowSeconds();
  const skew = opts.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS;
  const nearExpiry = rec.sessionExpiry - now <= skew;
  if (nearExpiry && rec.credentialKind === "opaque" && opts.exchange) {
    try {
      const bearer = await opts.exchange(rec.credential);
      const refreshed: SessionRecord = {
        ...rec,
        bearer,
        sessionExpiry: sessionExpiryOf(bearer) ?? now + 3600,
      };
      await store.write(refreshed);
      return refreshed;
    } catch {
      // Silent refresh must never turn a live session into an error; fall through unchanged.
    }
  }
  return rec;
}

// ── Intake ───────────────────────────────────────────────────────────────────

/** The infra exchange surface {@link intakeSession} needs (a slice of `InfraClient`). */
export interface SessionExchange {
  exchange(token: string): Promise<string>;
  login(idToken: string, email?: string): Promise<string>;
}

/** What a caller presents at intake: an opaque infra token, or a Firebase idToken. */
export interface IntakeInput {
  credential: string;
  credentialKind: CredentialKind;
  /** Firebase email (passed to `session.login` and cached on the record). */
  email?: string;
}

/** The minted session id plus the decoded profile a gateway surfaces (e.g. via `/auth/me`). */
export interface IntakeResult {
  id: string;
  creator: string;
  email?: string;
  grants: string[];
  claims: Record<string, string>;
}

/**
 * Intake a credential into a session: exchange it at infra for a signed bearer, cache the ORIGINAL
 * credential + bearer + decoded profile, and return the opaque id a gateway drops into the httpOnly
 * `sprig_session` cookie. `appName` selects which app's grants to surface in the result (the same
 * per-app projection the guard uses). Throws whatever infra's exchange throws (an {@link
 * import("../infra-client/mod.ts").InfraError}) — the gateway maps it to a 4xx/5xx.
 */
export async function intakeSession(
  store: SessionStore,
  infra: SessionExchange,
  input: IntakeInput,
  appName: string,
): Promise<IntakeResult> {
  const bearer = input.credentialKind === "firebase"
    ? await infra.login(input.credential, input.email)
    : await infra.exchange(input.credential);
  const decoded = decodeBearer(bearer);
  const claims = decoded?.claims ?? {};
  const grants = (claims[appName] ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
  const email = input.email ??
    (decoded?.creator.includes("@") ? decoded.creator : undefined);
  const id = await store.create({
    credential: input.credential,
    credentialKind: input.credentialKind,
    bearer,
    sessionExpiry: decoded?.sessionExpiry ?? nowSeconds() + 3600,
    email,
    name: decoded?.creator,
    grants,
    claims,
  });
  return { id, creator: decoded?.creator ?? "", email, grants, claims };
}

// ── In-memory backend ────────────────────────────────────────────────────────

/**
 * A process-local {@link SessionStore}. Manual TTL: each entry carries an `expiresAt`, and a read
 * past it drops the entry and returns `null` — the same self-reaping contract as KV's `expireIn`,
 * without the unstable flag. Suitable for a single-instance server; the tests use it to exercise
 * the full create → resolve → refresh → destroy path with no `--unstable-kv`.
 */
export function createMemorySessionStore(
  ttlDays: number = DEFAULT_IDLE_TTL_DAYS,
): SessionStore {
  const ttl = idleTtlMs(ttlDays);
  const map = new Map<string, { record: SessionRecord; expiresAt: number }>();
  return {
    create(input: NewSession): Promise<string> {
      const id = crypto.randomUUID();
      const record: SessionRecord = { ...input, id };
      map.set(id, { record, expiresAt: Date.now() + ttl });
      return Promise.resolve(id);
    },
    read(id: string): Promise<SessionRecord | null> {
      const hit = map.get(id);
      if (!hit) return Promise.resolve(null);
      if (Date.now() > hit.expiresAt) {
        map.delete(id);
        return Promise.resolve(null);
      }
      return Promise.resolve(hit.record);
    },
    write(record: SessionRecord): Promise<void> {
      map.set(record.id, { record, expiresAt: Date.now() + ttl });
      return Promise.resolve();
    },
    destroy(id: string): Promise<void> {
      map.delete(id);
      return Promise.resolve();
    },
    available(): Promise<boolean> {
      return Promise.resolve(true);
    },
    close(): Promise<void> {
      map.clear();
      return Promise.resolve();
    },
  };
}

// ── Deno KV backend ──────────────────────────────────────────────────────────
// Minimal local typing of the slice of Deno KV we use — deliberately NOT the unstable Deno.Kv
// types, so `deno check` passes flag-free (mirrors tracer/kv-store.ts).
type KvKeyPart = string | number;
type KvKey = KvKeyPart[];
interface KvEntry {
  key: KvKey;
  value: unknown;
  versionstamp: string | null;
}
interface Kv {
  get(key: KvKey): Promise<KvEntry>;
  set(
    key: KvKey,
    value: unknown,
    opts?: { expireIn?: number },
  ): Promise<unknown>;
  delete(key: KvKey): Promise<void>;
  close(): void;
}
type OpenKv = (path?: string) => Promise<Kv>;

const PREFIX = "session";

let warnedOnce = false;
function warn(message: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(message);
}

/** The `Deno.openKv` function, or undefined when `--unstable-kv` isn't enabled. */
function openKvGate(): OpenKv | undefined {
  return (Deno as unknown as { openKv?: OpenKv }).openKv;
}

/**
 * A {@link SessionStore} backed by Deno KV. Opens lazily on first use and memoizes the handle; when
 * KV is unavailable it logs once and every operation degrades safely (writes drop, reads return
 * `null`) — the caller should fall back to {@link createMemorySessionStore} (see
 * {@link createKvSessionStore}).
 */
export class KvSessionStore implements SessionStore {
  private handle?: Promise<Kv | null>;
  private readonly ttlMs: number;

  constructor(
    private readonly path: string | undefined,
    ttlDays: number = DEFAULT_IDLE_TTL_DAYS,
  ) {
    this.ttlMs = idleTtlMs(ttlDays);
  }

  async available(): Promise<boolean> {
    return (await this.kv()) !== null;
  }

  private kv(): Promise<Kv | null> {
    if (!this.handle) this.handle = this.open();
    return this.handle;
  }

  private async open(): Promise<Kv | null> {
    const openKv = openKvGate();
    if (!openKv) {
      warn(
        "[keep] session KV requested but Deno KV is unavailable — run with --unstable-kv to persist sessions. Falling back to in-memory sessions.",
      );
      return null;
    }
    try {
      return await openKv(this.path);
    } catch (err) {
      warn(
        `[keep] could not open Deno KV for sessions (${
          err instanceof Error ? err.message : String(err)
        }). Falling back to in-memory sessions.`,
      );
      return null;
    }
  }

  async create(input: NewSession): Promise<string> {
    const id = crypto.randomUUID();
    await this.write({ ...input, id });
    return id;
  }

  async read(id: string): Promise<SessionRecord | null> {
    const kv = await this.kv();
    if (!kv) return null;
    try {
      const entry = await kv.get([PREFIX, id]);
      return entry.value ? entry.value as SessionRecord : null;
    } catch {
      return null;
    }
  }

  async write(record: SessionRecord): Promise<void> {
    const kv = await this.kv();
    if (!kv) return;
    try {
      await kv.set([PREFIX, record.id], record, { expireIn: this.ttlMs });
    } catch {
      // A write failure degrades to "no session"; the request path handles a missing session.
    }
  }

  async destroy(id: string): Promise<void> {
    const kv = await this.kv();
    if (!kv) return;
    try {
      await kv.delete([PREFIX, id]);
    } catch {
      // ignore
    }
  }

  async close(): Promise<void> {
    const kv = await this.kv().catch(() => null);
    try {
      kv?.close();
    } catch {
      // ignore
    }
    this.handle = Promise.resolve(null);
  }
}

/**
 * Build a KV-backed session store and confirm it actually opened. Returns the store when KV is
 * live, or `null` when it isn't (flag missing / open failed) — the caller then falls back to
 * {@link createMemorySessionStore}, so enabling persistence can never silently break auth.
 */
export async function createKvSessionStore(
  path: string | undefined,
  ttlDays?: number,
): Promise<KvSessionStore | null> {
  const store = new KvSessionStore(path, ttlDays ?? DEFAULT_IDLE_TTL_DAYS);
  return (await store.available()) ? store : null;
}
