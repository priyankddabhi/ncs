"use client";
/**
 * "Phone alerts" row of the side panel (web push, Android Chrome first; Next.js PWA guide).
 * Off -> "Turn on": registers /sw.js, asks permission, subscribes with the VAPID public key and sends the
 * subscription to /api/push/subscribe. On -> "Send test" (/api/push/test) and "Turn off" (/api/push/unsubscribe).
 */
import { useEffect, useState } from "react";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Mode = "loading" | "unsupported" | "denied" | "off" | "on";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(PUBLIC_KEY);

async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || data.ok === false) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
  return data;
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function PhoneAlerts() {
  const [mode, setMode] = useState<Mode>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      await Promise.resolve();
      if (!supported()) { if (live) setMode("unsupported"); return; }
      if (Notification.permission === "denied") { if (live) setMode("denied"); return; }
      const sub = await currentSub().catch(() => null);
      if (!live) return;
      setMode(sub ? "on" : "off");
      if (sub) post("/api/push/subscribe", sub.toJSON()).catch(() => {}); // keep the server's list in step
    })();
    return () => { live = false; };
  }, []);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setMsg("");
    try { await job(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const turnOn = () => run(async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setMode(perm === "denied" ? "denied" : "off"); if (perm !== "denied") setMsg("Notifications were not allowed."); return; }
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
    try {
      await post("/api/push/subscribe", sub.toJSON());
    } catch (e) {
      await sub.unsubscribe().catch(() => {});
      throw e;
    }
    setMode("on");
  });

  const turnOff = () => run(async () => {
    const sub = await currentSub();
    if (sub) {
      await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setMode("off");
  });

  const test = () => run(async () => {
    await post("/api/push/test");
    setMsg("Test sent. It should appear on this device in a few seconds.");
  });

  const on = mode === "on";
  return (
    <div className="push">
      <div className="pushRow">
        <span className="pushName">Phone alerts</span>
        {(on || mode === "off") && <span className={`chip${on ? " buy" : ""}`}>{on ? "On" : "Off"}</span>}
        <span className="pushBtns">
          {mode === "off" && <button className="btn sm" onClick={turnOn} disabled={busy}>{busy ? "Turning on…" : "Turn on"}</button>}
          {on && <button className="btn sm" onClick={test} disabled={busy}>Send test</button>}
          {on && <button className="btn sm" onClick={turnOff} disabled={busy}>Turn off</button>}
        </span>
      </div>
      {mode === "loading" && <p className="small muted">Checking…</p>}
      {mode === "unsupported" && <p className="small muted">This browser cannot show phone alerts. On Android use Chrome.</p>}
      {mode === "denied" && <p className="small muted">Notifications are blocked for this site. Allow them in the browser&apos;s site settings.</p>}
      {msg && <p className="small muted" role="status">{msg}</p>}
    </div>
  );
}
