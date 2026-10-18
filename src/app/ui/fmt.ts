/** Display helpers for the page (₹ / $, %, IST), emoji-free badges and the checker line, derived from the existing data. */
import type { CSSProperties } from "react";
import type { Prediction } from "@/lib/engine/predict.ts";
import type { HoldingView } from "@/lib/server/advice.ts";
import { INTERVALS, istDay, istTime, shortDay, type StatusResponse } from "@/lib/shared.ts";

const num = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isCrude = (market: string) => market.startsWith("Crude");

/** Nifty and Sensex in ₹; Brent crude is priced in US$ on Yahoo, so it keeps $. */
export const money = (market: string, x: number): string => (isCrude(market) ? "$" : "₹") + num(x);

/** Short price: ₹23,020 (whole rupees) or $61.24 (crude keeps cents). */
const shortNum = (market: string, x: number): string =>
  isCrude(market) ? num(x) : x.toLocaleString("en-IN", { maximumFractionDigits: 0 });
export const shortMoney = (market: string, x: number): string => (isCrude(market) ? "$" : "₹") + shortNum(market, x);

/** Signed % from a value already in percent units. */
export const pct = (x: number, d = 2): string => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(d)}%`;

/** "Past trades like this: usually +x%, range a–b (₹ prices), y% profitable (n trades)". */
export function pastTrades(market: string, p: Prediction, lead = "Past trades like this"): string {
  return `${lead}: usually ${pct(p.median * 100)}, range ${pct(p.p25 * 100)} to ${pct(p.p75 * 100)} ` +
    `(${money(market, p.low)}–${money(market, p.high)}), ${Math.round(p.probability * 100)}% profitable (${p.n} trades)`;
}

/** "≈ +0.02% · ₹23,020–23,287 · 52% win (582)". */
export function pastShort(market: string, p: Prediction): string {
  return `≈ ${pct(p.median * 100)} · ${shortMoney(market, p.low)}–${shortNum(market, p.high)} · ` +
    `${Math.round(p.probability * 100)}% win (${p.n})`;
}

/** Mount-animation order (CSS --i: the fade-up delay is --i × 70 ms). */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Emoji (pictographs, dingbats, variation selectors) the backend puts in its text; the page shows words instead. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
export const noEmoji = (s: string): string => s.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim();

export type Tone = "buy" | "sell" | "hold" | "wait" | "none" | "target" | "cancel" | "other";

const LABEL: Record<Tone, string> = {
  buy: "BUY", sell: "SELL", hold: "HOLD", wait: "WAIT", none: "NO TRADE", target: "TARGET", cancel: "CANCELLED", other: "",
};

/** Badge for a backend advice string ("🟢 BUY", "🟢 BUY (confirmed)", "❎ BUY cancelled", "🎯 Target … reached", …). */
export function badgeInfo(advice: string): { tone: Tone; label: string; note: string } {
  const text = noEmoji(advice);
  let tone: Tone;
  if (advice.includes("❎") || /cancelled/i.test(text)) tone = "cancel";
  else if (advice.includes("🎯") || /^Target\b/.test(text)) tone = "target";
  else if (text.includes("NO TRADE")) tone = "none";
  else if (text.includes("SELL")) tone = "sell";
  else if (text.includes("BUY")) tone = "buy";
  else if (text.includes("HOLD")) tone = "hold";
  else if (text.includes("WAIT")) tone = "wait";
  else tone = "other";
  let note = "";
  if (tone === "cancel") note = text; // "BUY cancelled"
  else if (tone === "target") note = text; // "Target +0.52% reached (predicted)."
  else if (tone !== "other") {
    const q = /\(([^)]+)\)/.exec(text); // "(confirmed)" / "(live)"
    if (q) note = q[1].charAt(0).toUpperCase() + q[1].slice(1);
  }
  return { tone, label: LABEL[tone] || text || "–", note };
}

/** "4:05" or "1h 05m" (notifier._clock). */
export function clock(seconds: number): string {
  const s = Math.max(Math.floor(seconds), 0);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "9:37 PM" (IST). */
export const hm = (ms: number): string => istTime(ms).replace(/^0/, "");

/** "16 Oct 9:40 PM" (IST), for compact alert rows. */
export const dayTime = (ms: number): string => `${shortDay(istDay(ms))} ${hm(ms)}`;

/** "Nifty" / "Sensex" / "Crude" for alert rows and the holdings list. */
export const shortName = (market: string): string => (isCrude(market) ? "Crude" : market.replace(/ 50$/, ""));

/** Tone of a trend chip. */
export const trendTone = (t: string): Tone => (t === "UP" ? "buy" : t === "DOWN" ? "sell" : "wait");

/** The main advice line for one plan: advise()'s own wording when the chain says BUY, else the chain's reason. */
export const whyLine = (p: { decision: string; advice: [string, string]; reason: string }) =>
  noEmoji(p.decision === "🟢 BUY" ? p.advice[1] : p.reason);

/** "Holding 1 month · +0.48% · stop ₹22,804" (or profit lock / target reached). */
export function holdingLine(market: string, price: number, h: HoldingView): string {
  const { buy_price: buy, stop_change: stop } = h.holding;
  const parts = [`Holding ${h.holding.horizon}`];
  if (buy) parts.push(pct((price / buy - 1) * 100));
  if (buy && stop) parts.push(`${stop < 0 ? "stop" : "profit lock"} ${shortMoney(market, buy * (1 + stop / 100))}`);
  if (h.advice.targetReached) parts.push("target reached");
  return parts.join(" · ");
}

/** The single checker line of the side panel (was the "Live process" block). */
export function checkerLine(data: StatusResponse | null, now: number | null): { text: string; bad: boolean; title: string } {
  if (!data || now === null) return { text: "Checker · loading…", bad: false, title: "" };
  const { status: s, heartbeat: hb } = data;
  const interval = INTERVALS[data.interval];
  const age = hb ? (now - hb.at) / 1000 : Infinity;
  const dead = age > 2 * interval;
  const left = hb?.next ? (hb.next - now) / 1000 : null;
  const last = s?.finished ? `Last check ${istTime(s.finished, true)} IST, ${(s.duration ?? 0).toFixed(1)} s, ${s.alerts ?? 0} alert(s).` : "No check yet.";
  const problem = s?.error ? ` Last check had a problem: ${s.error}` : "";
  if (s?.state === "checking") {
    return { text: `Checker on · checking ${s.done}/${s.total}`, bad: false, title: `Step ${s.done}/${s.total}: ${s.step}` };
  }
  if (dead) {
    return {
      text: "Checker stopped", bad: true,
      title: `No heartbeat ${hb ? `for ${clock(age)}` : "yet"}. Start it with "node scripts/checker.ts" in the web folder, or no alerts will be saved. ${last}${problem}`,
    };
  }
  const next = left === null ? "not scheduled" : left > 0 ? clock(left) : "due now";
  return { text: `Checker on · next ${next}${s?.error ? " · problem" : ""}`, bad: Boolean(s?.error), title: `${last}${problem}` };
}
