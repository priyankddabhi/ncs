/**
 * Chart/candle patterns (the book rules) on daily, weekly and monthly bars.
 * Daily patterns are part of the tested rule set; weekly/monthly ones are informational only ("not tested":
 * too few bars to test them with the 20/8-trade rule).
 */
import { bookSignals, LABELS } from "./bookRules.ts";
import type { Resampled } from "./resample.ts";
import type { Prep } from "./types.ts";

export const PATTERN_KEYS = [
  "book_engulfing", "book_hammer", "book_morning_star", "book_key_reversal", "book_bull_flag", "book_pipe",
  "book_valleys", "book_double_bottom", "book_rectangle",
];

export interface PatternHit { key: string; name: string }

/** Patterns firing on the last completed week/month (the bar before the one containing the last day). */
export function lastDonePatterns(r: Resampled): { date: string | null; hits: PatternHit[] } {
  const k = r.lastDone[r.lastDone.length - 1];
  if (k === undefined || k < 0) return { date: null, hits: [] };
  const s = bookSignals(r.bars);
  return { date: r.bars.dates[k], hits: PATTERN_KEYS.filter((p) => s[p][k]).map((p) => ({ key: p, name: LABELS[p] })) };
}

/** Patterns firing on the last daily bar (signals already computed by prepare). */
export function dailyPatterns(prep: Prep): PatternHit[] {
  const last = prep.close.length - 1;
  return PATTERN_KEYS.filter((p) => prep.signals[p]?.[last]).map((p) => ({ key: p, name: LABELS[p] }));
}
