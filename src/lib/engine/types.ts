/** Shared types for the signal engine (port of core.py and the Python strategy code). */

/** A numeric series: one value per day, NaN where pandas would have NaN. */
export type Series = number[];
/** A boolean series (pandas bool Series after fillna(False)). */
export type Flags = boolean[];

/** Cleaned daily bars, as core.full_history returns them (dates as "YYYY-MM-DD", oldest first). */
export interface Bars {
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/** core.prepare output, reduced to what core uses: the bars plus s_<key>, vol_ok and low20. */
export interface Prep extends Bars {
  /** signals[key][i] = prep["s_<key>"] on day i (fillna(False)). */
  signals: Record<string, Flags>;
  /** Volume above its prior 30-day average (Bulkowski filter). */
  volOk: Flags;
  /** Lowest low of the prior 20 days (the exit level); NaN for the first 20 days. */
  low20: Series;
}

/** core._stats output. */
export interface Stats {
  n: number;
  win: number;
  avg: number;
}

/** One strategy that passed the full-period test (core.approved row). */
export interface RuleRow extends Stats {
  key: string;
  r_avg: number;
  r_n: number;
}

/** core.approved output for one time frame. */
export interface Plan {
  market: Stats;
  market_recent: Stats;
  ok: RuleRow[];
  dropped: RuleRow[];
  filter: "volume" | null;
  exit: "low20" | null;
}

/** core.approved output: one Plan per horizon name ("1 day", "1 week", "1 month"). */
export type Approved = Record<string, Plan>;

/** One entry of holdings.json (field names kept as in Python). */
export interface Holding {
  buy_date: string;
  buy_price?: number | null;
  horizon: string;
  stop_change?: number | null;
}
