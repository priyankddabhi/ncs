"use client";
/**
 * One market as one compact card: name (+ "you hold this"), price, day change, trend chips, data-problem warning,
 * then the three plan buttons (1D / 1W / 1M with their badge). BUY / SELL / HOLD plans (and the plan you hold) show
 * their details right away; a WAIT / NO TRADE plan opens its details on a tap (one at a time per card).
 */
import { useState } from "react";
import type { MarketChain, PlanChain } from "@/lib/engine/chain.ts";
import type { MarketView as View } from "@/lib/server/advice.ts";
import { shortDay } from "@/lib/shared.ts";
import { Badge } from "./Badge.tsx";
import { badgeInfo, money, noEmoji, pastShort, pastTrades, pct, stagger, trendTone, whyLine } from "./fmt.ts";
import { HoldingAdvice } from "./Holdings.tsx";
import { ChevronIcon, TrendArrow, WarnIcon } from "./Icons.tsx";

/** "1 day" → "1D", "1 week" → "1W", "1 month" → "1M". */
const planKey = (plan: string) => plan.replace(/^(\d+)\s*(\w).*$/, (_, n: string, u: string) => n + u.toUpperCase());

export function MarketView({ view, index }: { view: View; index: number }) {
  const c = view.chain;
  const [picked, setPicked] = useState<string | null>(null); // the one tapped-open WAIT / NO TRADE plan
  const [shut, setShut] = useState<string[]>([]); // auto-open plans the owner folded
  const cardId = view.name.replace(/\W+/g, "_");

  if (!c) {
    return (
      <section className="card mkt rise" style={stagger(index)} aria-label={view.name}>
        <p className="mName">{view.name}</p>
        <p className="note bad">{view.error ?? "No data."} The other markets are not affected; it will retry on the next refresh.</p>
      </section>
    );
  }

  const up = c.change >= 0;
  const held = view.holding?.holding.horizon ?? null;
  const plans = Object.values(c.plans).map((p) => {
    const advice = p.plan === held ? view.holding!.advice.advice[0] : p.decision;
    const tone = badgeInfo(advice).tone;
    const auto = p.plan === held || tone === "buy" || tone === "sell" || tone === "hold";
    const open = auto ? !shut.includes(p.plan) : picked === p.plan;
    return { p, advice, auto, open, id: `plan-${cardId}-${p.plan.replace(/\W+/g, "_")}` };
  });

  function toggle(plan: string, auto: boolean) {
    if (auto) setShut((s) => (s.includes(plan) ? s.filter((x) => x !== plan) : [...s, plan]));
    else setPicked((cur) => (cur === plan ? null : plan));
  }

  return (
    <section className="card mkt rise" style={stagger(index)} aria-label={view.name}>
      <div className="mTop">
        <p className="mName">{view.name}</p>
        {view.holding && <span className="chip hold">you hold this</span>}
        <div className="trends">
          <Trend k="D" word="Daily" t={c.trend.daily} />
          <Trend k="W" word="Weekly" t={c.trend.weekly} />
          <Trend k="M" word="Monthly" t={c.trend.monthly} />
        </div>
      </div>
      <p className="mPrice">
        <span className="price">{money(c.name, c.price)}</span>
        <span className={`change ${up ? "up" : "down"}`}>
          {up ? "+" : "-"}{money(c.name, Math.abs(c.change)).replace(/^[₹$]/, "")} ({pct(c.changePct)})
        </span>
      </p>
      {c.dataProblem && <DataProblem text={c.dataProblem} />}

      <div className="planBtns" role="group" aria-label={`${view.name} plans`}>
        {plans.map(({ p, advice, auto, open, id }) => (
          <button
            key={p.plan} className="planBtn" aria-expanded={open} aria-controls={id}
            aria-label={`${p.plan} plan: ${badgeInfo(advice).label}${p.plan === held ? " (your holding)" : ""}`}
            onClick={() => toggle(p.plan, auto)}
          >
            <span className="pKey">{planKey(p.plan)}<ChevronIcon className="chev" /></span>
            <Badge advice={advice} />
          </button>
        ))}
      </div>

      {plans.filter((x) => x.open).map(({ p, id }) => (
        <PlanDetail key={p.plan} id={id} view={view} c={c} p={p} held={p.plan === held} />
      ))}
    </section>
  );
}

function Trend({ k, word, t }: { k: string; word: string; t: string }) {
  const full = `${word} trend ${t === "UP" ? "up" : t === "DOWN" ? "down" : "sideways"}`;
  return (
    <span className={`chip ${trendTone(t)}`} title={full} aria-label={full} role="img">
      {k}<TrendArrow trend={t} />
    </span>
  );
}

function DataProblem({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`dataWarn${open ? " open" : ""}`}>
      <button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <WarnIcon /><span>Data problem{open ? "" : " · tap to read"}</span><ChevronIcon className="chev" />
      </button>
      {open && <p className="rise">{noEmoji(text)}</p>}
    </div>
  );
}

/** Details of one plan: the reason (+ past trades for BUY), or your holding's advice for the plan you hold; "How decided". */
function PlanDetail({ id, view, c, p, held }: { id: string; view: View; c: MarketChain; p: PlanChain; held: boolean }) {
  const [open, setOpen] = useState(false);
  const how = `how-${id}`;
  return (
    <div id={id} className="pDetail rise">
      {held ? (
        <HoldingAdvice view={view} />
      ) : (
        <>
          <p className="reason"><b>{p.plan}:</b> {whyLine(p)}</p>
          {p.prediction && <p className="pastLine">{pastTrades(c.name, p.prediction)}.</p>}
        </>
      )}
      <button className={`howBtn${open ? " open" : ""}`} aria-expanded={open} aria-controls={how} onClick={() => setOpen((o) => !o)}>
        How decided<ChevronIcon className="chev" />
      </button>
      {open && <Steps id={how} c={c} p={p} rulesInUse={view.rulesInUse} />}
    </div>
  );
}

function Steps({ id, c, p, rulesInUse }: { id: string; c: MarketChain; p: PlanChain; rulesInUse: Record<string, number> | null }) {
  const pats = c.patterns;
  const daily = pats.daily.hits.map((x) => `${x.name}${x.usedIn.length ? ` (rule in use: ${x.usedIn.join(", ")})` : " (not in use here)"}`);
  return (
    <ol id={id} className="steps rise">
      <li><span className="k">Price</span><span>{money(c.name, c.price)} on {shortDay(c.date)} ({c.provisional ? "live, final at close" : "final"}), {pct(c.changePct)} on the day.</span></li>
      <li>
        <span className="k">Trend</span>
        <span>
          Daily {c.trend.daily} · last full week{c.trend.weekOf ? ` (to ${shortDay(c.trend.weekOf)})` : ""} {c.trend.weekly} ·
          last full month{c.trend.monthOf ? ` (to ${shortDay(c.trend.monthOf)})` : ""} {c.trend.monthly}
        </span>
      </li>
      <li>
        <span className="k">Patterns</span>
        <span>
          Today: {daily.join("; ") || "none"}. Last week: {pats.weekly.hits.map((x) => x.name).join(", ") || "none"}; last month:{" "}
          {pats.monthly.hits.map((x) => x.name).join(", ") || "none"} (weekly/monthly patterns: not tested).
        </span>
      </li>
      <li>
        <span className="k">Rules matched</span>
        <span>
          {p.matched.length} of {rulesInUse?.[p.plan] ?? "?"} rules in use{p.matched.length ? ": " : "."}
          {p.matched.map((r) => `${r.text} (since 2019 ${pct(r.r_avg)}, ${r.r_n} trades)`).join("; ")}
        </span>
      </li>
      <li>
        <span className="k">Filters</span>
        <span>
          Volume above its 30-day average: {p.filters.volume.on ? (p.filters.volume.ok ? "used, passes" : "used, blocks") : "not used"} ·
          higher time frame: {p.filters.htf.pick ? `needs ${p.filters.htf.label}, ${p.filters.htf.ok ? "passes" : "blocks"}` : "none picked by the test"}
        </span>
      </li>
      <li><span className="k">Decision</span><span><Badge advice={p.decision} /> {noEmoji(p.reason)}</span></li>
      <li><span className="k">Past-trades range</span><span>{p.prediction ? pastShort(c.name, p.prediction) : "Shown only when the decision is BUY."}</span></li>
      <li><span className="k">Exit plan</span><span>{noEmoji(p.exit.text)}</span></li>
    </ol>
  );
}
