/**
 * Check that live Yahoo data fetched in JavaScript matches the data the Python bot used (the frozen parity
 * fixtures), day by day, and that the engine runs on it.  Run from the web folder:  node scripts/data-check.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchDaily } from "../src/lib/data/yahoo.ts";
import { approved, prepare } from "../src/lib/engine/index.ts";

const DIR = process.env.PARITY_DIR ??
  "C:/Users/priya/AppData/Local/Temp/claude/d--dabhim-imp-pd-cr-projects-n-s-c/aa4b9fa7-99fe-4fa4-b602-5ca3ee3e84a0/scratchpad/parity";
let ok = true;
for (const [file, ticker] of [["NSEI", "^NSEI"], ["BSESN", "^BSESN"], ["BZ_F", "BZ=F"]]) {
  const fx = JSON.parse(readFileSync(join(DIR, `${file}.json`), "utf8"));
  const t0 = Date.now();
  const bars = await fetchDaily(ticker);
  const ms = Date.now() - t0;
  // compare every day the fixture has, except its last day (that candle was still live when frozen)
  const idx = new Map(bars.dates.map((d, i) => [d, i]));
  let missing = 0, maxRel = 0;
  for (let i = 0; i < fx.dates.length - 1; i++) {
    const j = idx.get(fx.dates[i]);
    if (j === undefined) { missing++; continue; }
    for (const k of ["open", "high", "low", "close"] as const) {
      maxRel = Math.max(maxRel, Math.abs(bars[k][j] / fx[k][i] - 1));
    }
  }
  const extra = bars.dates.filter((d) => d < fx.dates.at(-1) && !fx.dates.includes(d)).length;
  const prep = prepare(bars);
  const plans = approved(prep);
  const good = missing === 0 && extra === 0 && maxRel < 1e-9;
  ok &&= good;
  console.log(`${ticker}: ${bars.dates.length} days (fetch ${ms} ms) | vs Python data: missing ${missing}, extra ${extra}, ` +
    `max price diff ${maxRel.toExponential(1)} | rules in use ${Object.values(plans).map((p) => p.ok.length).join("/")} ` +
    `| last ${bars.dates.at(-1)} close ${bars.close.at(-1)} -> ${good ? "MATCH" : "DIFFERENT"}`);
}
process.exit(ok ? 0 : 1);
