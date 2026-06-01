/**
 * Signed access tokens. A token binds an `expiry` and `appName` (plus `source`) under an
 * HMAC-SHA256 signature keyed by the app's secret signing key (an env variable), so neither
 * the claims nor the expiry can be altered without invalidating the signature.
 *
 * The wire format is a compact JWT (`base64url(header).base64url(payload).base64url(sig)`,
 * `alg: HS256`), so the tokens interoperate with standard JWT tooling.
 */

/** The claims carried by a token. `expiry` is a Unix epoch in SECONDS. */
export interface TokenPayload {
  /** Who the token was minted for — used for log attribution on the receiving app. */
  source: string;
  /** Unix epoch (seconds) after which the token is rejected. */
  expiry: number;
  /** The app the token grants access to. */
  appName: string;
}

/** Thrown by `verifyToken` when a token is malformed, mis-signed, or expired. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const encoder = new TextEncoder();

/** Signs `payload` with `key` (the secret signing key) and returns a compact JWT. */
export async function signToken(payload: TokenPayload, key: string): Promise<string> {
  assertKey(key);
  assertPayload(payload);

  const signingInput = `${encodeSegment(HEADER)}.${encodeSegment(toClaims(payload))}`;
  const signature = await hmac(signingInput, key);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies a token's signature against `key` and checks it has not expired (`expiry > now`,
 * where `now` is a Unix epoch in seconds, defaulting to the current time). Returns the
 * decoded payload, or throws `TokenError`.
 */
export async function verifyToken(
  token: string,
  key: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<TokenPayload> {
  assertKey(key);

  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("Malformed token: expected three segments.");
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  const expected = await hmac(`${headerSeg}.${payloadSeg}`, key);
  const provided = base64UrlDecode(signatureSeg);
  if (!timingSafeEqual(expected, provided)) {
    throw new TokenError("Invalid signature.");
  }

  const claims = decodeSegment(payloadSeg);
  const payload = fromClaims(claims);
  if (payload.expiry <= now) throw new TokenError("Token expired.");
  return payload;
}

function toClaims(p: TokenPayload): Record<string, unknown> {
  return { source: p.source, appName: p.appName, exp: p.expiry };
}

function fromClaims(claims: Record<string, unknown>): TokenPayload {
  const { source, appName, exp } = claims;
  if (typeof source !== "string" || typeof appName !== "string" || typeof exp !== "number") {
    throw new TokenError("Malformed token: missing or invalid claims.");
  }
  return { source, appName, expiry: exp };
}

function assertKey(key: string) {
  if (!key) throw new TokenError("A signing key is required.");
}

function assertPayload(p: TokenPayload) {
  if (!p.source) throw new TokenError("`source` is required.");
  if (!p.appName) throw new TokenError("`appName` is required.");
  if (!Number.isInteger(p.expiry)) throw new TokenError("`expiry` must be a Unix epoch in seconds.");
}

async function hmac(data: string, key: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

/** Constant-time comparison so signature checks don't leak timing information. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function encodeSegment(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const json = new TextDecoder().decode(base64UrlDecode(segment));
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") {
      throw new TokenError("Malformed token: payload is not an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof TokenError) throw err;
    throw new TokenError("Malformed token: undecodable payload.");
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(segment.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
