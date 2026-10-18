/**
 * The "reasoning chain" for the UI: one typed object per market that explains the advice step by step
 * (price -> trends -> patterns -> per plan: matched rules -> filters -> decision -> prediction -> exit -> reason).
 * The advice text always comes from advise() unchanged; the only addition to the decision is the tested
 * higher-timeframe filter, which can turn advise()'s BUY into WAIT.
 */
import { advise, dataProblem, describe, marketOpen } from "./advise.ts";
import { analyse, type Analysis } from "./extended.ts";
import { fixed0, plus2 } from "./format.ts";
import { HTF_LABEL, type HtfKind } from "./htf.ts";
import { HORIZONS, NAMES } from "./names.ts";
import { dailyPatterns, lastDonePatterns, type PatternHit } from "./patterns.ts";
import { searchsorted } from "./picker.ts";
import { predict, type Prediction } from "./predict.ts";
import type { Trend } from "./trend.ts";
import type { Bars, Holding, Stats } from "./types.ts";

export interface MarketData { name: string; bars: Bars }

export interface RuleMatch {
  key: string;
  name: string;
  /** Since 2010: trades, % winners, average % per trade; since 2019: average % and trades. */
  n: number;
  win: number;
  avg: number;
  r_avg: number;
  r_n: number;
  text: string;
}

export interface PlanChain {
  plan: string;
  holdDays: number;
  matched: RuleMatch[];
  filters: {
    volume: { on: boolean; ok: boolean | null };
    htf: { pick: HtfKind | null; label: string | null; ok: boolean | null; before: [Stats, Stats] | null; after: [Stats, Stats] | null };
  };
  /** advise(prep, rules, plan, null, provisional), unchanged. */
  advice: [string, string];
  /** advice[0], except "⚪ WAIT" when the tested higher-timeframe filter blocks a BUY. */
  decision: string;
  /** Only when decision is BUY. */
  prediction: Prediction | null;
  exit: { kind: "fixed hold" | "20-day low"; holdDays: number; sellAtTarget: boolean; targetPct: number | null; text: string };
  reason: string;
}

export interface MarketChain {
  name: string;
  date: string;
  price: number;
  change: number;
  changePct: number;
  provisional: boolean;
  dataProblem: string | null;
  /** Daily trend of today; weekly/monthly = last COMPLETED week/month (dated by its last session). */
  trend: { daily: Trend; weekly: Trend; monthly: Trend; weekOf: string | null; monthOf: string | null };
  patterns: {
    daily: { tested: true; hits: (PatternHit & { usedIn: string[] })[] };
    weekly: { tested: false; date: string | null; hits: PatternHit[] };
    monthly: { tested: false; date: string | null; hits: PatternHit[] };
  };
  plans: Record<string, PlanChain>;
}

const pct = (f: number): string => `${plus2(f * 100)}%`;

export function buildChain(data: MarketData, now: Date = new Date(), pre?: Analysis): MarketChain {
  const a = pre ?? analyse(data.bars);
  const { prep, rules, ctx } = a;
  const last = prep.close.length - 1;
  const provisional = marketOpen(data.name, now);
  const price = prep.close[last], prevClose = prep.close[last - 1];
  const wk = ctx.week.lastDone[last], mo = ctx.month.lastDone[last];

  const plans: Record<string, PlanChain> = {};
  for (const [h, n] of Object.entries(HORIZONS)) {
    const plan = rules[h], x = a.plans[h];
    const matched: RuleMatch[] = plan.ok.filter((r) => prep.signals[r.key]?.[last]).map((r) => ({
      key: r.key, name: NAMES[r.key], n: r.n, win: r.win, avg: r.avg, r_avg: r.r_avg, r_n: r.r_n, text: describe(r),
    }));
    const advice = advise(prep, rules, h, null, provisional);
    const pick = x.htf?.pick ?? null;
    const htfOk = pick ? ctx.conds[pick][last] : null;
    const blocked = advice[0] === "🟢 BUY" && htfOk === false;
    const decision = blocked ? "⚪ WAIT" : advice[0];
    const tp = x.takeProfit;
    const sellAtTarget = Boolean(tp?.on);
    const targetPct = x.dist && x.dist.n ? x.dist.median * 100 : null;
    let exitText = `Sell at the open after ${n} session${n > 1 ? "s" : ""}`;
    if (plan.exit === "low20") exitText += ", or earlier if the low falls under the prior 20-day low";
    if (sellAtTarget && tp) exitText += `, or at the target ${pct(tp.target)} if the high reaches it`;
    const prediction = decision === "🟢 BUY" && x.dist && x.dist.n ? predict(price, x.dist) : null;

    let reason: string;
    if (!plan.ok.length) reason = `No rule beat buying the market for the ${h} plan.`;
    else if (!matched.length) reason = "No tested rule fires today.";
    else if (decision !== "🟢 BUY" && blocked) {
      const seen = pick === "daily" ? ctx.dailyTrend[last] : pick === "week" ? ctx.weekTrendByDay[last] : ctx.monthTrendByDay[last];
      reason = `A rule fires, but the tested filter needs ${HTF_LABEL[pick!]} and it is ${seen}.`;
    } else if (decision !== "🟢 BUY") reason = "A rule fires, but volume is below its 30-day average (tested filter).";
    else {
      const d = x.dist!;
      reason = `${matched.length} tested rule${matched.length > 1 ? "s" : ""} fire${matched.length > 1 ? "" : "s"}`
        + (pick ? ` and the ${HTF_LABEL[pick]} confirms` : "")
        + `; past trades like this: median ${pct(d.median)} per ${h}, ${fixed0(d.win * 100)}% profitable (${d.n} trades).`;
    }

    plans[h] = {
      plan: h, holdDays: n, matched,
      filters: {
        volume: { on: plan.filter === "volume", ok: plan.filter === "volume" ? prep.volOk[last] : null },
        htf: { pick, label: pick ? HTF_LABEL[pick] : null, ok: htfOk, before: x.htf?.before ?? null, after: x.htf?.after ?? null },
      },
      advice, decision, prediction,
      exit: { kind: plan.exit === "low20" ? "20-day low" : "fixed hold", holdDays: n, sellAtTarget, targetPct, text: exitText + "." },
      reason,
    };
  }

  const usedIn = (k: string) => Object.keys(HORIZONS).filter((h) => rules[h].ok.some((r) => r.key === k));
  const wp = lastDonePatterns(ctx.week), mp = lastDonePatterns(ctx.month);
  return {
    name: data.name, date: prep.dates[last], price, change: price - prevClose, changePct: (price / prevClose - 1) * 100,
    provisional, dataProblem: dataProblem(prep),
    trend: {
      daily: ctx.dailyTrend[last], weekly: ctx.weekTrendByDay[last], monthly: ctx.monthTrendByDay[last],
      weekOf: wk >= 0 ? ctx.week.bars.dates[wk] : null, monthOf: mo >= 0 ? ctx.month.bars.dates[mo] : null,
    },
    patterns: {
      daily: { tested: true, hits: dailyPatterns(prep).map((p) => ({ ...p, usedIn: usedIn(p.key) })) },
      weekly: { tested: false, date: wp.date, hits: wp.hits },
      monthly: { tested: false, date: mp.date, hits: mp.hits },
    },
    plans,
  };
}

export interface HoldingEvent { icon: string; text: string }
export interface HoldingAdvice {
  /** Final advice: advise()'s, or the target SELL when take-profit is ON for this plan and the target was reached. */
  advice: [string, string];
  /** advise() unchanged. */
  base: [string, string];
  events: HoldingEvent[];
  /** buy_price × (1 + median), when the plan has a positive median and the holding has a buy price. */
  targetPrice: number | null;
  targetReached: boolean;
}

/** advise() for a holding, plus the target events. Never changes advise() itself. */
export function adviseHolding(a: Analysis, h: string, holding: Holding, provisional: boolean): HoldingAdvice {
  const { prep, rules } = a;
  const base = advise(prep, rules, h, holding, provisional);
  const out: HoldingAdvice = { advice: base, base, events: [], targetPrice: null, targetReached: false };
  const x = a.plans[h], price = holding.buy_price ?? null;
  if (h !== holding.horizon || !price || !x?.dist || !(x.dist.median > 0)) return out;
  const median = x.takeProfit?.target ?? x.dist.median;
  const T = price * (1 + median);
  out.targetPrice = T;
  const b = searchsorted(prep.dates, holding.buy_date), last = prep.close.length - 1;
  for (let i = b; i <= last; i++) if (prep.high[i] >= T) { out.targetReached = true; break; }
  if (!out.targetReached) return out;
  if (x.takeProfit?.on && base[0] !== "🔴 SELL") {
    const pnl = ` · ${plus2((prep.close[last] / price - 1) * 100)}% so far`;
    out.advice = ["🔴 SELL", `Target ${pct(median)} reached (predicted): sell now${pnl}.`];
  } else if (x.takeProfit?.on) {
    out.events.push({ icon: "🎯", text: `Target ${pct(median)} reached (predicted).` });
  } else {
    out.events.push({ icon: "🎯", text: `Target ${pct(median)} reached — in this market holding usually earns more` });
  }
  return out;
}
