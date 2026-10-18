/**
 * Price data from Yahoo Finance (yahoo-finance2, unofficial API), cleaned like the Python bot's core._clean:
 * rows with a missing or non-positive open/high/low/close are dropped, missing volume becomes 0,
 * dates are the exchange's local calendar day, and a repeated day keeps its last row.
 */
import YahooFinance from "yahoo-finance2";
import type { Bars } from "../engine/types.ts";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface Candle {
  /** Unix seconds (UTC), as the chart library wants it. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type Quote = { date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null };

const valid = (q: Quote): boolean =>
  [q.open, q.high, q.low, q.close].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0);

/** Full daily history, oldest first, in the engine's Bars format. */
export async function fetchDaily(ticker: string): Promise<Bars> {
  const res = await yf.chart(ticker, { period1: "1990-01-01", interval: "1d" });
  const offsetMs = (res.meta.gmtoffset ?? 0) * 1000; // exchange's UTC offset → local trading day
  const byDay = new Map<string, Quote>();
  for (const q of res.quotes as Quote[]) {
    if (!valid(q)) continue;
    byDay.set(new Date(q.date.getTime() + offsetMs).toISOString().slice(0, 10), q); // last row wins
  }
  const days = [...byDay.keys()].sort();
  if (!days.length) throw new Error(`Yahoo returned no price data for ${ticker}; will retry on the next check`);
  const pick = (f: (q: Quote) => number) => days.map((d) => f(byDay.get(d)!));
  return {
    dates: days,
    open: pick((q) => q.open!),
    high: pick((q) => q.high!),
    low: pick((q) => q.low!),
    close: pick((q) => q.close!),
    volume: pick((q) => q.volume ?? 0),
  };
}

/** Intraday candles for the live chart (Yahoo keeps 1m for ~8 days and 5m for ~60 days). */
export async function fetchIntraday(ticker: string, interval: "1m" | "5m" | "15m" | "1h", days: number): Promise<Candle[]> {
  const res = await yf.chart(ticker, { period1: new Date(Date.now() - days * 864e5), interval });
  return (res.quotes as Quote[]).filter(valid).map((q) => ({
    time: Math.floor(q.date.getTime() / 1000),
    open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume ?? 0,
  }));
}
