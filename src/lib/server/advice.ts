/**
 * What the page shows per market (GET /api/state), built from the chain (the main advice) and adviseHolding.
 */
import { adviseHolding, buildChain, type HoldingAdvice, type MarketChain } from "../engine/chain.ts";
import { marketOpen } from "../engine/index.ts";
import type { Holding } from "../engine/index.ts";
import { predict, type Prediction } from "../engine/predict.ts";
import { KEYS, type Settings, intervalName } from "../shared.ts";
import { store } from "../store.ts";
import { loadMarket, MARKET_LIST, tickerOf, type Loaded } from "./markets.ts";

export type Holdings = Record<string, Holding>;

export interface HoldingView {
  holding: Holding;
  /** adviseHolding (take-profit forced off, so `advice` is advise() unchanged). */
  advice: HoldingAdvice;
  /** Its plan's past-trade spread applied to the buy price (null without a buy price or past trades). */
  plan: Prediction | null;
  /** Median as a fraction, when there is no buy price. */
  median: number | null;
}

export interface MarketView {
  name: string;
  ticker: string;
  open: boolean;
  error: string | null;
  chain: MarketChain | null;
  holding: HoldingView | null;
  /** Rules in use per plan (all rules, not only today's), for the chain view. */
  rulesInUse: Record<string, number> | null;
}

export interface StateResponse {
  updated: number;
  interval: string;
  holdings: Holdings;
  markets: MarketView[];
}

export async function getHoldings(): Promise<Holdings> {
  return (await store.get<Holdings>(KEYS.holdings)) ?? {};
}

export async function getInterval(): Promise<string> {
  return intervalName((await store.get<Settings>(KEYS.settings))?.interval);
}

/** The main advice line for one plan: advise()'s own wording when the chain says BUY, else the chain's reason. */
export const whyLine = (c: MarketChain, h: string): string => {
  const p = c.plans[h];
  return p.decision === "🟢 BUY" ? p.advice[1] : p.reason;
};

export function holdingView(l: Loaded, holding: Holding, provisional: boolean): HoldingView {
  const advice = adviseHolding(l.a, holding.horizon, holding, provisional);
  const d = l.a.plans[holding.horizon]?.dist ?? null;
  const has = Boolean(d && d.n);
  return {
    holding, advice,
    plan: has && holding.buy_price ? predict(holding.buy_price, d!) : null,
    median: has ? d!.median : null,
  };
}

export function marketView(l: Loaded, holding: Holding | undefined, now: Date): MarketView {
  const chain = buildChain({ name: l.name, bars: l.bars }, now, l.a);
  return {
    name: l.name, ticker: l.ticker, open: chain.provisional, error: null, chain,
    holding: holding ? holdingView(l, holding, chain.provisional) : null,
    rulesInUse: Object.fromEntries(Object.entries(l.a.rules).map(([h, r]) => [h, r.ok.length])),
  };
}

/** All three markets; a failure (e.g. Yahoo down) is reported for that market only. */
export async function buildState(fresh = false): Promise<StateResponse> {
  const [holdings, interval] = await Promise.all([getHoldings(), getInterval()]);
  const now = new Date();
  const markets = await Promise.all(MARKET_LIST.map(async (name): Promise<MarketView> => {
    try {
      return marketView(await loadMarket(name, { fresh }), holdings[name], now);
    } catch (e) {
      return {
        name, ticker: tickerOf(name), open: marketOpen(name, now), chain: null, holding: null, rulesInUse: null,
        error: `Could not load data: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }));
  return { updated: now.getTime(), interval, holdings, markets };
}
