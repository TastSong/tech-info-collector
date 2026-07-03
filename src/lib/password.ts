import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

const KEY_LEN = 64;
const SALT_LEN = 32;

// Auth token payload
interface TokenPayload {
  u: number; // userId
  n: string; // username
  i: number; // issued at (unix seconds)
}

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret-change-me";
}

/** Create a self-signed HMAC token encoding userId + username. */
export function createSignedToken(userId: number, username: string): string {
  const payload: TokenPayload = { u: userId, n: username, i: Math.floor(Date.now() / 1000) };
  const json = JSON.stringify(payload);
  const payloadB64 = Buffer.from(json).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed token and return the payload, or null if invalid.
 * Does NOT check token age — tokens are valid until logged out (maxAge cookie handles expiry).
 */
export function verifySignedToken(token: string): TokenPayload | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expected = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as TokenPayload;
  } catch {
    return null;
  }
}

/** Hash a plain password. Returns `salt:hash` (both hex-encoded). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const hash = scryptSync(plain, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

/** Verify a plain password against a `salt:hash` string. */
export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(plain, salt, KEY_LEN);
  const storedBuf = Buffer.from(hash, "hex");
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}
