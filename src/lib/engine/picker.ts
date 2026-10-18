/**
 * Which strategies earned a place (core._fixed_hold, _hold_low20, _stats, approved, _beats, _pick_filter_and_exit).
 * approved() is a pure function of the prepared data (the Python per-day cache is left to the caller).
 */
import { npMean } from "./indicators.ts";
import { COST, HORIZONS, KEYS, MIN_RECENT, MIN_TRADES, RECENT_START, TEST_START } from "./names.ts";
import type { Approved, Flags, Plan, Prep, RuleRow, Series, Stats } from "./types.ts";

/** Buy at the next open after a signal, sell at the open n sessions later; one trade at a time. */
export function fixedHold(sig: Flags, op: Series, n: number, start: number): number[] {
  const rets: number[] = [];
  const last = op.length - 1;
  let i = start;
  while (i < last) {
    if (sig[i] && i + 1 + n <= last) {
      rets.push(op[i + 1 + n] / op[i + 1] - 1 - COST);
      i += 1 + n;
    } else i += 1;
  }
  return rets;
}

/** Like fixedHold, but sell early when the low falls under the prior 20-day low (at that level, or the open). */
export function holdLow20(sig: Flags, op: Series, lo: Series, low20: Series, n: number, start: number): number[] {
  const rets: number[] = [];
  const last = op.length - 1;
  let i = start;
  while (i < last) {
    if (!(sig[i] && i + 1 + n <= last)) {
      i += 1;
      continue;
    }
    let px = op[i + 1 + n], exitI = i + 1 + n;
    for (let j = i + 1; j < i + 1 + n; j++) {
      if (lo[j] < low20[j]) {
        px = Math.min(op[j], low20[j]);
        exitI = j;
        break;
      }
    }
    rets.push(px / op[i + 1] - 1 - COST);
    i = exitI;
  }
  return rets;
}

/** Number of trades, % winners, average % return (pandas Series.mean, i.e. numpy pairwise sum / n). */
export function stats(rets: number[]): Stats {
  const n = rets.length;
  if (!n) return { n: 0, win: 0.0, avg: 0.0 };
  const wins = rets.filter((r) => r > 0).length;
  return { n, win: (wins / n) * 100, avg: npMean(rets) * 100 };
}

/** Index of the first date >= day (pandas DatetimeIndex.searchsorted, side="left"). */
export function searchsorted(dates: string[], day: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Stable sort, best average first (Python `sorted(rows, key=lambda x: -x["avg"])`). */
const byAvgDesc = (rows: RuleRow[]): RuleRow[] => rows.slice().sort((a, b) => (a.avg > b.avg ? -1 : a.avg < b.avg ? 1 : 0));

/** Per time frame: the market's own result, the strategies that pass both checks (best first),
 * and the ones that only passed the full period (dropped by the luck check). */
export function approved(prep: Prep): Approved {
  const op = prep.open;
  const start = searchsorted(prep.dates, TEST_START), recent = searchsorted(prep.dates, RECENT_START);
  const always = new Array<boolean>(op.length).fill(true);
  const out: Approved = {};
  for (const [h, n] of Object.entries(HORIZONS)) {
    const market = stats(fixedHold(always, op, n, start)), marketR = stats(fixedHold(always, op, n, recent));
    const ok: RuleRow[] = [], dropped: RuleRow[] = [];
    for (const k of KEYS) {
      const sig = prep.signals[k];
      const s = stats(fixedHold(sig, op, n, start));
      if (!(s.n >= MIN_TRADES && s.avg > 0 && s.avg > market.avg)) continue;
      const r = stats(fixedHold(sig, op, n, recent));
      const row: RuleRow = { key: k, ...s, r_avg: r.avg, r_n: r.n };
      const passed = r.n >= MIN_RECENT && r.avg > 0 && r.avg > marketR.avg;
      (passed ? ok : dropped).push(row);
    }
    const plan: Plan = {
      market, market_recent: marketR, ok: byAvgDesc(ok), dropped: byAvgDesc(dropped),
      ...pickFilterAndExit(prep, ok.map((x) => x.key), n, start, recent),
    };
    out[h] = plan;
  }
  return out;
}

/** New version beats the old one since 2010 AND since 2019, with enough trades in both. */
export function beats(nw: [Stats, Stats], old: [Stats, Stats]): boolean {
  const [s, r] = nw, [s0, r0] = old;
  return s.n >= MIN_TRADES && r.n >= MIN_RECENT && s.avg > s0.avg && r.avg > r0.avg;
}

/** For one market and plan: use the volume filter and/or the 20-day-low exit only if each beats not using it. */
export function pickFilterAndExit(prep: Prep, keys: string[], n: number, start: number, recent: number):
  { filter: "volume" | null; exit: "low20" | null } {
  if (!keys.length) return { filter: null, exit: null };
  let sig: Flags = new Array<boolean>(prep.open.length).fill(false);
  for (const k of keys) sig = sig.map((x, i) => x || prep.signals[k][i]);
  const op = prep.open, lo = prep.low, low20 = prep.low20;
  const both = (f: (s0: number) => number[]): [Stats, Stats] => [stats(f(start)), stats(f(recent))];
  let base = both((s0) => fixedHold(sig, op, n, s0));
  const filtered = sig.map((x, i) => x && prep.volOk[i]);
  const useFilter = beats(both((s0) => fixedHold(filtered, op, n, s0)), base);
  if (useFilter) {
    sig = filtered;
    base = both((s0) => fixedHold(filtered, op, n, s0));
  }
  const useExit = n > 1 && beats(both((s0) => holdLow20(sig, op, lo, low20, n, s0)), base);
  return { filter: useFilter ? "volume" : null, exit: useExit ? "low20" : null };
}
