/**
 * The checker (POST /api/check): core.check_alerts + notifier.run_once.
 * An alert is saved only when advice CHANGES: a BUY/SELL appears (live), is confirmed at the close, or is cancelled;
 * a holding's SELL (plan over, 20-day-low exit, your stop-loss / profit lock hit); and 🎯 target reached (once per
 * holding). The last advice per market × plan (and per holding) is kept in the "alerts" store key, next to the list.
 * Real progress (step k/total, step text with timings) goes to the "status" key after every step.
 */
import { dataProblem, marketOpen, ACTIONS } from "../engine/index.ts";
import { buildChain } from "../engine/chain.ts";
import { INTERVALS, KEYS, istDateTime, istTime, type Alert, type CheckStatus, type Heartbeat } from "../shared.ts";
import { store } from "../store.ts";
import { getHoldings, getInterval, holdingView, whyLine } from "./advice.ts";
import { loadMarket, MARKET_LIST, STEPS_PER_MARKET } from "./markets.ts";
import { alertMessage, sendToAll } from "./push.ts";

export interface AlertLog { state: Record<string, string>; alerts: Alert[] }

const PLANS_N = 3;
export const TOTAL_STEPS = STEPS_PER_MARKET * MARKET_LIST.length + 2; // + compare advice + save alerts
const MAX_ALERTS = 100;

/**
 * Send the new alerts to the phones with alerts on (web push, one message per alert; see push.ts).
 * Called once per check, after the alerts are saved, only when there is at least one new alert.
 * Never throws: a push problem is logged and the check carries on.
 */
export async function notify(alerts: Alert[]): Promise<void> {
  try {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return; // phone alerts not set up
    const r = await sendToAll(alerts.map(alertMessage));
    if (r.failed) console.error(`push: ${r.sent} sent, ${r.failed} failed, ${r.removed} removed: ${r.errors.join("; ")}`);
  } catch (e) {
    console.error(`push: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface CheckResult { alerts: Alert[]; status: CheckStatus }

// one check at a time (core._lock); kept on globalThis so every route bundle shares it
const g = globalThis as unknown as { __advisorCheck?: Promise<unknown> };

export function runCheck(): Promise<CheckResult> {
  const prev = g.__advisorCheck ?? Promise.resolve();
  const next = prev.catch(() => {}).then(checkOnce);
  g.__advisorCheck = next;
  return next;
}

async function checkOnce(): Promise<CheckResult> {
  const started = Date.now();
  const log: string[] = [];
  const status: CheckStatus = { state: "checking", step: "Starting check", done: 0, total: TOTAL_STEPS, started, log, error: null };
  const report = () => store.set(KEYS.status, status);
  const step = async (text: string, done = status.done + 1) => {
    log.push(`${istTime(Date.now(), true)}  ${text}`);
    Object.assign(status, { step: text, done });
    await report();
  };
  await report();

  const interval = INTERVALS[await getInterval()] * 1000;
  try {
    const [saved, holdings] = await Promise.all([store.get<AlertLog>(KEYS.alerts), getHoldings()]);
    const state = { ...(saved?.state ?? {}) };
    const alerts = saved?.alerts ?? [];
    const fresh: Alert[] = [];
    const errors: string[] = [];
    const nowMs = Date.now();
    const add = (market: string, horizon: string, advice: string, why: string) =>
      fresh.push({ id: `${nowMs}-${fresh.length}`, ts: nowMs, time: istDateTime(nowMs), market, horizon, advice, why });

    /** core.check_alerts' comparison for one key. */
    const track = (key: string, market: string, horizon: string, adv: string, why: string, isOpen: boolean) => {
      const action = ACTIONS.includes(adv);
      const now = action ? `${adv}|${isOpen ? "live" : "final"}` : adv;
      const old = state[key];
      state[key] = now;
      if ((old === undefined && !action) || now === old) return;
      const oldAdv = (old ?? "").split("|")[0];
      if (action) add(market, horizon, isOpen ? `${adv} (live)` : `${adv} (confirmed)`, why);
      else if (ACTIONS.includes(oldAdv)) add(market, horizon, `❎ ${oldAdv.split(" ")[1]} cancelled`, `Now ${adv}: ${why}`);
    };

    const live = new Set<string>(); // holding keys still in use (old ones are dropped)
    for (const [k, name] of MARKET_LIST.entries()) {
      let loaded;
      try {
        loaded = await loadMarket(name, { step: (text) => step(text) });
      } catch (e) {
        const msg = `${name}: failed (${e instanceof Error ? e.message : String(e)})`;
        errors.push(msg);
        await step(`✖ ${msg}`, (k + 1) * STEPS_PER_MARKET);
        continue;
      }
      const now = new Date();
      if (dataProblem(loaded.a.prep)) continue; // never alert on data that looks wrong
      const isOpen = marketOpen(name, now);
      const chain = buildChain({ name, bars: loaded.bars }, now, loaded.a);
      for (const h of Object.keys(chain.plans)) track(`${name}|${h}`, name, h, chain.plans[h].decision, whyLine(chain, h), isOpen);

      const hd = holdings[name];
      if (!hd) continue;
      const id = `${name}|holding|${hd.buy_date}|${hd.horizon}|${hd.buy_price ?? ""}|${hd.stop_change ?? ""}`;
      const tid = `${name}|target|${hd.buy_date}|${hd.horizon}|${hd.buy_price ?? ""}`;
      live.add(id).add(tid);
      const v = holdingView(loaded, hd, isOpen);
      track(id, name, `${hd.horizon} plan · your holding`, v.advice.advice[0], v.advice.advice[1], isOpen);
      for (const ev of v.advice.events) {
        if (state[tid] === "reached") continue;
        state[tid] = "reached";
        add(name, `${hd.horizon} plan · your holding`, `${ev.icon} ${ev.text}`, `Now ${v.advice.advice[0]}: ${v.advice.advice[1]}`);
      }
    }
    for (const key of Object.keys(state)) {
      if ((key.includes("|holding|") || key.includes("|target|")) && !live.has(key)) delete state[key];
    }
    await step(`Advice compared for ${MARKET_LIST.length} markets × ${PLANS_N} time frames: ${fresh.length} change(s)`,
      STEPS_PER_MARKET * MARKET_LIST.length + 1);

    await store.set(KEYS.alerts, { state, alerts: [...fresh.slice().reverse(), ...alerts].slice(0, MAX_ALERTS) } satisfies AlertLog);
    if (fresh.length) await notify(fresh);
    await step(`${fresh.length} new alert(s) saved for the website`, TOTAL_STEPS);
    const end = Date.now();
    Object.assign(status, { state: "idle", finished: end, duration: (end - started) / 1000, alerts: fresh.length, error: errors.join("; ") || null });
    await report();
    return { alerts: fresh, status };
  } catch (e) {
    const end = Date.now();
    Object.assign(status, { state: "idle", finished: end, duration: (end - started) / 1000, error: e instanceof Error ? e.message : String(e) });
    await report();
    throw e;
  } finally {
    await store.set(KEYS.heartbeat, { at: Date.now(), next: started + interval, interval: interval / 1000, by: "check" } satisfies Heartbeat);
  }
}
