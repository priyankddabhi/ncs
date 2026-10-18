/**
 * Walk-forward backtest since 2024, run from the web folder:  node --no-warnings scripts/backtest.ts
 * - ₹50 lakh, ₹5,55,556 per slot (3 markets × 3 plans), no compounding, 0.1% cost per trade.
 * - No peeking: on the first trading day of every month the bot re-picks its rules, volume filter, trend filter and
 *   exit using only candles up to the day before. Signals inside the month use only past candles (all indicators look back).
 * - Buy at the next open; sell at the open after 1 / 5 / 21 sessions, or the plan's 20-day-low exit, or the stop-loss.
 * - Stop-loss checked on 5-minute candles where Yahoo still has them (last ~60 days), otherwise on the day's open/low.
 * - Four stop-loss versions are compared, plus simply holding the same ₹50 lakh split 3 ways.
 */
import { fetchDaily, fetchIntraday, type Candle } from "../src/lib/data/yahoo.ts";
import { analyse } from "../src/lib/engine/extended.ts";
import { applyHtf, trendContext } from "../src/lib/engine/htf.ts";
import { prepare } from "../src/lib/engine/index.ts";
import { HORIZONS } from "../src/lib/engine/names.ts";
import { planSignal } from "../src/lib/engine/trades.ts";
import type { Bars, Flags } from "../src/lib/engine/types.ts";

const FROM = "2024-01-01", CAPITAL = 50_00_000, SIZE = CAPITAL / 9, COST = 0.001;
const PEEK = process.argv.includes("--peek");
const MARKETS: [string, string, number][] = [["Nifty", "^NSEI", 19800], ["Sensex", "^BSESN", 19800], ["Crude", "BZ=F", -14400]];
const SMART: Record<string, Record<string, number>> = {
  Nifty: { "1 day": 0.03, "1 week": 0.05, "1 month": 0.08 },
  Sensex: { "1 day": 0.03, "1 week": 0.05, "1 month": 0.08 },
  Crude: { "1 day": 0.05, "1 week": 0.08, "1 month": 0.12 },
};
const VERSIONS: [string, (m: string, h: string) => number][] = [
  ["A · no stop-loss", () => 0],
  ["B · fixed 15%", () => 0.15],
  ["C · smart stop", (m, h) => SMART[m][h]],
  ["D · tight 3%", () => 0.03],
];

const slice = (b: Bars, end: number): Bars => ({
  dates: b.dates.slice(0, end + 1), open: b.open.slice(0, end + 1), high: b.high.slice(0, end + 1),
  low: b.low.slice(0, end + 1), close: b.close.slice(0, end + 1), volume: b.volume.slice(0, end + 1),
});
const rs = (x: number) => (x < 0 ? "−₹" : "+₹") + Math.round(Math.abs(x)).toLocaleString("en-IN");

interface Market { name: string; bars: Bars; signals: Record<string, Flags>; low20: Record<string, boolean[]>; intraday: Map<string, Candle[]> }
interface Trade { market: string; plan: string; e: number; x: number; buy: number; sell: number; why: string; pnl: number }

// ---------- 1. data + month-by-month picks (no peeking) ----------
const markets: Market[] = [];
for (const [name, tk, offset] of MARKETS) {
  const bars = await fetchDaily(tk);
  const prep = prepare(bars);          // signals are causal: day t only uses candles up to t
  const ctx = trendContext(prep);
  const n = bars.dates.length;
  const signals: Record<string, Flags> = {}, low20: Record<string, boolean[]> = {};
  for (const h of Object.keys(HORIZONS)) { signals[h] = new Array(n).fill(false); low20[h] = new Array(n).fill(false); }
  const first = bars.dates.findIndex((d) => d >= FROM);
  let peekA: ReturnType<typeof analyse> | undefined;
  for (let m = first; m < n; ) {
    const month = bars.dates[m].slice(0, 7);
    let end = m;
    while (end + 1 < n && bars.dates[end + 1].slice(0, 7) === month) end++;
    // picks from candles before this month only; with --peek, today's picks (uses the future: for comparison only)
    const a = PEEK ? (peekA ??= analyse(bars)) : analyse(slice(bars, m - 1));
    for (const h of Object.keys(HORIZONS)) {
      const plan = a.rules[h];
      if (!plan.ok.length) continue;
      const sig = applyHtf(planSignal(prep, plan), ctx, a.plans[h].htf?.pick ?? null);
      for (let i = m; i <= end; i++) { signals[h][i] = sig[i]; low20[h][i] = plan.exit === "low20"; }
    }
    m = end + 1;
  }
  const intraday = new Map<string, Candle[]>();
  for (const c of await fetchIntraday(tk, "5m", 59)) {
    const d = new Date((c.time + offset) * 1000).toISOString().slice(0, 10);
    (intraday.get(d) ?? intraday.set(d, []).get(d)!).push(c);
  }
  markets.push({ name, bars, signals, low20, intraday });
}

// ---------- 2. trade every version ----------
function run(stopOf: (m: string, h: string) => number): Trade[] {
  const out: Trade[] = [];
  for (const mk of markets) {
    const b = mk.bars, last = b.dates.length - 1, first = b.dates.findIndex((d) => d >= FROM);
    for (const [h, n] of Object.entries(HORIZONS)) {
      const sp = stopOf(mk.name, h);
      for (let t = first; t < last; ) {
        if (!mk.signals[h][t]) { t++; continue; }
        const e = t + 1, buy = b.open[e], stop = sp ? buy * (1 - sp) : -Infinity;
        let sell = NaN, x = Math.min(e + n, last), why = "plan over";
        for (let j = e; j <= Math.min(e + n - 1, last) && Number.isNaN(sell); j++) {
          const path = mk.intraday.get(b.dates[j]);
          if (path?.length) {
            for (const c of path) if (c.low <= stop) { sell = Math.min(c.open, stop); x = j; why = "stop-loss"; break; }
          } else if (b.low[j] <= stop) { sell = j > e ? Math.min(b.open[j], stop) : stop; x = j; why = "stop-loss"; }
          if (Number.isNaN(sell) && mk.low20[h][t] && j >= 20) {
            const l20 = Math.min(...b.low.slice(j - 20, j));
            if (b.low[j] < l20) { sell = Math.min(b.open[j], l20); x = j; why = "20-day low"; }
          }
        }
        if (Number.isNaN(sell)) {
          if (e + n <= last) { sell = b.open[e + n]; x = e + n; } else { sell = b.close[last]; x = last; why = "still open"; }
        }
        out.push({ market: mk.name, plan: h, e, x, buy, sell, why, pnl: (SIZE / buy) * (sell - buy) - SIZE * COST });
        t = x;
      }
    }
  }
  return out;
}

// ---------- 3. ₹50 lakh day by day (for the worst fall) ----------
const allDates = [...new Set(markets.flatMap((m) => m.bars.dates.filter((d) => d >= FROM)))].sort();
function closeOn(mk: Market, date: string): number {
  let lo = 0, hi = mk.bars.dates.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mk.bars.dates[mid] <= date) lo = mid; else hi = mid - 1; }
  return mk.bars.close[lo];
}
function worstFall(trades: Trade[]): number {
  let peak = CAPITAL, worst = 0;
  for (const d of allDates) {
    let eq = CAPITAL;
    for (const tr of trades) {
      const mk = markets.find((m) => m.name === tr.market)!;
      const bd = mk.bars.dates[tr.e], sd = mk.bars.dates[tr.x];
      if (d < bd) continue;
      eq += d >= sd ? tr.pnl : (SIZE / tr.buy) * (closeOn(mk, d) - tr.buy) - SIZE * COST;
    }
    peak = Math.max(peak, eq);
    worst = Math.min(worst, eq / peak - 1);
  }
  return worst * 100;
}

const years = (Date.parse(allDates.at(-1)!) - Date.parse(allDates[0])) / (365.25 * 864e5);
console.log(`\nBACKTEST ${allDates[0]} → ${allDates.at(-1)} (${years.toFixed(1)} years) · ₹50 lakh · ₹${Math.round(SIZE).toLocaleString("en-IN")} per slot · no peeking (rules re-picked monthly)\n`);
console.log("Version | Profit | Return per year | Worst fall of ₹50 lakh | Trades / won | Stops hit");
const per: Record<string, Trade[]> = {};
for (const [label, f] of VERSIONS) {
  const tr = run(f);
  per[label] = tr;
  const p = tr.reduce((s, t) => s + t.pnl, 0);
  if (label.startsWith("A")) console.log(`  (costs paid in version A: ${rs(-tr.length * SIZE * COST)}; profit before costs ${rs(p + tr.length * SIZE * COST)})`);
  console.log(`${label} | ${rs(p)} | ${(p / CAPITAL / years * 100).toFixed(2)}% | ${worstFall(tr).toFixed(2)}% | ${tr.length} / ${Math.round(tr.filter((t) => t.pnl > 0).length / tr.length * 100)}% | ${tr.filter((t) => t.why === "stop-loss").length}`);
}
// just hold
const holdTrades: Trade[] = markets.map((mk) => {
  const b = mk.bars, e = b.dates.findIndex((d) => d >= FROM), x = b.dates.length - 1;
  return { market: mk.name, plan: "hold", e, x, buy: b.open[e], sell: b.close[x], why: "hold", pnl: (CAPITAL / 3) * (b.close[x] / b.open[e] - 1) };
});
const hp = holdTrades.reduce((s, t) => s + t.pnl, 0);
const holdFall = (() => {
  let peak = CAPITAL, worst = 0;
  for (const d of allDates) {
    const eq = CAPITAL + holdTrades.reduce((s, t) => { const mk = markets.find((m) => m.name === t.market)!; return s + (CAPITAL / 3) * (closeOn(mk, d) / t.buy - 1); }, 0);
    peak = Math.max(peak, eq); worst = Math.min(worst, eq / peak - 1);
  }
  return worst * 100;
})();
console.log(`Just hold ₹50 lakh (split 3 ways) | ${rs(hp)} | ${(hp / CAPITAL / years * 100).toFixed(2)}% | ${holdFall.toFixed(2)}% | – | –`);

console.log("\nProfit by market and plan (version C · smart stop):");
for (const mk of markets) console.log(mk.name + ": " + Object.keys(HORIZONS).map((h) => {
  const t = per["C · smart stop"].filter((x) => x.market === mk.name && x.plan === h);
  return `${h} ${rs(t.reduce((s, x) => s + x.pnl, 0))} (${t.length})`;
}).join(" · "));
