/**
 * Constants and small helpers shared by the server, the page and scripts/checker.ts.
 * No imports on purpose: the browser bundle and plain `node` can both load this file.
 */

/** Market name -> Yahoo ticker (same three markets as the engine's MARKETS). */
export const MARKET_TICKERS: Record<string, string> = { "Nifty 50": "^NSEI", Sensex: "^BSESN", "Crude oil (Brent)": "BZ=F" };
export const MARKET_NAMES = Object.keys(MARKET_TICKERS);
/** Plan name -> trading sessions held (same as the engine's HORIZONS). */
export const PLANS = ["1 day", "1 week", "1 month"];

/** Check timer (core.INTERVALS). */
export const INTERVALS: Record<string, number> = { "1 min": 60, "5 min": 300, "1 hour": 3600, "3 hours": 10800 };
export const DEFAULT_INTERVAL = "5 min";
export const intervalName = (name: unknown): string =>
  typeof name === "string" && name in INTERVALS ? name : DEFAULT_INTERVAL;

/** Store keys. */
export const KEYS = {
  holdings: "holdings",
  settings: "settings",
  alerts: "alerts",
  status: "status",
  heartbeat: "heartbeat",
  /** Phone web-push subscriptions (src/lib/server/push.ts). */
  push: "push",
} as const;

export interface Settings { interval: string }

/** One alert, as core.check_alerts saves it, plus a timestamp and an id. */
export interface Alert {
  id: string;
  /** Epoch ms. */
  ts: number;
  /** "16 Oct 2026 07:36 PM" (IST). */
  time: string;
  market: string;
  horizon: string;
  advice: string;
  why: string;
}

/** The checker's live state (notifier.report). */
export interface CheckStatus {
  state: "checking" | "idle";
  step: string;
  done: number;
  total: number;
  started: number;
  finished?: number;
  /** Seconds. */
  duration?: number;
  alerts?: number;
  error?: string | null;
  log: string[];
}

/** Written by scripts/checker.ts every few seconds, and by every check. Times in epoch ms. */
export interface Heartbeat { at: number; next: number | null; interval: number; by: "runner" | "check" }

const IST_MS = 330 * 60_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** India wall clock for an epoch-ms time, read with getUTC*. */
const ist = (ms: number) => new Date(ms + IST_MS);

/** "YYYY-MM-DD" in India. */
export const istDay = (ms: number): string => ist(ms).toISOString().slice(0, 10);

/** "07:36 PM" or with seconds "07:36:05 PM" (IST). */
export function istTime(ms: number, seconds = false): string {
  const d = ist(ms);
  const h = d.getUTCHours();
  return `${two(h % 12 || 12)}:${two(d.getUTCMinutes())}${seconds ? `:${two(d.getUTCSeconds())}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** "16 Oct 2026 07:36 PM" (IST), the Python alert format. */
export function istDateTime(ms: number): string {
  const d = ist(ms);
  return `${two(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${istTime(ms)}`;
}

/** "16 Oct" from "2026-10-16". */
export const shortDay = (day: string): string => `${day.slice(8, 10)} ${MON[Number(day.slice(5, 7)) - 1]}`;

/** GET /api/status. */
export interface StatusResponse {
  now: number;
  interval: string;
  status: CheckStatus | null;
  heartbeat: Heartbeat | null;
  alerts: Alert[];
}
