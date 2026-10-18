/** Keys, display names and rule texts (core.BOT_KEYS, core.KEYS, core.NAMES, core.RULE_TEXT) and core constants. */
import { LABELS as BOOK_LABELS, RULES as BOOK_RULES } from "./bookRules.ts";

/** engine/rules.py LABELS. */
export const BOT_LABELS: Record<string, string> = {
  trend_breakout: "Trend Breakout",
  bollinger: "Bollinger Breakout",
  flipper: "20% Flipper",
  trendpilot: "TrendPilot",
  new_yearly_high: "New Yearly High",
  nifty_mom30: "Momentum 30 (half-year)",
  hundred_day_high: "100-Day High",
  longboard: "Longboard (3-year high)",
  trend200: "Trend 200",
  sepa: "SEPA (Minervini)",
  golden_cross: "Golden Cross",
  clenow_tf: "Clenow Trend Following",
  mean_reversion: "Mean Reversion",
  clenow_momentum: "Clenow Momentum",
  dual_momentum: "Dual Momentum",
  absolute_momentum: "Absolute Momentum",
  relative_momentum: "Relative Momentum",
  turtle_s2: "Turtle System 2",
  gem: "GEM",
  weekly_rotation: "Weekly Rotation",
  fear_pullback: "Fear Pullback",
};

/** engine/rules.py WHY (buy reason per bot rule). */
export const WHY: Record<string, string> = {
  bollinger: "close above the 100-day average plus 3 deviations",
  flipper: "close 20% above its lowest close since the last sell signal",
  trendpilot: "new 100-day high, index above its 200-day average for 5 sessions",
  new_yearly_high: "new 250-day high",
  nifty_mom30: "in the top 30 by risk-adjusted 6 and 12-month momentum at the half-year review",
  hundred_day_high: "new 100-day high",
  longboard: "highest close of the last 3 years",
  trend200: "close above the 200-day average",
  sepa: "trend template, tighter swings, 20-day high on 1.5x volume",
  golden_cross: "50-day average above the 200-day for 5 sessions",
  clenow_tf: "new 50-day high, 50-day average above the 100-day, index up",
  mean_reversion: "2-day RSI 10 or less in an uptrend with a strong 7-day ADX",
  clenow_momentum: "steady 90-day climb above the 100-day average, index up",
  dual_momentum: "12-month return above 6.2%",
  absolute_momentum: "12-month return above 6.2%",
  relative_momentum: "12-month return beats the index",
  turtle_s2: "new 55-day high, 50-day average above the 300-day, index up",
  gem: "index 12-month return above 6.2% and the share beats it",
  weekly_rotation: "in the week's top 10 by 200-day return",
  fear_pullback: "fear dip in an uptrend: 3-day RSI under 30, ADX over 45, wide daily range",
};

/** Bot strategies used (Dual Momentum left out: same buy signal as Absolute Momentum). */
export const BOT_KEYS = [
  "mean_reversion", "trend_breakout", "turtle_s2", "clenow_tf", "trend200", "golden_cross", "trendpilot",
  "hundred_day_high", "clenow_momentum", "absolute_momentum", "new_yearly_high", "bollinger", "flipper", "longboard",
];
/** All 38 strategy keys, in the order core tests them. */
export const KEYS = [...BOT_KEYS, ...Object.keys(BOOK_LABELS)];
/** Display name per key. */
export const NAMES: Record<string, string> = { ...BOT_LABELS, ...BOOK_LABELS };

const cap = (s: string) => s[0].toUpperCase() + s.slice(1) + ".";
/** One-line buy rule per key. */
export const RULE_TEXT: Record<string, string> = {
  ...Object.fromEntries(BOT_KEYS.filter((k) => k in WHY).map((k) => [k, cap(WHY[k])])),
  trend_breakout: "New 20-day high, close above the 50- and 200-day averages, volume above its 20-day average.",
  ...BOOK_RULES,
};

export const MARKETS: Record<string, string> = { "Nifty 50": "^NSEI", Sensex: "^BSESN", "Crude oil (Brent)": "BZ=F" };
/** Plan name -> holding days. */
export const HORIZONS: Record<string, number> = { "1 day": 1, "1 week": 5, "1 month": 21 };
export const TEST_START = "2010-01-01";
export const RECENT_START = "2019-01-01"; // luck check: must also win on recent years alone
export const COST = 0.001; // 0.1% per round trip
export const MIN_TRADES = 20; // fewer past trades than this = not reliable, not used
export const MIN_RECENT = 8; // trades needed in the recent years for the luck check
export const ACTIONS = ["🟢 BUY", "🔴 SELL"];
