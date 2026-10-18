/**
 * Trade-by-trade version of picker.fixedHold / picker.holdLow20 (same loop, same arithmetic, so the returns are
 * identical), keeping entry/exit indices, plus an optional take-profit at a fixed % above the entry.
 */
import { stats } from "./picker.ts";
import { COST } from "./names.ts";
import type { Flags, Plan, Prep, Stats } from "./types.ts";

export interface Trade {
  /** Signal day (close), entry day (bought at its open), exit day (sold on that day). */
  sig: number;
  entry: number;
  exit: number;
  /** Sell price and net return (after COST). */
  px: number;
  ret: number;
  why: "time" | "low20" | "target";
}

export interface ExitRule {
  /** Sessions held (sell at the open n sessions after the entry). */
  n: number;
  /** Sell early when the low falls under the prior 20-day low (plan.exit === "low20"). */
  low20: boolean;
  /** Take-profit: sell when the high reaches entry × (1 + target), at the target or at the open if it gapped above. */
  target?: number | null;
}

/** The plan's final BUY signal as the bot trades it: OR of its "ok" rules, then the volume filter if picked. */
export function planSignal(prep: Prep, plan: Plan): Flags {
  const sig = new Array<boolean>(prep.open.length).fill(false);
  for (const r of plan.ok) {
    const s = prep.signals[r.key];
    for (let i = 0; i < sig.length; i++) if (s[i]) sig[i] = true;
  }
  if (plan.filter === "volume") for (let i = 0; i < sig.length; i++) sig[i] = sig[i] && prep.volOk[i];
  return sig;
}

/** The plan's exit as the bot trades it today. */
export const planExit = (plan: Plan, n: number): ExitRule => ({ n, low20: plan.exit === "low20" });

/**
 * Buy at the next open after a signal, one trade at a time, from day `start` on.
 * Within a held day the checks run: gap above the target at the open, then the 20-day-low exit (assumed first when
 * both could happen on the same day: the cautious choice), then the high reaching the target.
 */
export function simulate(sig: Flags, prep: Prep, ex: ExitRule, start: number): Trade[] {
  const { open: op, high: hi, low: lo, low20 } = prep;
  const n = ex.n, tgt = ex.target ?? null;
  const out: Trade[] = [];
  const last = op.length - 1;
  let i = start;
  while (i < last) {
    if (!(sig[i] && i + 1 + n <= last)) {
      i += 1;
      continue;
    }
    const e = i + 1;
    const T = tgt === null ? NaN : op[e] * (1 + tgt);
    let px = op[i + 1 + n], x = i + 1 + n, why: Trade["why"] = "time";
    for (let j = e; j < e + n; j++) {
      if (tgt !== null && j > e && op[j] >= T) { px = op[j]; x = j; why = "target"; break; }
      if (ex.low20 && lo[j] < low20[j]) { px = Math.min(op[j], low20[j]); x = j; why = "low20"; break; }
      if (tgt !== null && hi[j] >= T) { px = T; x = j; why = "target"; break; }
    }
    out.push({ sig: i, entry: e, exit: x, px, ret: px / op[e] - 1 - COST, why });
    i = x;
  }
  return out;
}

/** Returns only. */
export const rets = (t: Trade[]): number[] => t.map((x) => x.ret);

/** core._stats on [since start, since recent]. */
export function bothStats(sig: Flags, prep: Prep, ex: ExitRule, start: number, recent: number): [Stats, Stats] {
  return [stats(rets(simulate(sig, prep, ex, start))), stats(rets(simulate(sig, prep, ex, recent)))];
}

/** Did the high reach `price` while the trade was held (full days before the exit day, or the sell price itself)? */
export function reached(t: Trade, prep: Prep, price: number): boolean {
  if (t.px >= price) return true;
  for (let j = t.entry; j < t.exit; j++) if (prep.high[j] >= price) return true;
  return false;
}
