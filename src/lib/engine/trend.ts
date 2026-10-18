/**
 * Trend label per bar: UP if close > fast SMA > slow SMA and the fast SMA is above its value `slope` bars ago;
 * DOWN if the mirror image holds; else SIDEWAYS (also SIDEWAYS while the averages are still warming up).
 */
import { sma } from "./indicators.ts";
import type { Series } from "./types.ts";

export type Trend = "UP" | "DOWN" | "SIDEWAYS";

export interface TrendParams { fast: number; slow: number; slope: number }

/** Daily: SMA50/SMA200, 20-bar slope. Weekly: SMA10/SMA30, 4-bar slope. Monthly: SMA6/SMA12, 3-bar slope. */
export const TREND_PARAMS: Record<"daily" | "weekly" | "monthly", TrendParams> = {
  daily: { fast: 50, slow: 200, slope: 20 },
  weekly: { fast: 10, slow: 30, slope: 4 },
  monthly: { fast: 6, slow: 12, slope: 3 },
};

/** Trend label for every bar of a close series (uses only bars up to and including that bar). */
export function trendLabels(close: Series, p: TrendParams): Trend[] {
  const f = sma(close, p.fast), s = sma(close, p.slow);
  return close.map((c, i) => {
    const prev = i >= p.slope ? f[i - p.slope] : NaN;
    if (c > f[i] && f[i] > s[i] && f[i] > prev) return "UP";
    if (c < f[i] && f[i] < s[i] && f[i] < prev) return "DOWN";
    return "SIDEWAYS";
  });
}
