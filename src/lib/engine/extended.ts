/**
 * Step-2 analysis of one market, built on top of the unchanged bot (prepare + approved):
 * per plan, the higher-timeframe filter choice, the trade spread used for predictions, the prediction check and the
 * take-profit choice. Order (like core._pick_filter_and_exit: filter first, then exit):
 *   bot signal (ok rules + volume filter) -> HTF filter if picked -> trades with the bot's exit -> spread ->
 *   take-profit tested on that signal against the bot's exit.
 */
import { approved, prepare } from "./index.ts";
import { HORIZONS, RECENT_START, TEST_START } from "./names.ts";
import { searchsorted } from "./picker.ts";
import { applyHtf, pickHtf, trendContext, type HtfChoice, type TrendContext } from "./htf.ts";
import { distribution, validatePrediction, type Dist, type PredictionCheck } from "./predict.ts";
import { pickTakeProfit, type TakeProfitChoice } from "./takeProfit.ts";
import { planExit, planSignal, rets, simulate, type ExitRule } from "./trades.ts";
import type { Approved, Bars, Flags, Prep } from "./types.ts";

export interface PlanExtra {
  h: string;
  n: number;
  /** The bot's final signal (unchanged) and its exit. */
  botSignal: Flags;
  exit: ExitRule;
  /** Null when the plan has no approved rule (NO TRADE). */
  htf: HtfChoice | null;
  /** Signal after the HTF filter (= botSignal when none picked). */
  signal: Flags;
  /** Spread of the since-2010 trades of `signal` with the bot's exit (used for today's prediction and the target). */
  dist: Dist | null;
  /** 2010–2018 -> 2019+ check of those numbers. */
  check: PredictionCheck | null;
  takeProfit: TakeProfitChoice | null;
}

export interface Analysis {
  prep: Prep;
  rules: Approved;
  ctx: TrendContext;
  start: number;
  recent: number;
  plans: Record<string, PlanExtra>;
}

export function analyse(bars: Bars, pre?: { prep: Prep; rules: Approved }): Analysis {
  const prep = pre?.prep ?? prepare(bars);
  const rules = pre?.rules ?? approved(prep);
  const ctx = trendContext(prep);
  const start = searchsorted(prep.dates, TEST_START), recent = searchsorted(prep.dates, RECENT_START);
  const plans: Record<string, PlanExtra> = {};
  for (const [h, n] of Object.entries(HORIZONS)) {
    const plan = rules[h];
    const botSignal = planSignal(prep, plan), exit = planExit(plan, n);
    if (!plan.ok.length) {
      plans[h] = { h, n, botSignal, exit, htf: null, signal: botSignal, dist: null, check: null, takeProfit: null };
      continue;
    }
    const htf = pickHtf(botSignal, prep, exit, ctx, start, recent);
    const signal = applyHtf(botSignal, ctx, htf.pick);
    const dist = distribution(rets(simulate(signal, prep, exit, start)));
    plans[h] = {
      h, n, botSignal, exit, htf, signal, dist,
      check: validatePrediction(signal, prep, exit, start, recent),
      takeProfit: pickTakeProfit(signal, prep, exit, start, recent),
    };
  }
  return { prep, rules, ctx, start, recent, plans };
}
