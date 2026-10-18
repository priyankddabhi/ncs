/**
 * Daily bars -> weekly (ISO week, Monday..Sunday) or monthly bars, plus a no-look-ahead map from each day
 * to the last COMPLETED week/month (the one strictly before that day's own week/month).
 */
import type { Bars } from "./types.ts";

export type Period = "week" | "month";

export interface Resampled {
  /** One bar per week/month: open first, high max, low min, close last, volume sum, dated by its last session. */
  bars: Bars;
  /** dayToBar[i] = index of the week/month bar that contains day i. */
  dayToBar: number[];
  /** lastDone[i] = index of the last week/month that ended strictly before day i's week/month (-1 if none). */
  lastDone: number[];
}

/** Bucket key: the Monday of the ISO week ("YYYY-MM-DD"), or "YYYY-MM" for months. */
export function periodKey(day: string, period: Period): string {
  if (period === "month") return day.slice(0, 7);
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/** Group consecutive daily bars by ISO week or calendar month (input oldest first). */
export function resample(d: Bars, period: Period): Resampled {
  const out: Bars = { dates: [], open: [], high: [], low: [], close: [], volume: [] };
  const dayToBar = new Array<number>(d.dates.length);
  let key = "";
  for (let i = 0; i < d.dates.length; i++) {
    const k = periodKey(d.dates[i], period);
    if (k !== key) {
      key = k;
      out.dates.push(d.dates[i]);
      out.open.push(d.open[i]);
      out.high.push(d.high[i]);
      out.low.push(d.low[i]);
      out.close.push(d.close[i]);
      out.volume.push(d.volume[i]);
    } else {
      const j = out.dates.length - 1;
      out.dates[j] = d.dates[i];
      if (d.high[i] > out.high[j]) out.high[j] = d.high[i];
      if (d.low[i] < out.low[j]) out.low[j] = d.low[i];
      out.close[j] = d.close[i];
      out.volume[j] += d.volume[i];
    }
    dayToBar[i] = out.dates.length - 1;
  }
  return { bars: out, dayToBar, lastDone: dayToBar.map((b) => b - 1) };
}

export const weekly = (d: Bars): Resampled => resample(d, "week");
export const monthly = (d: Bars): Resampled => resample(d, "month");
