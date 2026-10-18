/**
 * Higher-timeframe confirmation filter (tested like core._pick_filter_and_exit): on top of a plan's final signal,
 * require "daily trend UP", "last completed WEEK trend UP" or "last completed MONTH trend UP". Each is kept only if
 * it beats not requiring it since 2010 AND since 2019 (picker.beats); at most one is picked (best avg since 2010).
 */
import { beats } from "./picker.ts";
import { monthly, weekly, type Resampled } from "./resample.ts";
import { TREND_PARAMS, trendLabels, type Trend } from "./trend.ts";
import { bothStats, type ExitRule } from "./trades.ts";
import type { Bars, Flags, Prep, Stats } from "./types.ts";

export type HtfKind = "daily" | "week" | "month";
export const HTF_KINDS: HtfKind[] = ["daily", "week", "month"];
export const HTF_LABEL: Record<HtfKind, string> = {
  daily: "daily trend UP",
  week: "last completed week's trend UP",
  month: "last completed month's trend UP",
};

/** Trend context of one market: per-bar labels for each time frame and the per-day view without look-ahead. */
export interface TrendContext {
  week: Resampled;
  month: Resampled;
  /** Trend per daily bar / per weekly bar / per monthly bar. */
  dailyTrend: Trend[];
  weekTrend: Trend[];
  monthTrend: Trend[];
  /** Per day: trend of the last completed week / month before that day's week / month ("SIDEWAYS" if none). */
  weekTrendByDay: Trend[];
  monthTrendByDay: Trend[];
  /** Per day: each confirmation condition. */
  conds: Record<HtfKind, Flags>;
}

export function trendContext(b: Bars): TrendContext {
  const week = weekly(b), month = monthly(b);
  const dailyTrend = trendLabels(b.close, TREND_PARAMS.daily);
  const weekTrend = trendLabels(week.bars.close, TREND_PARAMS.weekly);
  const monthTrend = trendLabels(month.bars.close, TREND_PARAMS.monthly);
  const byDay = (r: Resampled, t: Trend[]): Trend[] => r.lastDone.map((k) => (k >= 0 ? t[k] : "SIDEWAYS"));
  const weekTrendByDay = byDay(week, weekTrend), monthTrendByDay = byDay(month, monthTrend);
  return {
    week, month, dailyTrend, weekTrend, monthTrend, weekTrendByDay, monthTrendByDay,
    conds: {
      daily: dailyTrend.map((t) => t === "UP"),
      week: weekTrendByDay.map((t) => t === "UP"),
      month: monthTrendByDay.map((t) => t === "UP"),
    },
  };
}

export interface HtfTest { after: [Stats, Stats]; passes: boolean }
export interface HtfChoice {
  pick: HtfKind | null;
  /** Plan as traded today (no HTF filter), since 2010 and since 2019. */
  before: [Stats, Stats];
  /** With the picked filter (equal to `before` when none is picked). */
  after: [Stats, Stats];
  tested: Record<HtfKind, HtfTest>;
}

/** Test the three confirmations on one plan's final signal and exit; pick at most one. */
export function pickHtf(sig: Flags, prep: Prep, ex: ExitRule, ctx: TrendContext, start: number, recent: number): HtfChoice {
  const before = bothStats(sig, prep, ex, start, recent);
  const tested = {} as Record<HtfKind, HtfTest>;
  let pick: HtfKind | null = null;
  for (const k of HTF_KINDS) {
    const c = ctx.conds[k];
    const after = bothStats(sig.map((x, i) => x && c[i]), prep, ex, start, recent);
    const passes = beats(after, before);
    tested[k] = { after, passes };
    if (passes && (pick === null || after[0].avg > tested[pick].after[0].avg)) pick = k;
  }
  return { pick, before, after: pick ? tested[pick].after : before, tested };
}

/** Apply a picked confirmation to a signal. */
export const applyHtf = (sig: Flags, ctx: TrendContext, pick: HtfKind | null): Flags =>
  pick ? sig.map((x, i) => x && ctx.conds[pick][i]) : sig;
