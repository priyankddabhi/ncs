/**
 * Phone alerts (web push, Android Chrome first). The phone's push subscription is kept in the "push" store key
 * (a list, one entry per phone/browser, deduped by endpoint, newest 10). Messages are signed with the VAPID keys
 * (env NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) and shown by public/sw.js.
 * A subscription the push service reports as gone (HTTP 404 / 410) is removed.
 */
import webpush, { WebPushError } from "web-push";
import { badgeInfo, noEmoji, shortName } from "../../app/ui/fmt.ts";
import { KEYS, type Alert } from "../shared.ts";
import { store } from "../store.ts";

export interface PushSub {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  /** Epoch ms when this device turned alerts on. */
  added: number;
}

/** What public/sw.js shows. */
export interface PushMessage { title: string; body: string; tag: string; url: string }

export interface SendResult { subscriptions: number; sent: number; failed: number; removed: number; errors: string[] }

const MAX_SUBS = 10;
const DEFAULT_SUBJECT = "https://github.com/priyankddabhi/ncs";
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("Phone alerts are not set up: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing (run scripts/make-vapid.ts)");
  }
  return { subject: process.env.VAPID_SUBJECT || DEFAULT_SUBJECT, publicKey, privateKey };
}

/** A browser's PushSubscription JSON, checked; null when it is not one. */
export function parseSubscription(x: unknown): Omit<PushSub, "added"> | null {
  if (!x || typeof x !== "object") return null;
  const { endpoint, expirationTime, keys } = x as Record<string, unknown>;
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  try { if (new URL(endpoint).protocol !== "https:") return null; } catch { return null; }
  const k = keys as Record<string, unknown> | undefined;
  if (!k || typeof k.p256dh !== "string" || typeof k.auth !== "string") return null;
  if (!B64URL.test(k.p256dh) || !B64URL.test(k.auth) || k.p256dh.length > 200 || k.auth.length > 100) return null;
  return {
    endpoint,
    expirationTime: typeof expirationTime === "number" ? expirationTime : null,
    keys: { p256dh: k.p256dh, auth: k.auth },
  };
}

export const getSubs = async (): Promise<PushSub[]> => (await store.get<PushSub[]>(KEYS.push)) ?? [];

/** Add or replace (same endpoint) a subscription; keeps the newest 10. Returns how many are stored. */
export async function addSub(sub: Omit<PushSub, "added">): Promise<number> {
  const list = [{ ...sub, added: Date.now() }, ...(await getSubs()).filter((s) => s.endpoint !== sub.endpoint)].slice(0, MAX_SUBS);
  await store.set(KEYS.push, list);
  return list.length;
}

/** Remove subscriptions by endpoint. Returns how many are left. */
export async function removeSubs(endpoints: string[]): Promise<number> {
  const gone = new Set(endpoints);
  const before = await getSubs();
  const list = before.filter((s) => !gone.has(s.endpoint));
  if (list.length !== before.length) await store.set(KEYS.push, list);
  return list.length;
}

/** The phone message for one alert: "BUY · Nifty · 1 day" + "Live · <why>". */
export function alertMessage(a: Alert): PushMessage {
  const { label, note } = badgeInfo(a.advice);
  const body = `${note ? `${note} · ` : ""}${noEmoji(a.why)}`;
  return {
    title: `${label} · ${shortName(a.market)} · ${a.horizon}`,
    body: body.length > 240 ? `${body.slice(0, 239)}…` : body,
    tag: `${a.market}|${a.horizon}`, // a newer alert for the same market + plan replaces the older one
    url: "/",
  };
}

const host = (endpoint: string) => { try { return new URL(endpoint).host; } catch { return "?"; } };

/** Send every message to every stored subscription. Never throws for a push failure; gone devices are removed. */
export async function sendToAll(messages: PushMessage[]): Promise<SendResult> {
  const details = vapid();
  const subs = await getSubs();
  const res: SendResult = { subscriptions: subs.length, sent: 0, failed: 0, removed: 0, errors: [] };
  if (!subs.length || !messages.length) return res;
  const gone = new Set<string>();
  await Promise.all(subs.map(async (s) => {
    for (const m of messages) {
      if (gone.has(s.endpoint)) return;
      try {
        await webpush.sendNotification(s, JSON.stringify(m), { vapidDetails: details, TTL: 6 * 3600, urgency: "high", timeout: 10_000 });
        res.sent++;
      } catch (e) {
        res.failed++;
        const code = e instanceof WebPushError ? e.statusCode : 0;
        if (code === 404 || code === 410) gone.add(s.endpoint);
        const why = e instanceof WebPushError ? `HTTP ${e.statusCode}${e.body ? ` ${e.body.slice(0, 120).trim()}` : ""}`
          : e instanceof Error ? e.message : String(e);
        res.errors.push(`${host(s.endpoint)}: ${why}${gone.has(s.endpoint) ? " (removed)" : ""}`);
      }
    }
  }));
  if (gone.size) {
    await removeSubs([...gone]);
    res.removed = gone.size;
  }
  return res;
}
