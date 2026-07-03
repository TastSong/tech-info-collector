import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const SALT_LEN = 32;

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

/** Generate a random auth token (64 hex chars = 256 bits). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}
