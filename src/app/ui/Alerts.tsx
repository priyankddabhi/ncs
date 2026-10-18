"use client";
/**
 * Alerts: the header bell (unread count), its popover (newest first: the latest 10, "Show all" for the rest) and the
 * toasts for alerts that arrive while the page is open (bottom, auto-hide).
 */
import { useEffect, useRef, useState } from "react";
import type { Alert } from "@/lib/shared.ts";
import { Badge } from "./Badge.tsx";
import { badgeInfo, dayTime, noEmoji, shortName } from "./fmt.ts";
import { BellIcon, CloseIcon } from "./Icons.tsx";

const FIRST = 10;

interface BellProps {
  alerts: Alert[] | null;
  unread: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function Bell({ alerts, unread, open, onOpen, onClose }: BellProps) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // close on Esc (focus back to the bell) or a tap outside
  useEffect(() => {
    if (!open) return;
    pop.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { onClose(); btn.current?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open, onClose]);

  const label = unread ? `Alerts, ${unread} new` : "Alerts";
  return (
    <>
      <button
        ref={btn} className="iconBtn" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <BellIcon />
        {unread > 0 && <span className="count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div ref={pop} className="pop" role="dialog" aria-label="Alerts" tabIndex={-1}>
          <AlertList alerts={alerts} />
        </div>
      )}
    </>
  );
}

function AlertList({ alerts }: { alerts: Alert[] | null }) {
  const [all, setAll] = useState(false);
  const list = alerts ?? [];
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <>
      <p className="popHead">Alerts <span className="muted">{list.length}</span></p>
      {alerts === null ? (
        <p className="popEmpty small muted">Loading…</p>
      ) : !list.length ? (
        <p className="popEmpty small muted">
          No alerts yet. An alert is saved when advice changes: a BUY or SELL appears, is confirmed at the close, or is
          cancelled; your stop-loss or profit lock is hit; or your holding reaches its target.
        </p>
      ) : (
        <>
          <ul className="alerts">
            {shown.map((a) => {
              const { note } = badgeInfo(a.advice);
              return (
                <li key={a.id}>
                  <div className="aTop">
                    <Badge advice={a.advice} />
                    <span className="aWhere">{shortName(a.market)} · {a.horizon}</span>
                    <time className="aTime" title={`${a.time} IST`}>{dayTime(a.ts)}</time>
                  </div>
                  <p className="aWhy">{note && <b>{note} · </b>}{noEmoji(a.why)}</p>
                </li>
              );
            })}
          </ul>
          {list.length > FIRST && (
            <button className="more" onClick={() => setAll((x) => !x)}>{all ? `Show latest ${FIRST}` : `Show all (${list.length})`}</button>
          )}
        </>
      )}
    </>
  );
}

export function Toasts({ items, onClose }: { items: Alert[]; onClose: (id: string) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((a) => (
        <div key={a.id} className="toast">
          <Badge advice={a.advice} />
          <span className="tWhere">{shortName(a.market)} · {a.horizon}</span>
          <button className="iconBtn sm" onClick={() => onClose(a.id)} aria-label="Close alert"><CloseIcon size={16} /></button>
        </div>
      ))}
    </div>
  );
}
