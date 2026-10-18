/**
 * Chart data (GET /api/chart): candles for 1m / 5m (Yahoo intraday), 1d (the daily history), 1w / 1mo (resampled
 * from the daily history), plus markers:
 * - 1d: days where a rule in use for the selected plan fired. "BUY" = the plan's full signal (rules, then the
 *   volume and higher-timeframe filters it uses) — what the advice would have said that day; grey = a rule fired but
 *   a tested filter blocked it. Daily chart patterns are marked too (they are part of the tested rule set).
 * - 1m / 5m / 1w / 1mo: chart-pattern hits on those bars, labelled "pattern, not tested".
 */
import { fetchIntraday, type Candle } from "../data/yahoo.ts";
import { bookSignals, LABELS } from "../engine/bookRules.ts";
import { applyHtf } from "../engine/htf.ts";
import { PATTERN_KEYS } from "../engine/patterns.ts";
import { monthly, weekly } from "../engine/resample.ts";
import { planSignal } from "../engine/trades.ts";
import type { Bars, Flags } from "../engine/index.ts";
import { getBars, loadMarket, tickerOf } from "./markets.ts";

export const TIMEFRAMES = ["1m", "5m", "1d", "1w", "1mo"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface ChartMarker { time: number | string; kind: "buy" | "filtered" | "pattern"; text: string }
export interface ChartResponse {
  market: string;
  tf: Timeframe;
  plan: string;
  /** Unix seconds (UTC) for 1m/5m; "YYYY-MM-DD" (last session of the bar) for 1d/1w/1mo. */
  candles: [number | string, number, number, number, number][];
  markers: ChartMarker[];
  note: string;
}

const INTRADAY = { "1m": { interval: "1m", days: 5 }, "5m": { interval: "5m", days: 30 } } as const;
const INTRADAY_MAX_AGE = 30_000;

const g = globalThis as unknown as { __advisorIntraday?: Map<string, { at: number; candles: Candle[] }> };
const intraCache = (g.__advisorIntraday ??= new Map());

async function intraday(ticker: string, tf: "1m" | "5m"): Promise<Candle[]> {
  const key = `${ticker}|${tf}`;
  const hit = intraCache.get(key);
  if (hit && Date.now() - hit.at < INTRADAY_MAX_AGE) return hit.candles;
  const { interval, days } = INTRADAY[tf];
  const candles = await fetchIntraday(ticker, interval, days);
  intraCache.set(key, { at: Date.now(), candles });
  return candles;
}

const shortName = (key: string) => LABELS[key].replace(/\s*\(.*\)$/, "");

/** Pattern markers on any bars (sig computed here, or passed in). */
function patternMarkers(times: (number | string)[], sigs: Record<string, Flags>, tested: boolean): ChartMarker[] {
  const out: ChartMarker[] = [];
  for (let i = 0; i < times.length; i++) {
    const hits = PATTERN_KEYS.filter((p) => sigs[p]?.[i]).map(shortName);
    if (hits.length) out.push({ time: times[i], kind: "pattern", text: hits.join(", ") + (tested ? "" : " — pattern, not tested") });
  }
  return out;
}

const toBars = (c: Candle[]): Bars => ({
  dates: c.map((x) => String(x.time)), open: c.map((x) => x.open), high: c.map((x) => x.high),
  low: c.map((x) => x.low), close: c.map((x) => x.close), volume: c.map((x) => x.volume),
});

const r2 = (x: number) => Math.round(x * 100) / 100; // prices are quoted to 2 decimals; keeps the response small
const rows = (times: (number | string)[], b: Bars): ChartResponse["candles"] =>
  times.map((t, i) => [t, r2(b.open[i]), r2(b.high[i]), r2(b.low[i]), r2(b.close[i])]);

export async function chartData(market: string, tf: Timeframe, plan: string): Promise<ChartResponse> {
  const ticker = tickerOf(market);
  if (tf === "1m" || tf === "5m") {
    const c = await intraday(ticker, tf);
    const b = toBars(c);
    const times = c.map((x) => x.time);
    return {
      market, tf, plan, candles: rows(times, b), markers: patternMarkers(times, bookSignals(b), false),
      note: `Last ${INTRADAY[tf].days} days of ${tf} candles (IST). Dots: chart patterns on these candles — not tested (zoom in to see names).`,
    };
  }
  if (tf === "1w" || tf === "1mo") {
    const { bars } = await getBars(ticker);
    const r = tf === "1w" ? weekly(bars) : monthly(bars);
    return {
      market, tf, plan, candles: rows(r.bars.dates, r.bars), markers: patternMarkers(r.bars.dates, bookSignals(r.bars), false),
      note: `${tf === "1w" ? "Weekly" : "Monthly"} candles from the daily prices (the last one is still forming). Dots: chart patterns — not tested (zoom in to see names).`,
    };
  }
  // daily: the plan's rules
  const { a } = await loadMarket(market);
  const { prep, rules, ctx } = a;
  const p = rules[plan];
  const markers: ChartMarker[] = [];
  if (p) {
    const any = new Array<boolean>(prep.close.length).fill(false);
    for (const r of p.ok) prep.signals[r.key].forEach((x, i) => { if (x) any[i] = true; });
    const full = applyHtf(planSignal(prep, p), ctx, a.plans[plan]?.htf?.pick ?? null);
    for (let i = 0; i < any.length; i++) {
      if (any[i]) markers.push({ time: prep.dates[i], kind: full[i] ? "buy" : "filtered", text: full[i] ? "BUY" : "" });
    }
  }
  const pats = patternMarkers(prep.dates, prep.signals, true);
  return {
    market, tf, plan, candles: rows(prep.dates, prep), markers: mergeByTime(markers, pats),
    note: p && p.ok.length
      ? `Arrows: days a rule in use for the ${plan} plan fired (green = BUY: passed the tested filters, grey = blocked by a filter). Dots: chart patterns (zoom in to see names).`
      : `No rule is in use for the ${plan} plan here (NO TRADE). Dots: chart patterns (zoom in to see names).`,
  };
}

/** Markers must be sorted by time for the chart. */
function mergeByTime(a: ChartMarker[], b: ChartMarker[]): ChartMarker[] {
  return [...a, ...b].sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
}
