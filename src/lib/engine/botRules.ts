/**
 * The old bot's strategies (engine/strategy.py TrendBreakout and engine/rules.py Combo), reduced to the buy-signal
 * columns s_<key> that core.py uses (core.BOT_KEYS). The market is its own "index" (core.prepare calls
 * combo.bind_index(df) with the same data), so the index checks use the market's own close.
 */
import {
  and, asFloat, atrSimple, clipLower, diff, ewmAlpha, fillna, ge, gt, le, map1, map2, priorHigh, priorMean,
  rollingMax, rollingMin, rollingStd, rollingSum, shift, sma, trueRange, zeroToNaN,
} from "./indicators.ts";
import type { Bars, Flags, Series } from "./types.ts";

/** core.PARAMS (only the entries the signal columns read). */
export const PARAMS = {
  trend_sma_fast: 50, trend_sma_slow: 200, exit_sma: 20, breakout_days: 20, volume_days: 20,
  volume_mult: 1.0, atr_days: 14, stop_atr: 2.0, trail_atr: 2.0, rank_roc_days: 63, take_profit_r: 3.0,
};
/** core.UNIVERSE: the liquidity filter is for shares, not an index. */
export const UNIVERSE = { min_price: 0, min_avg_value: 0 };

// ---------------------------------------------------------------- engine/rules.py lab indicators
/** _sma: s.rolling(n, min_periods=n).mean(). */
const _sma = sma;

/** _rsi: Wilder RSI with min_periods=n; 100 where the average loss is 0, 50 where undefined. */
export function rulesRsi(s: Series, n: number): Series {
  const d = diff(s);
  const gain = ewmAlpha(clipLower(d, 0), 1 / n, n);
  const loss = ewmAlpha(clipLower(map1(d, (x) => -x), 0), 1 / n, n);
  const lossN = zeroToNaN(loss);
  const out = map2(gain, lossN, (g, l) => 100.0 - 100.0 / (1.0 + g / l));
  return fillna(out.map((x, i) => (loss[i] === 0 ? 100.0 : x)), 50.0);
}

/** _adx: Wilder ADX with min_periods=n on every average, 0 where undefined. */
export function rulesAdx(b: Bars, n: number): Series {
  const up = diff(b.high), down = map1(diff(b.low), (x) => -x);
  const plus = up.map((u, i) => (u > down[i] && u > 0 ? u : 0.0));
  const minus = down.map((dn, i) => (dn > up[i] && dn > 0 ? dn : 0.0));
  const ew = (s: Series) => ewmAlpha(s, 1 / n, n);
  const atr = zeroToNaN(ew(trueRange(b.high, b.low, b.close)));
  const pdi = map2(ew(plus), atr, (p, a) => (100.0 * p) / a);
  const mdi = map2(ew(minus), atr, (m, a) => (100.0 * m) / a);
  const den = zeroToNaN(map2(pdi, mdi, (p, m) => p + m));
  const dx = pdi.map((p, i) => (100.0 * Math.abs(p - mdi[i])) / den[i]);
  return fillna(ew(dx), 0.0);
}

/** _pmax: highest of the n days before today (_pmin only feeds exits/stops, not used by core). */
const pmax = (s: Series, n: number): Series => rollingMax(shift(s), n);

/** _adj_slope: slope of log price divided by its standard error over w sessions (Clenow momentum). */
export function adjSlope(c: Series, w = 90): Series {
  const y = c.map(Math.log);
  const xs = Array.from({ length: w }, (_, j) => j - (w - 1) / 2);
  let sxx = 0;
  for (const x of xs) sxx += x ** 2;
  const sy = rollingSum(y, w), syy = rollingSum(y.map((v) => v ** 2), w);
  return y.map((_, i) => {
    if (i < w - 1) return NaN;
    let sxy = 0; // np.correlate(y, xs, "valid")
    for (let j = 0; j < w; j++) sxy += y[i - w + 1 + j] * xs[j];
    const slope = sxy / sxx;
    const v = syy[i] - sy[i] ** 2 / w - slope * sxy;
    const se = Math.sqrt((v !== v ? NaN : Math.max(v, 0.0)) / (w - 2));
    return slope / se;
  });
}

/** _flipper: in at 1.2x the lowest close since the last exit, out at 0.8x the highest high since buying. */
export function flipper(c: Series, h: Series): Flags {
  const n = c.length;
  const sig = new Array<boolean>(n).fill(false);
  let state = 0, low = n ? c[0] : 0, hh = 0;
  for (let i = 0; i < n; i++) {
    if (state === 0) {
      low = Math.min(low, c[i]);
      if (c[i] >= 1.2 * low) {
        sig[i] = true;
        state = 1;
        hh = 0;
      }
    } else {
      hh = Math.max(hh, h[i]);
      if (c[i] <= 0.8 * hh) {
        state = 0;
        low = c[i];
      }
    }
  }
  return sig;
}

// ---------------------------------------------------------------- strategies
/** TrendBreakout.prepare()["signal"]: new 20-day high, above the 50/200-day averages, volume above average. */
export function trendBreakout(b: Bars): Flags {
  const p = PARAMS, u = UNIVERSE, c = b.close;
  const smaFast = sma(c, p.trend_sma_fast), smaSlow = sma(c, p.trend_sma_slow);
  const highN = priorHigh(b.high, p.breakout_days);
  const volAvg = priorMean(b.volume, p.volume_days);
  const atr = atrSimple(b.high, b.low, c, p.atr_days);
  const valueAvg = sma(map2(c, b.volume, (x, v) => x * v), p.volume_days);
  return c.map((x, i) =>
    x > smaFast[i] && x > smaSlow[i] // trend
    && x > highN[i] // breakout
    && b.volume[i] > volAvg[i] * p.volume_mult // volume
    && x >= u.min_price && valueAvg[i] >= u.min_avg_value // liquid
    && smaSlow[i] === smaSlow[i] && atr[i] === atr[i] && highN[i] === highN[i] && volAvg[i] === volAvg[i]); // ready
}

/** Combo.prepare() s_<key> columns for the bot keys core uses, keyed without the "s_" prefix. */
export function botSignals(b: Bars): Record<string, Flags> {
  const { close: c, high: h } = b;
  const warm = (k: number): Flags => c.map((_, i) => i >= k - 1);
  // bind_index(df): the market is its own index
  const ma200 = _sma(c, 200);
  const above = gt(c, ma200);
  const above5 = rollingMin(asFloat(above), 5).map((x) => x === 1.0);
  const [s50, s100, s200, s300] = [50, 100, 200, 300].map((k) => _sma(c, k));
  const own252 = map2(c, shift(c, 252), (a, z) => a / z - 1.0);
  const rsi2 = rulesRsi(c, 2), adx7 = rulesAdx(b, 7);
  const S: Record<string, Flags> = {};

  S.trend_breakout = trendBreakout(b);
  // Turtle system 2
  S.turtle_s2 = and(gt(s50, s300), above, warm(305), gt(c, pmax(h, 55)));
  // Antonacci: absolute momentum
  const exc = own252.map((x) => x * 100.0 - 6.2);
  S.absolute_momentum = and(gt(exc, 0), warm(254));
  // Radge family
  S.new_yearly_high = and(gt(c, pmax(h, 250)), warm(252));
  const gc = gt(s50, s200);
  const conf = rollingMin(asFloat(gc), 5).map((x) => x === 1.0);
  S.golden_cross = and(gc, conf, warm(205));
  const hi100 = pmax(h, 100);
  S.trendpilot = and(above5, gt(c, hi100), warm(105));
  S.hundred_day_high = and(gt(c, hi100), warm(102));
  // Clenow
  S.clenow_tf = and(gt(s50, s100), above, gt(c, pmax(h, 50)), warm(105));
  const adj = adjSlope(c, 90);
  S.clenow_momentum = and(above, gt(c, s100), warm(100), adj.map((x) => x === x));
  // Mean reversion (long only)
  S.mean_reversion = and(gt(c, s200), warm(205), le(rsi2, 10), ge(adx7, 50));
  // Trend 200
  S.trend200 = and(gt(c, s200), warm(200));
  // 20% Flipper (needs 30 sessions of history)
  const f = flipper(c, h);
  S.flipper = f.map((x, i) => x && i >= 30);
  // Bollinger breakout: 100-day average plus 3 population deviations
  const m100 = _sma(c, 100), sd100 = rollingStd(c, 100, 0);
  S.bollinger = and(c.map((x, i) => x > m100[i] + 3 * sd100[i]), warm(100));
  // Longboard: highest close of the last 3 years (756 sessions, min_periods=1)
  S.longboard = and(gt(c, rollingMax(shift(c), 756, 1)), warm(252));
  return S;
}
