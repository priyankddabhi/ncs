/**
 * Paper-trading replay of the last 2 weeks, run from the web folder:  node --no-warnings scripts/replay.ts [stopPct]
 * - Start: ₹50,00,000, split equally over the 9 slots (≈ ₹5,55,556 per trade). Stop-loss = buy price × (1 − stopPct), default 15%.
 * - All 3 markets × 3 plans run side by side (one open trade per market × plan).
 * - No peeking: on each past day the bot only sees candles up to that day and re-picks its rules from them.
 * - Buy at the next session's open; sell at the open after the plan length (1 / 5 / 21 sessions) or by the plan's
 *   tested 20-day-low exit; the stop-loss is checked inside the day on 5-minute candles.
 * - Trades still open at the end are valued at the last close. Crude % moves are applied to ₹ (USD/INR ignored).
 */
import { fetchDaily, fetchIntraday, type Candle } from "../src/lib/data/yahoo.ts";
import { analyse } from "../src/lib/engine/extended.ts";
import { HORIZONS } from "../src/lib/engine/names.ts";
import type { Bars } from "../src/lib/engine/types.ts";

const START_DECISION = "2026-10-02"; // decisions from this close on; first buys at the next open
const CAPITAL = 50_00_000, COST = 0.001;
const STOP = Number(process.argv[2] ?? 0.15);
const SIZE = CAPITAL / 9; // ₹50 lakh split equally over the 9 slots (3 markets × 3 plans)
const MARKETS: [string, string, number][] = [["Nifty 50", "^NSEI", 19800], ["Sensex", "^BSESN", 19800], ["Crude oil (Brent)", "BZ=F", -14400]];

const slice = (b: Bars, end: number): Bars => ({
  dates: b.dates.slice(0, end + 1), open: b.open.slice(0, end + 1), high: b.high.slice(0, end + 1),
  low: b.low.slice(0, end + 1), close: b.close.slice(0, end + 1), volume: b.volume.slice(0, end + 1),
});
const rupees = (x: number) => (x < 0 ? "−₹" : "+₹") + Math.round(Math.abs(x)).toLocaleString("en-IN");

interface Trade { market: string; plan: string; buyDate: string; buy: number; sellDate: string; sell: number; why: string; pnl: number; low: number; high: number }
const trades: Trade[] = [];
const holdBench: { market: string; pnl: number }[] = [];

for (const [name, tk, offset] of MARKETS) {
  const bars = await fetchDaily(tk);
  const intraday: Candle[] = await fetchIntraday(tk, "5m", 30);
  const byDay = new Map<string, Candle[]>();
  for (const c of intraday) {
    const d = new Date((c.time + offset) * 1000).toISOString().slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(c);
  }
  const last = bars.dates.length - 1;
  const first = bars.dates.findIndex((d) => d >= START_DECISION);

  // one decision run per past day, each seeing only candles up to that day
  const decisions = new Map<number, ReturnType<typeof analyse>>();
  for (let t = first; t <= last; t++) decisions.set(t, analyse(slice(bars, t)));

  for (const [plan, n] of Object.entries(HORIZONS)) {
    let t = first;
    while (t < last) {
      const a = decisions.get(t)!;
      const p = a.plans[plan];
      if (!p.signal[t]) { t++; continue; }
      const e = t + 1, buy = bars.open[e], stop = buy * (1 - STOP);
      const qty = SIZE / buy;
      let sell = NaN, sellI = Math.min(e + n, last), why = "plan over";
      let lo = Infinity, hi = -Infinity;
      for (let j = e; j <= Math.min(e + n - 1, last); j++) {
        const candles = byDay.get(bars.dates[j]) ?? [];
        // stop-loss inside the day (5-minute candles; daily low if that day has no 5-minute data)
        const path = candles.length ? candles : [{ open: bars.open[j], low: bars.low[j], high: bars.high[j] } as Candle];
        let hit = false;
        for (const c of path) {
          lo = Math.min(lo, c.low); hi = Math.max(hi, c.high);
          if (c.low <= stop) { sell = Math.min(c.open, stop); sellI = j; why = "stop-loss"; hit = true; break; }
        }
        if (hit) break;
        if (p.exit.low20 && a.prep.low20[j] !== undefined) {
          const l20 = Math.min(...bars.low.slice(Math.max(0, j - 20), j));
          if (bars.low[j] < l20) { sell = Math.min(bars.open[j], l20); sellI = j; why = "20-day-low exit"; break; }
        }
      }
      if (Number.isNaN(sell)) {
        if (e + n <= last) { sell = bars.open[e + n]; sellI = e + n; }
        else { sell = bars.close[last]; sellI = last; why = "still open (valued at 16 Oct close)"; }
      }
      const pnl = qty * (sell - buy) - SIZE * COST;
      trades.push({ market: name, plan, buyDate: bars.dates[e], buy, sellDate: bars.dates[sellI], sell, why, pnl,
        low: (lo / buy - 1) * 100, high: (hi / buy - 1) * 100 });
      t = sellI; // the bot can buy again from the day it sold
    }
  }
  const b0 = bars.open[first + 1], b1 = bars.close[last];
  holdBench.push({ market: name, pnl: (CAPITAL / 3) * (b1 / b0 - 1) }); // same ₹50 lakh, split 3 ways, just held
}

// ----- report -----
console.log(`\nREPLAY ${START_DECISION} → 16 Oct · ₹50 lakh · ₹${Math.round(SIZE).toLocaleString("en-IN")} per trade · stop-loss ${STOP * 100}% below the buy price\n`);
console.log("market | plan | buy date | sell date | reason | worst/best inside the trade | profit");
for (const x of trades)
  console.log(`${x.market} | ${x.plan} | ${x.buyDate} @ ${x.buy.toFixed(2)} | ${x.sellDate} @ ${x.sell.toFixed(2)} | ${x.why} | ${x.low.toFixed(2)}% / +${x.high.toFixed(2)}% | ${rupees(x.pnl)}`);
const total = trades.reduce((s, x) => s + x.pnl, 0);
const wins = trades.filter((x) => x.pnl > 0).length;
console.log(`\nTRADES ${trades.length} · WON ${wins} · STOPS HIT ${trades.filter((x) => x.why === "stop-loss").length}`);
console.log(`PROFIT ${rupees(total)} · END BALANCE ₹${Math.round(CAPITAL + total).toLocaleString("en-IN")} · RETURN ${(total / CAPITAL * 100).toFixed(3)}% of ₹50 lakh`);
console.log(`MAX MONEY IN TRADES AT ONCE ≈ ₹${Math.round(SIZE * Math.max(...trades.map((x) => trades.filter((y) => y.buyDate <= x.buyDate && y.sellDate > x.buyDate).length))).toLocaleString("en-IN")}`);
const hold = holdBench.reduce((s, h) => s + h.pnl, 0);
console.log("Just holding the same ₹50 lakh (split 3 ways): " + holdBench.map((h) => `${h.market} ${rupees(h.pnl)}`).join(" · ") +
  ` · TOTAL ${rupees(hold)} (${(hold / CAPITAL * 100).toFixed(2)}%)`);
