/**
 * Price / profit "prediction" for a plan = the spread of its own past trades (same signal and exit as the bot).
 * It is a description of past outcomes, not a forecast model; validatePrediction measures how well the numbers
 * from 2010–2018 carried over to 2019+ (no look-ahead: training trades must be sold before 2019-01-01).
 */
import { simulate, reached, type ExitRule, type Trade } from "./trades.ts";
import type { Flags, Prep } from "./types.ts";

export interface Dist {
  n: number;
  /** Fractions (0.012 = +1.2%), net of cost. */
  median: number;
  p25: number;
  p75: number;
  mean: number;
  /** Share of winning trades, 0..1. */
  win: number;
}

/** numpy.quantile (linear interpolation) of an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(rets: number[]): Dist {
  const s = rets.slice().sort((a, b) => a - b);
  const n = s.length;
  return {
    n,
    median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75),
    mean: n ? s.reduce((a, x) => a + x, 0) / n : NaN,
    win: n ? s.filter((x) => x > 0).length / n : NaN,
  };
}

export interface Prediction {
  /** Close the prediction is made from. */
  close: number;
  target: number;
  low: number;
  high: number;
  /** Probability of profit = past win rate, 0..1. */
  probability: number;
  median: number;
  p25: number;
  p75: number;
  n: number;
}

/** Target = close × (1 + median), likely range close × (1 + p25) .. close × (1 + p75), probability = win rate. */
export function predict(close: number, d: Dist): Prediction {
  return {
    close, target: close * (1 + d.median), low: close * (1 + d.p25), high: close * (1 + d.p75),
    probability: d.win, median: d.median, p25: d.p25, p75: d.p75, n: d.n,
  };
}

export interface PredictionCheck {
  /** Numbers learned from trades sold before 2019. */
  train: Dist;
  /** What actually happened on 2019+ trades. */
  test: Dist;
  /** Share of 2019+ returns inside the training [p25, p75] (ideal ≈ 0.5). */
  inRange: number;
  /** Share of 2019+ trades whose high reached entry × (1 + training median) while held. */
  targetHit: number;
  /** Mean |actual − training median| on 2019+ trades (fraction). */
  mae: number;
  /** Same error for a naive "0%" forecast, as a yardstick. */
  maeZero: number;
}

/** Learn on trades sold before `recent`, measure on trades from `recent` on. Null when either side has no trades. */
export function validatePrediction(sig: Flags, prep: Prep, ex: ExitRule, start: number, recent: number): PredictionCheck | null {
  const trainT = simulate(sig, prep, ex, start).filter((t) => t.exit < recent);
  const testT: Trade[] = simulate(sig, prep, ex, recent);
  if (!trainT.length || !testT.length) return null;
  const train = distribution(trainT.map((t) => t.ret)), test = distribution(testT.map((t) => t.ret));
  const k = testT.length;
  const inRange = testT.filter((t) => t.ret >= train.p25 && t.ret <= train.p75).length / k;
  const targetHit = testT.filter((t) => reached(t, prep, prep.open[t.entry] * (1 + train.median))).length / k;
  const mae = testT.reduce((a, t) => a + Math.abs(t.ret - train.median), 0) / k;
  const maeZero = testT.reduce((a, t) => a + Math.abs(t.ret), 0) / k;
  return { train, test, inRange, targetHit, mae, maeZero };
}
