/**
 * PIN on first visit, then the device is remembered.
 * - The PIN is checked on the server (env APP_PIN, never sent to the browser).
 * - A correct PIN gives the device a signed cookie (HMAC with env AUTH_SECRET). The guard (src/proxy.ts) renews it
 *   on every visit, so a device that opens the site at least once every 400 days (the browser's cookie limit) is
 *   never asked again.
 * - The scheduler calls /api/check with header x-check-secret = env CHECK_SECRET instead of a cookie.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE = "advisor_device";
export const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // seconds: the longest browsers keep a cookie

const secret = (): string => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or too short (set it in .env.local / the host's settings)");
  return s;
};
const sign = (id: string) => createHmac("sha256", secret()).update(id).digest("base64url");

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** A new device token: random id + its signature. */
export const newDeviceToken = (): string => {
  const id = randomBytes(16).toString("base64url");
  return `${id}.${sign(id)}`;
};

/** True when the cookie value was issued by this server. */
export function validDeviceToken(token: string | undefined): boolean {
  if (!token) return false;
  const [id, sig] = token.split(".");
  return Boolean(id && sig) && same(sig, sign(id));
}

/** True when the PIN matches env APP_PIN (compared on hashes, in constant time). */
export function pinMatches(pin: string): boolean {
  const want = process.env.APP_PIN;
  if (!want) throw new Error("APP_PIN is not set");
  const h = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");
  return same(h(pin), h(want));
}

/** The scheduler's header check for /api/check. */
export function validCheckSecret(value: string | null): boolean {
  const want = process.env.CHECK_SECRET;
  return Boolean(want && value) && same(value!, want!);
}

export const cookieOptions = (secure: boolean) => ({
  httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: COOKIE_MAX_AGE,
});

// ---- slow down guessing: 5 wrong PINs from one address → locked for 15 minutes (per server instance) ----
const tries = new Map<string, { wrong: number; until: number }>();
const MAX_WRONG = 5, LOCK_MS = 15 * 60 * 1000;

/** Milliseconds this address must still wait (0 = may try). */
export function lockedFor(ip: string): number {
  const t = tries.get(ip);
  return t && t.until > Date.now() ? t.until - Date.now() : 0;
}

export function recordAttempt(ip: string, ok: boolean): void {
  if (ok) { tries.delete(ip); return; }
  const t = tries.get(ip) ?? { wrong: 0, until: 0 };
  t.wrong += 1;
  if (t.wrong >= MAX_WRONG) { t.until = Date.now() + LOCK_MS; t.wrong = 0; }
  tries.set(ip, t);
}
