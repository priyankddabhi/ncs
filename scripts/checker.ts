/**
 * Local checker runner (notifier.loop): POSTs /api/check on the timer chosen on the website, re-reading the timer
 * every 5 seconds so a change applies at once, and writes a heartbeat the page uses to show "checker running".
 * On Vercel (step 4) an external scheduler calls POST /api/check instead; each check writes the heartbeat too.
 *
 * Run from the web folder, with the website running (npm run start):  node scripts/checker.ts
 *   CHECK_URL=http://localhost:3000/api/check  (default)   node scripts/checker.ts --once   (one check, then exit)
 */
import { INTERVALS, KEYS, intervalName, istTime, type Alert, type Heartbeat, type Settings } from "../src/lib/shared.ts";
import { store } from "../src/lib/store.ts";

try { process.loadEnvFile(".env.local"); } catch { /* keys may come from the environment instead */ }
const URL_ = process.env.CHECK_URL ?? "http://localhost:3000/api/check";
const SECRET = process.env.CHECK_SECRET ?? ""; // lets the checker past the PIN guard (src/proxy.ts)
const TICK = 5_000;
const TIMEOUT = 120_000;

async function check(): Promise<void> {
  const t = Date.now();
  const r = await fetch(URL_, { method: "POST", headers: { "x-check-secret": SECRET }, signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; alerts?: Alert[]; error?: string };
  if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  const took = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`${istTime(Date.now(), true)}  check done in ${took} s, ${body.alerts?.length ?? 0} new alert(s)`);
  for (const a of body.alerts ?? []) console.log(`   ${a.advice} · ${a.market} · ${a.horizon}\n   ${a.why}`);
}

async function interval(): Promise<number> {
  return INTERVALS[intervalName((await store.get<Settings>(KEYS.settings))?.interval)] * 1000;
}

async function beat(next: number | null, every: number): Promise<void> {
  await store.set(KEYS.heartbeat, { at: Date.now(), next, interval: every / 1000, by: "runner" } satisfies Heartbeat);
}

if (process.argv.includes("--once")) {
  await check();
} else {
  console.log(`checker: calling ${URL_} on the website's timer (Ctrl+C to stop)`);
  let last = 0;
  for (;;) {
    const every = await interval();
    if (Date.now() - last >= every) {
      last = Date.now();
      await beat(last + every, every);
      try {
        await check();
      } catch (e) { // keep running through network hiccups or a stopped website
        console.error(`${istTime(Date.now(), true)}  checker: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await beat(last + every, every);
    await new Promise((r) => setTimeout(r, TICK));
  }
}
