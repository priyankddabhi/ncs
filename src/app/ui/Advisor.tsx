"use client";
/**
 * The page's live part: header (logo · bell · menu), the three markets stacked on one screen (Nifty 50, Sensex,
 * crude oil), the side panel and the alert toasts. /api/state is re-read on the chosen timer; /api/status (cheap)
 * every 5 s while the tab is visible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Holdings, StateResponse } from "@/lib/server/advice.ts";
import { INTERVALS, type Alert, type StatusResponse } from "@/lib/shared.ts";
import { Bell, Toasts } from "./Alerts.tsx";
import { LogoMark, MenuIcon } from "./Icons.tsx";
import { MarketView } from "./MarketView.tsx";
import { SidePanel } from "./SidePanel.tsx";

const STATUS_EVERY = 5_000;
const TOAST_MS = 6_000;
const SEEN_KEY = "advisor.alertsSeen";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

/** Time of the newest alert already seen in the bell (0 = none yet). */
function storedSeen(): number {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}

export function Advisor() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [skew, setSkew] = useState(0); // server clock − this device's clock
  const [interval, setIntervalName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [panel, setPanel] = useState(false);
  const [bell, setBell] = useState(false);
  const [seenTs, setSeenTs] = useState(storedSeen);
  const seen = useRef<Set<string> | null>(null);

  const loadState = useCallback(async (fresh = false) => {
    try {
      const s = await getJson<StateResponse>(`/api/state${fresh ? "?fresh=1" : ""}`);
      setState(s);
      setStateError(null);
      setIntervalName((cur) => cur ?? s.interval);
    } catch (e) {
      setStateError((e as Error).message);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getJson<StatusResponse>("/api/status");
      setSkew(s.now - Date.now());
      setStatus(s);
      setIntervalName((cur) => cur ?? s.interval);
      // toast for alerts this tab has not seen (the first load only records what is already there)
      const ids = s.alerts.map((a) => a.id);
      if (seen.current === null) seen.current = new Set(ids);
      else {
        const fresh = s.alerts.filter((a) => !seen.current!.has(a.id));
        fresh.forEach((a) => seen.current!.add(a.id));
        if (fresh.length) {
          setToasts((t) => [...fresh, ...t].slice(0, 5));
          setTimeout(() => setToasts((t) => t.filter((x) => !fresh.includes(x))), TOAST_MS);
        }
      }
    } catch {
      /* keep the last status; the side panel shows "Checker stopped" if the checker is gone */
    }
  }, []);

  // checker status + alerts, while the tab is visible
  useEffect(() => {
    const run = () => { if (document.visibilityState === "visible") void loadStatus(); };
    const first = setTimeout(run, 0);
    const id = setInterval(run, STATUS_EVERY);
    document.addEventListener("visibilitychange", run);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", run); };
  }, [loadStatus]);

  // market state on the chosen timer
  const seconds = INTERVALS[interval ?? "5 min"];
  useEffect(() => {
    const first = setTimeout(() => void loadState(), 0);
    const id = setInterval(() => void loadState(), seconds * 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [loadState, seconds]);

  async function refresh() {
    setBusy(true);
    await Promise.all([loadState(true), loadStatus()]);
    setBusy(false);
  }

  async function changeInterval(name: string) {
    setIntervalName(name);
    try {
      await getJson("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval: name }) });
      void loadStatus();
    } catch (e) {
      setStateError(`Timer not saved: ${(e as Error).message}`);
    }
  }

  const alerts = status?.alerts ?? null;
  const unread = (alerts ?? []).filter((a) => a.ts > seenTs).length;

  const closePanel = useCallback(() => setPanel(false), []);
  const closeBell = useCallback(() => setBell(false), []);
  function openBell() {
    setPanel(false);
    setBell(true);
    const newest = alerts?.[0]?.ts;
    if (newest && newest > seenTs) {
      setSeenTs(newest);
      try { localStorage.setItem(SEEN_KEY, String(newest)); } catch { /* count comes back next visit */ }
    }
  }

  const onSaved = useCallback((h: Holdings) => { setState((s) => (s ? { ...s, holdings: h } : s)); void loadState(); }, [loadState]);

  return (
    <>
      <header className="top">
        <div className="topIn">
          <span className="logo"><LogoMark /><span>Advisor</span></span>
          <Bell alerts={alerts} unread={unread} open={bell} onOpen={openBell} onClose={closeBell} />
          <button className="iconBtn" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={panel} onClick={() => { setBell(false); setPanel(true); }}>
            <MenuIcon />
          </button>
        </div>
      </header>

      <main className="wrap">
        {state ? (
          <>
            {stateError && <p className="note bad">Could not update: {stateError}</p>}
            {state.markets.map((m, i) => <MarketView key={m.name} view={m} index={i} />)}
          </>
        ) : (
          <>
            {stateError && <p className="note bad">Could not update: {stateError}</p>}
            <section className="card loading rise"><p className="muted">Loading the three markets…</p></section>
          </>
        )}
      </main>

      <SidePanel
        open={panel} onClose={closePanel} busy={busy} onRefresh={refresh} interval={interval} onInterval={changeInterval}
        status={status} skew={skew} updated={state?.updated ?? null}
        markets={state?.markets ?? null} holdings={state?.holdings ?? {}} onSaved={onSaved}
      />
      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  );
}
