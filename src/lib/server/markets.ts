/**
 * Prices + analysis per market, with in-memory caches (kept on globalThis so every route shares them):
 * - daily bars from Yahoo: reused for 60 s (core.LIVE_MAX_AGE), `fresh` skips the cache;
 * - the strategy test (approved rules + higher-timeframe filter pick + past-trade spread): once per market per
 *   India day, like core.approved; the signals (prepare) and trends are recomputed whenever the prices change,
 *   so a live BUY can appear or disappear during the day.
 * Take-profit is OFF everywhere (owner decision): the cached analysis has takeProfit.on forced to false.
 */
import { fetchDaily } from "../data/yahoo.ts";
import { approved, KEYS, MARKETS, prepare } from "../engine/index.ts";
import type { Bars, Prep } from "../engine/index.ts";
import { analyse, type Analysis } from "../engine/extended.ts";
import { trendContext, type TrendContext } from "../engine/htf.ts";
import { istDay, shortDay } from "../shared.ts";

const LIVE_MAX_AGE = 60_000;

interface BarsEntry { at: number; bars: Bars }
interface DayEntry { day: string; rules: Analysis["rules"]; plans: Analysis["plans"]; start: number; recent: number }
interface PrepEntry { fp: string; prep: Prep; ctx: TrendContext }
interface Caches {
  bars: Map<string, BarsEntry>;
  inflight: Map<string, Promise<Bars>>;
  day: Map<string, DayEntry>;
  prep: Map<string, PrepEntry>;
}

const g = globalThis as unknown as { __advisorCaches?: Caches };
const caches: Caches = (g.__advisorCaches ??= { bars: new Map(), inflight: new Map(), day: new Map(), prep: new Map() });

export const tickerOf = (name: string): string => {
  const t = MARKETS[name];
  if (!t) throw new Error(`unknown market: ${name}`);
  return t;
};

/** Accepts a market name ("Nifty 50") or its ticker ("^NSEI"). */
export const marketName = (q: string | null): string | null =>
  q === null ? null : (q in MARKETS ? q : Object.keys(MARKETS).find((n) => MARKETS[n] === q) ?? null);

/** Daily bars, from the 60-second cache unless `fresh`. Parallel callers share one Yahoo request. */
export async function getBars(ticker: string, fresh = false): Promise<{ bars: Bars; cached: boolean; age: number }> {
  const hit = caches.bars.get(ticker);
  const now = Date.now();
  if (hit && !fresh && now - hit.at < LIVE_MAX_AGE) return { bars: hit.bars, cached: true, age: now - hit.at };
  let p = caches.inflight.get(ticker);
  if (!p) {
    p = fetchDaily(ticker).finally(() => caches.inflight.delete(ticker));
    caches.inflight.set(ticker, p);
  }
  const bars = await p;
  caches.bars.set(ticker, { at: Date.now(), bars });
  return { bars, cached: false, age: 0 };
}

const fingerprint = (b: Bars): string => {
  const k = b.close.length - 1;
  return [k, b.dates[k], b.open[k], b.high[k], b.low[k], b.close[k], b.volume[k]].join("|");
};

export interface Loaded { name: string; ticker: string; bars: Bars; a: Analysis }

const secs = (ms: number) => (ms / 1000).toFixed(2);

/**
 * Fetch prices, compute the strategies, load the strategy test (core.analyse_market).
 * `step(text)` is called after each of the 3 real steps, with the time it took.
 */
export async function loadMarket(name: string, opts: { fresh?: boolean; step?: (text: string) => void | Promise<void> } = {}): Promise<Loaded> {
  const say = opts.step ?? (() => {});
  const ticker = tickerOf(name);

  let t = performance.now();
  const { bars, cached, age } = await getBars(ticker, opts.fresh);
  const src = cached ? `cache (${Math.round(age / 1000)} s old)` : "Yahoo";
  await say(`${name}: ${bars.dates.length.toLocaleString("en-IN")} days of prices from ${src}, latest ${shortDay(bars.dates.at(-1)!)} · ${secs(performance.now() - t)} s`);

  t = performance.now();
  const fp = fingerprint(bars);
  let pe = caches.prep.get(ticker);
  const reusedPrep = pe?.fp === fp;
  if (!pe || !reusedPrep) {
    const prep = prepare(bars);
    pe = { fp, prep, ctx: trendContext(prep) };
    caches.prep.set(ticker, pe);
  }
  await say(`${name}: ${KEYS.length} strategies ${reusedPrep ? "reused (prices unchanged)" : "computed"} · ${secs(performance.now() - t)} s`);

  t = performance.now();
  const day = istDay(Date.now());
  let de = caches.day.get(ticker);
  const reusedDay = de?.day === day;
  if (!de || !reusedDay) {
    const full = analyse(bars, { prep: pe.prep, rules: approved(pe.prep) });
    const plans: Analysis["plans"] = {};
    for (const [h, x] of Object.entries(full.plans)) {
      plans[h] = { ...x, takeProfit: x.takeProfit ? { ...x.takeProfit, on: false } : null }; // take-profit OFF
    }
    de = { day, rules: full.rules, plans, start: full.start, recent: full.recent };
    caches.day.set(ticker, de);
  }
  const used = Object.values(de.rules).reduce((s, r) => s + r.ok.length, 0);
  await say(`${name}: strategy test ${reusedDay ? "reused from today" : `run on ${pe.prep.dates.length.toLocaleString("en-IN")} days`}, ` +
    `${used} strategy picks across ${Object.keys(de.rules).length} time frames · ${secs(performance.now() - t)} s`);

  const a: Analysis = { prep: pe.prep, ctx: pe.ctx, rules: de.rules, plans: de.plans, start: de.start, recent: de.recent };
  return { name, ticker, bars, a };
}

export const MARKET_LIST = Object.keys(MARKETS);
export const STEPS_PER_MARKET = 3;
