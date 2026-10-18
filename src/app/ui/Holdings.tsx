"use client";
/**
 * Holdings: the holding advice shown in a held market's card (HOLD / SELL / stop-loss / profit lock / target, as text
 * badges), and the side panel's "My holdings" section: one folded row per market ("Nifty · Not holding · Add" /
 * "Nifty · Holding 1 month · +0.48% · … · Edit") that opens the add / edit / remove form.
 */
import { useState } from "react";
import type { Holding } from "@/lib/engine/index.ts";
import type { MarketView } from "@/lib/server/advice.ts";
import { istDay, PLANS, shortDay } from "@/lib/shared.ts";
import { Badge } from "./Badge.tsx";
import { holdingLine, money, noEmoji, pastTrades, pct, shortName } from "./fmt.ts";
import { ChevronIcon, PlusIcon } from "./Icons.tsx";

export type Holdings = Record<string, Holding>;

interface Draft { buy_date: string; buy_price: string; horizon: string; stop_change: string }

const toDraft = (h: Holding): Draft => ({
  buy_date: h.buy_date, buy_price: h.buy_price ? String(h.buy_price) : "", horizon: h.horizon,
  stop_change: h.stop_change ? String(h.stop_change) : "0",
});
const blank = (): Draft => ({ buy_date: istDay(Date.now()), buy_price: "", horizon: "1 month", stop_change: "0" });

/** Side panel section: add / edit / remove the holding of each market (same /api/holdings calls as before). */
export function HoldingsSection({ markets, holdings, onSaved }: { markets: MarketView[] | null; holdings: Holdings; onSaved: (h: Holdings) => void }) {
  return (
    <details className="acc">
      <summary>
        <span>My holdings</span>
        <PlusIcon className="accIcon" />
      </summary>
      <div className="holdList">
        {markets === null ? (
          <p className="small muted">Loading…</p>
        ) : markets.map((view) => {
          const saved = holdings[view.name] ?? null;
          const c = view.chain;
          const line = c && view.holding ? holdingLine(c.name, c.price, view.holding) : saved ? `Holding ${saved.horizon}` : "Not holding";
          // the key resets (and folds) the form whenever the saved holding changes
          return <HoldingFold key={`${view.name}|${JSON.stringify(saved)}`} market={view.name} saved={saved} line={`${shortName(view.name)} · ${line}`} onSaved={onSaved} />;
        })}
      </div>
    </details>
  );
}

export function HoldingAdvice({ view }: { view: MarketView }) {
  const h = view.holding!;
  const { holding, advice } = h;
  const name = view.name;
  const target = advice.targetPrice ? ` · target ${money(name, advice.targetPrice)}${advice.targetReached ? " (reached)" : ""}` : "";
  return (
    <div className="holdAdvice">
      <p className="small muted">
        Your holding · {holding.horizon} plan · bought {shortDay(holding.buy_date)} {holding.buy_date.slice(0, 4)}
        {holding.buy_price ? ` at ${money(name, holding.buy_price)}` : " (no buy price)"}
        {holding.stop_change ? ` · ${holding.stop_change < 0 ? "stop-loss" : "profit lock"} ${pct(holding.stop_change, 1)}` : ""}
      </p>
      <div className="adviceRow">
        <Badge advice={advice.advice[0]} />
        <p>{noEmoji(advice.advice[1])}</p>
      </div>
      {advice.events.map((e, i) => (
        <div key={i} className="adviceRow">
          <Badge advice={`${e.icon} ${e.text}`} />
          <p>{noEmoji(e.text)}</p>
        </div>
      ))}
      {h.plan ? (
        <p className="small muted">{pastTrades(name, h.plan, "Your plan's past trades from your buy price")}{target}.</p>
      ) : h.median !== null ? (
        <p className="small muted">Your plan&apos;s past trades: usually {pct(h.median * 100)} (add a buy price to see prices).</p>
      ) : null}
    </div>
  );
}

function HoldingFold({ market, saved, line, onSaved }: { market: string; saved: Holding | null; line: string; onSaved: (h: Holdings) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => (saved ? toDraft(saved) : blank()));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(holding: object | null) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, holding }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      onSaved(body as Holdings);
    } catch (e) {
      setMsg(`Not saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const save = () => post({
    buy_date: draft.buy_date, horizon: draft.horizon,
    buy_price: draft.buy_price.trim() ? Number(draft.buy_price) : null,
    stop_change: draft.stop_change.trim() ? Number(draft.stop_change) : 0,
  });
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const id = `hold-${market.replace(/\W+/g, "_")}`;

  return (
    <div className={`holdFold${open ? " open" : ""}`}>
      <button className="foldBtn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="foldLine">{line}</span>
        <span className="foldAct">{saved ? "Edit" : "Add"}<ChevronIcon className="chev" /></span>
      </button>
      {open && (
        <div id={id} className="fields rise">
          <label className="field">Bought on<input type="date" value={draft.buy_date} onChange={set("buy_date")} /></label>
          <label className="field">Buy price (optional)
            <input type="number" inputMode="decimal" min={0} step="any" value={draft.buy_price} onChange={set("buy_price")} placeholder="e.g. 23000" />
          </label>
          <label className="field">My plan
            <select value={draft.horizon} onChange={set("horizon")}>{PLANS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="field">Stop-loss % from buy price (0 = off)
            <input type="number" inputMode="decimal" min={-50} max={50} step={0.5} value={draft.stop_change} onChange={set("stop_change")} />
          </label>
          <p className="small muted span2">
            −5 = sell if the price falls 5% below your buy price. +2 = lock in profit: after the price goes above +2%, sell
            if it falls back to +2%. Needs the buy price. You get a SELL alert.
          </p>
          <div className="row span2">
            <button className="btn primary" onClick={save} disabled={busy}>{saved ? "Save changes" : "Add holding"}</button>
            {saved && <button className="btn" onClick={() => post(null)} disabled={busy}>Remove</button>}
          </div>
          {msg && <p className="note bad span2">{msg}</p>}
        </div>
      )}
    </div>
  );
}
