"use client";
/**
 * Slide-in side panel (menu icon): Refresh, the "Check every" timer, the one checker status line, "Phone alerts", "My holdings"
 * (folded: add / edit / remove per market), the glossary (folded) and the disclaimer. Modal: focus-trapped, closes on the close icon, the backdrop or Esc.
 */
import { useEffect, useRef, useState } from "react";
import type { MarketView } from "@/lib/server/advice.ts";
import { INTERVALS, istDateTime, type StatusResponse } from "@/lib/shared.ts";
import { checkerLine } from "./fmt.ts";
import { Disclaimer, Glossary } from "./Glossary.tsx";
import { HoldingsSection, type Holdings } from "./Holdings.tsx";
import { PhoneAlerts } from "./PhoneAlerts.tsx";
import { CloseIcon, RefreshIcon } from "./Icons.tsx";

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onRefresh: () => void;
  interval: string | null;
  onInterval: (name: string) => void;
  status: StatusResponse | null;
  /** Server clock − this device's clock, ms. */
  skew: number;
  updated: number | null;
  /** For "My holdings" (null while loading). */
  markets: MarketView[] | null;
  holdings: Holdings;
  onSaved: (h: Holdings) => void;
}

export function SidePanel({ open, onClose, busy, onRefresh, interval, onInterval, status, skew, updated, markets, holdings, onSaved }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState<number | null>(null);

  // countdown clock, only while the panel is open
  useEffect(() => {
    if (!open) return;
    const tickNow = () => setNow(Date.now());
    const first = setTimeout(tickNow, 0);
    const id = setInterval(tickNow, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [open]);

  // focus trap, Esc, scroll lock; focus goes back to the menu button on close
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    document.documentElement.classList.add("lock");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("lock");
      before?.focus?.();
    };
  }, [open, onClose]);

  const line = checkerLine(status, now === null ? null : now + skew);

  return (
    <div className={`sheet${open ? " open" : ""}`} inert={!open}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div className="panelHead">
          <h2 id="panel-title">Menu</h2>
          <button ref={closeBtn} className="iconBtn" onClick={onClose} aria-label="Close menu"><CloseIcon /></button>
        </div>

        <button className="btn primary wide" onClick={onRefresh} disabled={busy} title="Fetch fresh prices and update the advice now">
          <RefreshIcon className={busy ? "spin" : undefined} />
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <p className="small muted">
          {updated ? `Updated ${istDateTime(updated)} IST` : "Loading prices…"} · signals use daily candles; the tested buy time is the next open
        </p>

        <label className="field">
          <span>Check every</span>
          <select value={interval ?? ""} onChange={(e) => onInterval(e.target.value)} disabled={interval === null}>
            {interval === null && <option value="">…</option>}
            {Object.keys(INTERVALS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>

        <p className={`checker${line.bad ? " bad" : ""}`} title={line.title || undefined}>
          <span className="cDot" aria-hidden="true" />
          {line.text}
        </p>

        <PhoneAlerts />

        <div className="panelHelp">
          <HoldingsSection markets={markets} holdings={holdings} onSaved={onSaved} />
          <Glossary />
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}
