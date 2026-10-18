/**
 * Signal engine (TypeScript port of core.py + engine/ + book_rules.py), no dependencies.
 *
 * How it decides:
 * - Signals come from the old bot's strategies (botRules.ts) and the book rules (bookRules.ts).
 * - For each market and time frame, a strategy is used only if it beat simply buying the market
 *   over 2010–today (at least 20 trades) AND over 2019–today alone (the luck check) — see picker.ts.
 * - A signal is decided on the daily close; the tested entry is the next session's open.
 */
import { botSignals } from "./botRules.ts";
import { bookSignals } from "./bookRules.ts";
import { rollingMean, rollingMin, shift } from "./indicators.ts";
import { KEYS } from "./names.ts";
import type { Bars, Flags, Prep } from "./types.ts";

/** core.prepare: every strategy's buy signal, the volume filter and the 20-day-low exit level. */
export function prepare(bars: Bars): Prep {
  const all = { ...botSignals(bars), ...bookSignals(bars) };
  const signals: Record<string, Flags> = {};
  for (const k of KEYS) signals[k] = all[k];
  const v = bars.volume;
  const vAvg = rollingMean(shift(v), 30);
  return {
    ...bars,
    signals,
    volOk: v.map((x, i) => x > 0 && x > vAvg[i]), // Bulkowski: volume above its 1-month average
    low20: rollingMin(shift(bars.low), 20), // lowest low of the prior 20 days (exit level)
  };
}

export { approved, beats, fixedHold, holdLow20, pickFilterAndExit, searchsorted, stats } from "./picker.ts";
export { advise, dataProblem, describe, marketOpen, stopHit } from "./advise.ts";
export { botSignals, trendBreakout } from "./botRules.ts";
export { bookSignals } from "./bookRules.ts";
export * from "./names.ts";
export type * from "./types.ts";
