/**
 * Take-profit at the predicted target (tested): during the hold, sell when the high reaches entry × (1 + median)
 * (at the target, or at the open if it gapped above), otherwise the plan's normal exit. Switched ON only if it beats
 * the plan's current exit since 2010 AND since 2019 (picker.beats).
 * NOTE: the median is taken from the full 2010–today trades, so this test is IN-SAMPLE (it has seen the 2019+ data).
 */
import { MIN_TRADES } from "./names.ts";
import { beats } from "./picker.ts";
import { distribution } from "./predict.ts";
import { bothStats, rets, simulate, type ExitRule } from "./trades.ts";
import type { Flags, Prep, Stats } from "./types.ts";

export interface TakeProfitChoice {
  on: boolean;
  /** Target as a fraction above the entry (full-period median of the plan's trades); NaN if no trades. */
  target: number;
  before: [Stats, Stats];
  /** With the take-profit (equal to `before` when it could not be tested). */
  after: [Stats, Stats];
  /** Why it was not tested, if so. */
  note: string | null;
}

export function pickTakeProfit(sig: Flags, prep: Prep, ex: ExitRule, start: number, recent: number): TakeProfitChoice {
  const before = bothStats(sig, prep, ex, start, recent);
  const d = distribution(rets(simulate(sig, prep, ex, start)));
  if (d.n < MIN_TRADES) return { on: false, target: d.median, before, after: before, note: `only ${d.n} past trades` };
  if (!(d.median > 0)) return { on: false, target: d.median, before, after: before, note: "median trade is not a gain" };
  const after = bothStats(sig, prep, { ...ex, target: d.median }, start, recent);
  return { on: beats(after, before), target: d.median, before, after, note: null };
}
