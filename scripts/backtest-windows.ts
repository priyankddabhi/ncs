/**
 * Honest test of the current bot in random 1-, 2- and 3-year windows between 2019 and today.
 * Run from the web folder:  node --no-warnings scripts/backtest-windows.ts [stopPct=0.03] [seed=2026]
 * - No peeking: every month since 2019 the bot re-picks its rules, volume filter, trend filter and exit using only
 *   candles before that month. Signals inside a month only use past candles.
 * - Each window starts with ₹50 lakh, ₹5,55,556 per slot (3 markets × 3 plans), no compounding, 0.1% cost per trade.
 * - Buy at the next open; sell at the open after 1 / 5 / 21 sessions, or the plan's 20-day-low exit, or the stop-loss
 *   (strict: the day's low touching buy × (1 − stop) sells at the stop, or at the open if it gapped below).
 * - Trades still open when a window ends are sold at that day's close.
 */
import { fetchDaily } from "../src/lib/data/yahoo.ts";
import { analyse } from "../src/lib/engine/extended.ts";
import { applyHtf, trendContext, type TrendContext } from "../src/lib/engine/htf.ts";
import { sma } from "../src/lib/engine/indicators.ts";
import { prepare } from "../src/lib/engine/index.ts";
import { HORIZONS } from "../src/lib/engine/names.ts";
import { planSignal } from "../src/lib/engine/trades.ts";
import type { Bars, Flags } from "../src/lib/engine/types.ts";

const FROM = "2019-01-01", CAPITAL = 50_00_000, SIZE = CAPITAL / 9, COST = 0.001;
const STOP = Number(process.argv[2] ?? 0.03), SEED = Number(process.argv[3] ?? 2026);
const MARKETS: [string, string][] = [["Nifty", "^NSEI"], ["Sensex", "^BSESN"], ["Crude", "BZ=F"]];
const PLANS = Object.keys(HORIZONS);

const slice = (b: Bars, end: number): Bars => ({
  dates: b.dates.slice(0, end + 1), open: b.open.slice(0, end + 1), high: b.high.slice(0, end + 1),
  low: b.low.slice(0, end + 1), close: b.close.slice(0, end + 1), volume: b.volume.slice(0, end + 1),
});
const rs = (x: number) => (x < 0 ? "−₹" : "+₹") + Math.round(Math.abs(x)).toLocaleString("en-IN");

interface Market { name: string; bars: Bars; signals: Record<string, Flags>; low20: Record<string, boolean[]>; ctx: TrendContext; s200: number[] }

// ---------- 1. month-by-month picks since 2019 (no peeking) ----------
const markets: Market[] = [];
for (const [name, tk] of MARKETS) {
  const bars = await fetchDaily(tk);
  const prep = prepare(bars), ctx = trendContext(prep), n = bars.dates.length;
  const signals: Record<string, Flags> = {}, low20: Record<string, boolean[]> = {};
  for (const h of PLANS) { signals[h] = new Array(n).fill(false); low20[h] = new Array(n).fill(false); }
  for (let m = bars.dates.findIndex((d) => d >= FROM); m < n; ) {
    const month = bars.dates[m].slice(0, 7);
    let end = m;
    while (end + 1 < n && bars.dates[end + 1].slice(0, 7) === month) end++;
    const a = analyse(slice(bars, m - 1)); // only candles before this month
    for (const h of PLANS) {
      const plan = a.rules[h];
      if (!plan.ok.length) continue;
      const sig = applyHtf(planSignal(prep, plan), ctx, a.plans[h].htf?.pick ?? null);
      for (let i = m; i <= end; i++) { signals[h][i] = sig[i]; low20[h][i] = plan.exit === "low20"; }
    }
    m = end + 1;
  }
  markets.push({ name, bars, signals, low20, ctx, s200: sma(bars.close, 200) });
  console.error(`picked rules month by month for ${name}`);
}

// ---------- 2. one window ----------
interface Result { plan: Record<string, number>; trades: number; won: number; stops: number; hold: number }
function runWindow(from: string, to: string): Result {
  const plan: Record<string, number> = Object.fromEntries(PLANS.map((h) => [h, 0]));
  let trades = 0, won = 0, stops = 0, hold = 0;
  for (const mk of markets) {
    const b = mk.bars;
    const s = b.dates.findIndex((d) => d >= from);
    let E = b.dates.length - 1;
    while (b.dates[E] > to) E--;
    hold += (CAPITAL / 3) * (b.close[E] / b.open[s] - 1);
    for (const [h, n] of Object.entries(HORIZONS)) {
      for (let t = s; t < E; ) {
        if (!mk.signals[h][t]) { t++; continue; }
        const e = t + 1, buy = b.open[e], stop = buy * (1 - STOP);
        let sell = NaN, x = e + n, why = "plan";
        for (let j = e; j < e + n && j <= E && Number.isNaN(sell); j++) {
          if (j > e && b.open[j] <= stop) { sell = b.open[j]; x = j; why = "stop"; }
          else if (b.low[j] <= stop) { sell = stop; x = j; why = "stop"; }
          else if (mk.low20[h][t] && j >= 20) {
            const l20 = Math.min(...b.low.slice(j - 20, j));
            if (b.low[j] < l20) { sell = Math.min(b.open[j], l20); x = j; why = "low20"; }
          }
        }
        if (Number.isNaN(sell)) {
          if (x <= E) sell = b.open[x]; else { x = E; sell = b.close[E]; why = "window end"; }
        }
        const pnl = (SIZE / buy) * (sell - buy) - SIZE * COST;
        plan[h] += pnl; trades++; if (pnl > 0) won++; if (why === "stop") stops++;
        t = x;
      }
    }
  }
  return { plan, trades, won, stops, hold };
}

// ---------- 2b. the mix: stay invested in each market, move to cash when the bot's trend detector says DOWN ----------
type MixKind = "daily" | "week" | "sma200";
const MIX_LABEL: Record<MixKind, string> = { daily: "Mix · daily trend", week: "Mix · weekly trend", sma200: "Mix · 200-day avg" };
function isOut(mk: Market, kind: MixKind, t: number): boolean {
  if (kind === "daily") return mk.ctx.dailyTrend[t] === "DOWN";
  if (kind === "week") return mk.ctx.weekTrendByDay[t] === "DOWN";
  return mk.bars.close[t] < mk.s200[t]; // false while the average is warming up (NaN)
}
function runMix(from: string, to: string, kind: MixKind): { pnl: number; switches: number } {
  let pnl = 0, switches = 0;
  for (const mk of markets) {
    const b = mk.bars, C = CAPITAL / 3;
    const s = b.dates.findIndex((d) => d >= from);
    let E = b.dates.length - 1;
    while (b.dates[E] > to) E--;
    // the decision made at the close of day t is carried out at the open of day t + 1 (no peeking)
    let inv = !isOut(mk, kind, s - 1), cash = C, units = 0;
    if (inv) { units = (cash * (1 - COST)) / b.open[s]; cash = 0; }
    for (let t = s; t < E; t++) {
      const want = !isOut(mk, kind, t);
      if (want === inv) continue;
      if (want) { units = (cash * (1 - COST)) / b.open[t + 1]; cash = 0; }
      else { cash = units * b.open[t + 1] * (1 - COST); units = 0; }
      inv = want; switches++;
    }
    pnl += cash + units * b.close[E] - C;
  }
  return { pnl, switches };
}

// ---------- 3. random windows (fixed seed, so the run can be repeated) ----------
let seed = SEED >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const lastDate = markets[0].bars.dates.at(-1)!;
const addYears = (d: string, y: number) => `${Number(d.slice(0, 4)) + y}${d.slice(4)}`;
const windows: [number, string, string][] = [];
for (const years of [1, 2, 3]) {
  const latestStart = Date.parse(addYears(lastDate, -years)), earliest = Date.parse(FROM);
  for (let k = 0; k < 3; k++) {
    const from = new Date(earliest + rand() * (latestStart - earliest)).toISOString().slice(0, 10);
    windows.push([years, from, addYears(from, years)]);
  }
}

console.log(`\nHONEST TEST · random windows 2019–${lastDate} · ₹50 lakh each · strict stop-loss ${STOP * 100}% · seed ${SEED}\n`);
console.log("Length | Window | 1 day | 1 week | 1 month | Bot total | Bot % | Trades (won) | Stops | Just hold");
const sum: Record<number, { bot: number; hold: number; plan: Record<string, number> }> = {};
for (const [years, from, to] of windows) {
  const r = runWindow(from, to);
  const tot = PLANS.reduce((s, h) => s + r.plan[h], 0);
  sum[years] ??= { bot: 0, hold: 0, plan: Object.fromEntries(PLANS.map((h) => [h, 0])) };
  sum[years].bot += tot; sum[years].hold += r.hold;
  for (const h of PLANS) sum[years].plan[h] += r.plan[h];
  console.log(`${years} yr | ${from} → ${to} | ${PLANS.map((h) => rs(r.plan[h])).join(" | ")} | ${rs(tot)} | ${(tot / CAPITAL * 100).toFixed(1)}% | ${r.trades} (${r.won}) | ${r.stops} | ${rs(r.hold)} (${(r.hold / CAPITAL * 100).toFixed(1)}%)`);
}
const KINDS: MixKind[] = ["daily", "week", "sma200"];
const pct = (x: number) => `${(x / CAPITAL * 100).toFixed(1)}%`;
console.log("\nMIX vs BOT vs HOLD (profit on ₹50 lakh per window)\n");
console.log(`Length | Window | Bot only | ${KINDS.map((k) => MIX_LABEL[k]).join(" | ")} | Just hold`);
const agg: Record<number, Record<string, number[]>> = {};
for (const [years, from, to] of windows) {
  const r = runWindow(from, to);
  const bot = PLANS.reduce((s, h) => s + r.plan[h], 0);
  const mixes = KINDS.map((k) => runMix(from, to, k));
  const row: Record<string, number> = { bot, hold: r.hold, ...Object.fromEntries(KINDS.map((k, i) => [k, mixes[i].pnl])) };
  agg[years] ??= {};
  for (const [k, v] of Object.entries(row)) (agg[years][k] ??= []).push(v);
  console.log(`${years} yr | ${from} → ${to} | ${rs(bot)} (${pct(bot)}) | ` +
    mixes.map((m) => `${rs(m.pnl)} (${pct(m.pnl)}, ${m.switches} switches)`).join(" | ") + ` | ${rs(r.hold)} (${pct(r.hold)})`);
}
console.log("\nAverage / worst window:");
for (const y of [1, 2, 3]) {
  const f = (k: string) => { const v = agg[y][k]; const avg = v.reduce((a, b) => a + b, 0) / v.length; return `${pct(avg)} / ${pct(Math.min(...v))}`; };
  console.log(`${y} yr | bot ${f("bot")} | ${KINDS.map((k) => `${MIX_LABEL[k]} ${f(k)}`).join(" | ")} | hold ${f("hold")}`);
}

console.log("\nAverage per window (bot only, by plan):");
for (const y of [1, 2, 3]) {
  const s = sum[y];
  console.log(`${y} yr | ${PLANS.map((h) => rs(s.plan[h] / 3)).join(" | ")} | bot ${rs(s.bot / 3)} (${(s.bot / 3 / CAPITAL * 100).toFixed(1)}%) | just hold ${rs(s.hold / 3)} (${(s.hold / 3 / CAPITAL * 100).toFixed(1)}%)`);
}
