/**
 * Step-2 check: trend / higher-timeframe filter / prediction / take-profit / reasoning chain on the frozen fixtures.
 * Also self-checks (trade simulator == picker, resample has no look-ahead) and re-runs scripts/parity.ts.
 *
 * Run from the web folder:  node --no-warnings scripts/step2-check.ts [fixture-folder]
 * Exit code 0 only when everything ran and every check passed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixedHold, holdLow20, HORIZONS } from "../src/lib/engine/index.ts";
import type { Bars, Stats } from "../src/lib/engine/index.ts";
import { analyse } from "../src/lib/engine/extended.ts";
import { adviseHolding, buildChain } from "../src/lib/engine/chain.ts";
import { HTF_KINDS } from "../src/lib/engine/htf.ts";
import { periodKey } from "../src/lib/engine/resample.ts";
import { rets, simulate } from "../src/lib/engine/trades.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");
const DEFAULT_DIR =
  "C:\\Users\\priya\\AppData\\Local\\Temp\\claude\\d--dabhim-imp-pd-cr-projects-n-s-c\\aa4b9fa7-99fe-4fa4-b602-5ca3ee3e84a0\\scratchpad\\parity";
const DIR = process.argv[2] ?? process.env.PARITY_DIR ?? DEFAULT_DIR;
const MARKETS = ["NSEI", "BSESN", "BZ_F"];

let failures = 0;
const fail = (msg: string) => { failures++; console.log("  FAIL " + msg); };
const p2 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);
const st = (s: Stats) => `${p2(s.avg)}% (${s.n})`;
const both = (s: [Stats, Stats]) => `${st(s[0])} / ${st(s[1])}`;
const pc = (f: number) => `${(f * 100).toFixed(0)}%`;

for (const m of MARKETS) {
  const path = join(DIR, `${m}.json`);
  if (!existsSync(path)) { fail(`missing fixture ${path}`); continue; }
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const bars: Bars = { dates: fx.dates, open: fx.open, high: fx.high, low: fx.low, close: fx.close, volume: fx.volume };
  const t0 = performance.now();
  const a = analyse(bars);
  const t1 = performance.now();
  const { prep, ctx, start, recent } = a;
  console.log(`\n=================== ${fx.market} — ${bars.dates.length} days to ${bars.dates.at(-1)} (analysis ${(t1 - t0).toFixed(0)} ms)`);

  // ---- self-checks
  for (const [h, n] of Object.entries(HORIZONS)) {
    const x = a.plans[h];
    for (const s0 of [start, recent]) {
      const ref = x.exit.low20 ? holdLow20(x.botSignal, prep.open, prep.low, prep.low20, n, s0) : fixedHold(x.botSignal, prep.open, n, s0);
      const got = rets(simulate(x.botSignal, prep, x.exit, s0));
      if (ref.length !== got.length || ref.some((r, i) => r !== got[i])) fail(`${h}: simulate() differs from picker (${got.length} vs ${ref.length} trades)`);
    }
  }
  for (const r of [ctx.week, ctx.month]) {
    const per = r === ctx.week ? "week" : "month";
    for (let i = 0; i < bars.dates.length; i++) {
      const k = r.lastDone[i];
      if (k < 0) continue;
      if (!(r.bars.dates[k] < bars.dates[i]) || periodKey(r.bars.dates[k], per) === periodKey(bars.dates[i], per)) {
        fail(`${per} look-ahead at ${bars.dates[i]}`);
        break;
      }
    }
    const sumV = r.bars.volume.reduce((s, v) => s + v, 0), sumD = bars.volume.reduce((s, v) => s + v, 0);
    if (Math.abs(sumV - sumD) > 1e-6 * Math.max(1, sumD)) fail(`${per} volume sum mismatch`);
    // aggregation: open first, high max, low min, close last, dated by the last session (source glitches pass through)
    const agg = r.bars.dates.map(() => ({ o: NaN, h: -Infinity, l: Infinity, c: NaN, d: "" }));
    bars.dates.forEach((d, i) => {
      const g = agg[r.dayToBar[i]];
      if (g.o !== g.o) g.o = bars.open[i];
      g.h = Math.max(g.h, bars.high[i]); g.l = Math.min(g.l, bars.low[i]); g.c = bars.close[i]; g.d = d;
    });
    if (agg.some((g, k) => g.o !== r.bars.open[k] || g.h !== r.bars.high[k] || g.l !== r.bars.low[k] || g.c !== r.bars.close[k] || g.d !== r.bars.dates[k])) {
      fail(`${per} aggregation mismatch`);
    }
  }
  console.log(`self-checks: simulate()==picker, ${ctx.week.bars.dates.length} weekly / ${ctx.month.bars.dates.length} monthly bars, no look-ahead`);

  // ---- chain (last bar of the fixture; a fixed time after the close so it is "final")
  const chain = buildChain({ name: fx.market, bars }, new Date("2026-10-16T18:00:00Z"), a);
  console.log(`\nCHAIN ${chain.name} ${chain.date}: ${chain.price.toFixed(2)} (${p2(chain.change)}, ${p2(chain.changePct)}%)` +
    `${chain.dataProblem ? ` [data: ${chain.dataProblem}]` : ""}`);
  console.log(`  trend: daily ${chain.trend.daily} · week of ${chain.trend.weekOf} ${chain.trend.weekly} · month to ${chain.trend.monthOf} ${chain.trend.monthly}`);
  console.log(`  patterns today (tested): ${chain.patterns.daily.hits.map((p) => `${p.name}${p.usedIn.length ? ` [used: ${p.usedIn.join(", ")}]` : " [not approved]"}`).join("; ") || "none"}`);
  console.log(`  patterns last week ${chain.patterns.weekly.date} (not tested): ${chain.patterns.weekly.hits.map((p) => p.name).join("; ") || "none"}`);
  console.log(`  patterns last month ${chain.patterns.monthly.date} (not tested): ${chain.patterns.monthly.hits.map((p) => p.name).join("; ") || "none"}`);
  for (const pl of Object.values(chain.plans)) {
    const f = pl.filters;
    console.log(`  [${pl.plan}] ${pl.decision}  | advise: ${pl.advice[0]} ${pl.advice[1]}`);
    console.log(`     matched: ${pl.matched.map((r) => r.text).join("; ") || "none"}`);
    console.log(`     filters: volume ${f.volume.on ? (f.volume.ok ? "ON ok" : "ON blocks") : "off"} · HTF ${f.htf.pick ? `${f.htf.label} ${f.htf.ok ? "ok" : "blocks"}` : "off"}`);
    console.log(`     exit: ${pl.exit.text}`);
    if (pl.prediction) {
      const q = pl.prediction;
      console.log(`     prediction: target ${q.target.toFixed(2)} (${p2(q.median * 100)}%), range ${q.low.toFixed(2)}..${q.high.toFixed(2)}, P(profit) ${pc(q.probability)}, n=${q.n}`);
    } else console.log(`     prediction: null`);
    console.log(`     reason: ${pl.reason}`);
  }

  // ---- HTF filter / take-profit / prediction tables
  console.log(`\nplan     | HTF tested (daily / week / month: avg since 2010 (n) / since 2019 (n), * = beats) | picked`);
  for (const h of Object.keys(HORIZONS)) {
    const x = a.plans[h];
    if (!x.htf) { console.log(`${h.padEnd(8)} | NO TRADE`); continue; }
    const t = HTF_KINDS.map((k) => `${k}${x.htf!.tested[k].passes ? "*" : ""} ${both(x.htf!.tested[k].after)}`).join(" | ");
    console.log(`${h.padEnd(8)} | before ${both(x.htf.before)} | ${t} | => ${x.htf.pick ?? "none"}: ${both(x.htf.before)} -> ${both(x.htf.after)}`);
  }
  console.log(`\nplan     | take-profit at full-period median (IN-SAMPLE) | before -> after | picked`);
  for (const h of Object.keys(HORIZONS)) {
    const tp = a.plans[h].takeProfit;
    if (!tp) { console.log(`${h.padEnd(8)} | NO TRADE`); continue; }
    console.log(`${h.padEnd(8)} | target ${p2(tp.target * 100)}% | ${both(tp.before)} -> ${both(tp.after)} | ${tp.on ? "ON" : "OFF"}${tp.note ? ` (${tp.note})` : ""}`);
  }
  console.log(`\nplan     | prediction check: learned on trades sold before 2019, measured on 2019+ trades`);
  for (const h of Object.keys(HORIZONS)) {
    const c = a.plans[h].check;
    if (!c) { console.log(`${h.padEnd(8)} | n/a`); continue; }
    console.log(`${h.padEnd(8)} | train n=${c.train.n} median ${p2(c.train.median * 100)}% [${p2(c.train.p25 * 100)}, ${p2(c.train.p75 * 100)}] win ${pc(c.train.win)}` +
      ` | test n=${c.test.n} median ${p2(c.test.median * 100)}% win ${pc(c.test.win)}` +
      ` | in-range ${pc(c.inRange)} | target-hit ${pc(c.targetHit)}${c.train.median <= 0.0005 ? " (target ~entry: trivial)" : ""} | MAE ${(c.mae * 100).toFixed(2)}pp (0%-forecast ${(c.maeZero * 100).toFixed(2)}pp)`);
  }

  // ---- adviseHolding demo: a holding bought 3 sessions before the last bar, on every plan with a positive median
  for (const h of Object.keys(HORIZONS)) {
    const x = a.plans[h];
    if (!x.dist || !(x.dist.median > 0)) continue;
    const b = bars.dates.length - 4;
    const hd = adviseHolding(a, h, { buy_date: bars.dates[b], buy_price: bars.open[b], horizon: h }, false);
    console.log(`holding demo [${h}] bought ${bars.dates[b]} @ ${bars.open[b].toFixed(2)}: ${hd.advice.join(" ")}` +
      ` | target ${hd.targetPrice?.toFixed(2)} reached=${hd.targetReached}${hd.events.map((e) => ` | ${e.icon} ${e.text}`).join("")}`);
    // the ON branch, forced on a copy (no plan picked take-profit on the fixtures, so real data never reaches it)
    if (x.takeProfit && hd.targetReached) {
      const forced = { ...a, plans: { ...a.plans, [h]: { ...x, takeProfit: { ...x.takeProfit, on: true } } } };
      const on = adviseHolding(forced, h, { buy_date: bars.dates[b], buy_price: bars.open[b], horizon: h }, false);
      const okOn = hd.base[0] === "🔴 SELL"
        ? on.advice === on.base && on.events.length === 1
        : on.advice[0] === "🔴 SELL" && on.advice[1].startsWith("Target +") && on.advice[1].includes("reached (predicted): sell now");
      if (!okOn) fail(`${h}: forced take-profit ON gave ${JSON.stringify(on.advice)}`);
      else if (h === "1 week") console.log(`  forced ON [${h}]: ${on.advice.join(" ")}`);
    }
  }
}

// ---- the existing parity test must still pass
console.log("\n--- running scripts/parity.ts");
const r = spawnSync(process.execPath, ["--no-warnings", join(HERE, "parity.ts"), DIR], { cwd: WEB, encoding: "utf8" });
const tail = (r.stdout ?? "").trim().split("\n").at(-1);
console.log(tail);
if (r.status !== 0) fail(`parity.ts exited ${r.status}: ${r.stderr}`);

console.log(`\n${failures === 0 ? "STEP-2 CHECK OK" : `STEP-2 CHECK FAILED: ${failures} problem(s)`}`);
process.exit(failures === 0 ? 0 : 1);
