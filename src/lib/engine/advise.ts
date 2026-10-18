/** Advice for one market and plan (core.market_open, describe, advise, _stop_hit, data_problem). */
import { comma2, fixed0, fmtG, pct0, plus2 } from "./format.ts";
import { HORIZONS, NAMES } from "./names.ts";
import { searchsorted } from "./picker.ts";
import type { Approved, Bars, Holding, Prep, RuleRow } from "./types.ts";

const IST_OFFSET_MIN = 330; // Asia/Kolkata is UTC+5:30 all year (no daylight saving)

/** Is the market trading now (India time)? Crude trades almost all day on weekdays. */
export function marketOpen(name: string, now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000); // read with getUTC* = wall clock in India
  const weekday = (ist.getUTCDay() + 6) % 7; // Monday = 0, like Python's weekday()
  if (name.startsWith("Crude")) return weekday < 5;
  const ms = ((ist.getUTCHours() * 60 + ist.getUTCMinutes()) * 60 + ist.getUTCSeconds()) * 1000 + ist.getUTCMilliseconds();
  return weekday < 5 && (9 * 60 + 15) * 60_000 <= ms && ms <= (15 * 60 + 30) * 60_000;
}

/** "Name +0.12%/trade, 55% win". */
export function describe(rule: RuleRow): string {
  return `${NAMES[rule.key]} ${plus2(rule.avg)}%/trade, ${fixed0(rule.win)}% win`;
}

/** Return [advice, short reason] for one market and one time frame, using the last day of `prep`. */
export function advise(prep: Prep, rules: Approved, h: string, holding: Holding | null, provisional: boolean): [string, string] {
  const last = prep.close.length - 1;
  const plan = rules[h];
  const ok = plan.ok;
  const firing = ok.filter((r) => Boolean(prep.signals[r.key]?.[last]));
  const why = firing.slice(0, 2).map(describe).join("; ") + (firing.length > 2 ? `; +${firing.length - 2} more` : "");
  const lowVolume = plan.filter === "volume" && !prep.volOk[last];

  if (holding === null || holding === undefined) {
    if (!ok.length) return ["⛔ NO TRADE", `No strategy works for ${h} here.`];
    if (firing.length && lowVolume) {
      return ["⚪ WAIT", "Signal on, but volume is below its 30-day average (tested filter, final at close)."];
    }
    if (firing.length) {
      const live = provisional ? " (live, final at close)" : "";
      const exitNote = plan.exit === "low20" ? ", or earlier if it falls under its 20-day low" : "";
      return ["🟢 BUY", `Buy next open, sell after ${h}${exitNote}${live}. Why: ${why}.`];
    }
    return ["⚪ WAIT", "No signal."];
  }

  // holding: the tested plan is "sell at the open after N trading days"; a fresh signal renews the hold
  if (h !== holding.horizon) return ["➖", `On ${holding.horizon} plan.`];
  const n = HORIZONS[holding.horizon];
  const b = searchsorted(prep.dates, holding.buy_date); // "YYYY-MM-DD" strings sort like the dates
  const len = prep.close.length;
  if (b >= len) return ["🔵 HOLD", "Count starts next trading day."];
  const price = holding.buy_price ?? null;
  const pnl = price ? ` · ${plus2((prep.close[last] / price - 1) * 100)}% so far` : "";
  const change = price ? (holding.stop_change ?? null) : null;
  const stop = change ? price! * (1 + change / 100) : null;
  if (stop && stopHit(prep, b, stop, change! > 0)) {
    const kind = change! < 0 ? "stop-loss" : "profit lock";
    return ["🔴 SELL", `Your ${kind} ${comma2(stop)} (${fmtG(change!, true)}%) was hit: sell now${pnl}.`];
  }
  if (plan.exit === "low20" && fellUnderLow20(prep, b)) {
    return ["🔴 SELL", `Fell under its 20-day low (tested exit): sell next open${pnl}.`];
  }
  const stopNote = stop ? ` · ${change! < 0 ? "stop" : "profit lock"} ${comma2(stop)}` : "";
  const left = n - (len - 1 - b);
  if (left > 1) return ["🔵 HOLD", `${left} trading days left${pnl}${stopNote}.`];
  if (firing.length && !lowVolume) return ["🔵 HOLD", `Plan over, new signal: keep${pnl}${stopNote}. Why: ${why}.`];
  return ["🔴 SELL", `Plan over: sell next open${pnl}.`];
}

/** Any day from b on whose low is under the prior 20-day low. */
function fellUnderLow20(prep: Prep, b: number): boolean {
  for (let i = b; i < prep.low.length; i++) if (prep.low[i] < prep.low20[i]) return true;
  return false;
}

/** Below the buy price: hit when any low since buying (day b on) touches it. Above the buy price (profit lock):
 * the high must first reach it, and a LATER day's low must fall back to it. */
export function stopHit(prep: Prep, b: number, stop: number, aboveBuy: boolean): boolean {
  const lo = prep.low, hi = prep.high;
  if (!aboveBuy) {
    for (let i = b; i < lo.length; i++) if (lo[i] <= stop) return true;
    return false;
  }
  let reached = -1;
  for (let i = b; i < hi.length; i++) if (hi[i] >= stop) { reached = i; break; }
  if (reached < 0) return false;
  for (let i = reached + 1; i < lo.length; i++) if (lo[i] <= stop) return true;
  return false;
}

/** Cheap sanity check on the latest candle (Yahoo futures data sometimes glitches around contract switches). */
export function dataProblem(df: Bars): string | null {
  const k = df.close.length - 1;
  const o = df.open[k], hi = df.high[k], lo = df.low[k], c = df.close[k];
  if (!(lo <= c && c <= hi) || !(lo <= o && o <= hi)) {
    return `Today's candle doesn't add up (close ${comma2(c)} outside the day's range ${comma2(lo)}–${comma2(hi)}). Treat today's advice with care.`;
  }
  const jump = Math.abs(c / df.close[k - 1] - 1);
  if (jump > 0.08) return `Price moved ${pct0(jump)} in one day. Check the news or the data before acting.`;
  return null;
}
