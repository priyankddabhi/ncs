/**
 * Parity test: the TypeScript engine must reproduce the Python engine's output exactly.
 * Fixtures are written by export_parity.py (Python core.prepare / core.approved / core.advise on frozen data).
 *
 * Run from the web folder:  node scripts/parity.ts [fixture-folder]
 * Exit code 0 only when every check matches.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { advise, approved, KEYS, prepare } from "../src/lib/engine/index.ts";
import type { Approved, Bars, Holding, Plan, RuleRow, Stats } from "../src/lib/engine/index.ts";

const DEFAULT_DIR =
  "C:\\Users\\priya\\AppData\\Local\\Temp\\claude\\d--dabhim-imp-pd-cr-projects-n-s-c\\aa4b9fa7-99fe-4fa4-b602-5ca3ee3e84a0\\scratchpad\\parity";
const DIR = process.argv[2] ?? process.env.PARITY_DIR ?? DEFAULT_DIR;
const MARKETS = ["NSEI", "BSESN", "BZ_F"];
const TOL = 1e-6;

interface Scenario { h: string; holding: Holding | null; provisional: boolean; expect: [string, string] }
interface Fixture {
  market: string; ticker: string; dates: string[];
  open: number[]; high: number[]; low: number[]; close: number[]; volume: number[];
  keys: string[]; signals: Record<string, number[]>; vol_ok: number[]; low20: (number | null)[];
  approved: Approved; advise: Scenario[];
}

let failures = 0;
let statMaxDiff = 0; // largest |ts - py| over every avg / win / r_avg compared in approved (per market)
const fail = (msg: string) => { failures++; console.log("  FAIL " + msg); };
const close = (a: number, b: number) => {
  statMaxDiff = Math.max(statMaxDiff, Math.abs(a - b));
  return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));
};

function compareStats(where: string, ts: Stats, py: Stats): void {
  if (ts.n !== py.n || !close(ts.avg, py.avg) || !close(ts.win, py.win)) {
    fail(`${where}: ts n=${ts.n} avg=${ts.avg} win=${ts.win} | py n=${py.n} avg=${py.avg} win=${py.win}`);
  }
}

function compareRows(where: string, ts: RuleRow[], py: RuleRow[]): void {
  const tk = ts.map((r) => r.key).join(","), pk = py.map((r) => r.key).join(",");
  if (tk !== pk) { fail(`${where} keys/order: ts [${tk}] | py [${pk}]`); return; }
  ts.forEach((r, i) => {
    const p = py[i];
    if (r.n !== p.n || r.r_n !== p.r_n || !close(r.avg, p.avg) || !close(r.win, p.win) || !close(r.r_avg, p.r_avg)) {
      fail(`${where} ${r.key}: ts ${JSON.stringify(r)} | py ${JSON.stringify(p)}`);
    }
  });
}

function comparePlan(h: string, ts: Plan, py: Plan): string {
  compareStats(`${h} market`, ts.market, py.market);
  compareStats(`${h} market_recent`, ts.market_recent, py.market_recent);
  compareRows(`${h} ok`, ts.ok, py.ok);
  compareRows(`${h} dropped`, ts.dropped, py.dropped);
  if (ts.filter !== py.filter) fail(`${h} filter: ts ${ts.filter} | py ${py.filter}`);
  if (ts.exit !== py.exit) fail(`${h} exit: ts ${ts.exit} | py ${py.exit}`);
  return `${h}: ok ${ts.ok.length}, dropped ${ts.dropped.length}, filter ${ts.filter}, exit ${ts.exit}`;
}

let total = 0;
for (const m of MARKETS) {
  const path = join(DIR, `${m}.json`);
  if (!existsSync(path)) { fail(`missing fixture ${path}`); continue; }
  const fx = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  const before = failures;
  console.log(`\n=== ${fx.market} (${fx.ticker}) — ${fx.dates.length} days ${fx.dates[0]} .. ${fx.dates.at(-1)}`);
  const bars: Bars = { dates: fx.dates, open: fx.open, high: fx.high, low: fx.low, close: fx.close, volume: fx.volume };
  const t0 = performance.now();
  const prep = prepare(bars);
  const t1 = performance.now();

  // 1. signals: the 38 keys + vol_ok, day by day
  if (fx.keys.join(",") !== KEYS.join(",")) fail(`key list differs: py ${fx.keys.join(",")}`);
  const cols: [string, boolean[], number[]][] = [
    ...fx.keys.map((k): [string, boolean[], number[]] => [k, prep.signals[k] ?? [], fx.signals[k]]),
    ["vol_ok", prep.volOk, fx.vol_ok],
  ];
  const sigLine: string[] = [];
  let sigDiff = 0;
  for (const [k, ts, py] of cols) {
    let bad = 0;
    const ex: string[] = [];
    for (let i = 0; i < py.length; i++) {
      if (Number(Boolean(ts[i])) !== py[i]) {
        bad++;
        if (ex.length < 5) ex.push(`${fx.dates[i]} ts=${Number(Boolean(ts[i]))} py=${py[i]}`);
      }
    }
    if (ts.length !== py.length) { bad++; ex.push(`length ts=${ts.length} py=${py.length}`); }
    const on = py.reduce((a, x) => a + x, 0);
    sigLine.push(`${k}:${bad}`);
    sigDiff += bad;
    if (bad) fail(`signal ${k}: ${bad} day(s) differ (python on ${on} days) e.g. ${ex.join("; ")}`);
  }
  console.log(`signals (days differing per key): ${sigLine.join(" ")}`);
  console.log(`signals total differing days: ${sigDiff}`);

  // 2. low20
  let maxRel = 0, nanBad = 0;
  fx.low20.forEach((p, i) => {
    const t = prep.low20[i];
    if (p === null) { if (t === t) nanBad++; return; }
    if (t !== t) { nanBad++; return; }
    maxRel = Math.max(maxRel, Math.abs(t - p) / Math.abs(p));
  });
  if (nanBad || maxRel >= 1e-6) fail(`low20: ${nanBad} NaN mismatches, max rel diff ${maxRel}`);
  console.log(`low20: max relative difference ${maxRel}, NaN mismatches ${nanBad}`);

  // 3. approved
  const t2 = performance.now();
  const rules = approved(prep);
  const t3 = performance.now();
  statMaxDiff = 0;
  for (const h of Object.keys(fx.approved)) {
    if (!rules[h]) { fail(`approved: plan ${h} missing`); continue; }
    console.log(`approved ${comparePlan(h, rules[h], fx.approved[h])}`);
  }
  console.log(`approved: largest |ts - py| in avg/win/r_avg = ${statMaxDiff}`);

  // 4. advise (with the Python plan, so a picker difference cannot hide an advise difference; and with ours)
  let advOk = 0;
  for (const s of fx.advise) {
    const got = advise(prep, fx.approved, s.h, s.holding, s.provisional);
    const own = advise(prep, rules, s.h, s.holding, s.provisional);
    const label = `${s.h} holding=${s.holding ? JSON.stringify(s.holding) : "none"} provisional=${s.provisional}`;
    if (got[0] !== s.expect[0] || got[1] !== s.expect[1]) fail(`advise ${label}: ts ${JSON.stringify(got)} | py ${JSON.stringify(s.expect)}`);
    else if (own[0] !== s.expect[0] || own[1] !== s.expect[1]) fail(`advise (own plan) ${label}: ts ${JSON.stringify(own)} | py ${JSON.stringify(s.expect)}`);
    else advOk++;
  }
  console.log(`advise: ${advOk}/${fx.advise.length} scenarios identical`);
  console.log(`timing: prepare ${(t1 - t0).toFixed(0)} ms, approved ${(t3 - t2).toFixed(0)} ms`);
  console.log(`${fx.market}: ${failures === before ? "PASS" : `FAIL (${failures - before} problem(s))`}`);
  total++;
}

console.log(`\n${failures === 0 ? "ALL PARITY CHECKS PASSED" : `PARITY FAILED: ${failures} problem(s)`} (${total} markets)`);
process.exit(failures === 0 ? 0 : 1);
