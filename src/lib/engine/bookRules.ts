/**
 * Book rules (port of book_rules.py): Murphy, "Technical Analysis of the Financial Markets", and simplified
 * Bulkowski chart patterns ("Encyclopedia of Chart Patterns"). Long only; each rule is a buy signal on the daily close.
 */
import {
  and, asFloat, clipLower, clipUpper, diff, ewmAlpha, ewmSpan, gt, isNum, le, lt, map1, map2, not,
  npMean, rollingMax, rollingMean, rollingMin, rollingStd, rowMax, rowMin, shift, shiftFlags, trueRange,
} from "./indicators.ts";
import type { Bars, Flags, Series } from "./types.ts";

export const LABELS: Record<string, string> = {
  book_ema50: "EMA 50 cross (Murphy)",
  book_ema9_21: "EMA 9/21 cross (Murphy)",
  book_4_9_18: "4-9-18 MA (Murphy)",
  book_bb_squeeze: "Bollinger squeeze (Murphy)",
  book_rsi30: "RSI back above 30 (Murphy)",
  book_rsi_div: "RSI divergence (Murphy)",
  book_stoch: "Stochastic below 20 (Murphy)",
  book_macd: "MACD cross below zero (Murphy)",
  book_key_reversal: "Key reversal day (Murphy)",
  book_hammer: "Hammer (Murphy)",
  book_engulfing: "Bullish engulfing (Murphy)",
  book_morning_star: "Morning star (Murphy)",
  book_obv: "OBV leads price (Murphy)",
  book_bull_flag: "Bull flag (Bulkowski)",
  book_pipe: "Pipe bottom (Bulkowski)",
  book_valleys: "Three rising valleys (Bulkowski)",
  book_double_bottom: "Double bottom (Bulkowski)",
  // added 2026-10-16 after the second test round
  book_cci_m100: "CCI back above -100",
  book_cci_0: "CCI above 0",
  book_mom10: "Momentum 10 above 0",
  book_rsi50: "RSI above 50",
  book_sma20: "Close above 20-day average",
  book_retrace: "33–66% pullback (Murphy)",
  book_rectangle: "Rectangle breakout (Bulkowski)",
};

export const RULES: Record<string, string> = {
  book_ema50: "Close crosses above its 50-day EMA.",
  book_ema9_21: "9-day EMA crosses above the 21-day EMA.",
  book_4_9_18: "4-day > 9-day > 18-day average lines up today (not yesterday).",
  book_bb_squeeze: "Bollinger Bands (20, 2) were their narrowest in 120 days within the last 5 days, and close crosses above the upper band.",
  book_rsi30: "14-day RSI crosses back above 30.",
  book_rsi_div: "Close at a 20-day low while 14-day RSI is above its previous 20-day low, and RSI under 40.",
  book_stoch: "Slow stochastic (14, 3, 3) %K crosses above %D with both under 20.",
  book_macd: "MACD (12, 26, 9) crosses above its signal line while below zero.",
  book_key_reversal: "Low is a 20-day low and close is above yesterday's high.",
  book_hammer: "Lower wick at least 2× the body, small upper wick, at a 20-day low.",
  book_engulfing: "Up day whose body covers yesterday's down body, with close under the 20-day average.",
  book_morning_star: "Big down day, small day below it, then an up day closing above the middle of the big down day.",
  book_obv: "On-balance volume at a 20-day high while price is not, close above the 50-day average (needs real volume).",
  book_bull_flag: "Rise of 2.5× ATR in 5–10 days, a 3–5 day pullback of at most half, then close above yesterday's high.",
  book_pipe: "Two wide-range days in a row with almost equal lows at a 20-day low.",
  book_valleys: "Three higher swing lows in a row, and close above the high between the last two.",
  book_double_bottom: "Two swing lows 10–60 days apart within 3%, and close breaks above the peak between them.",
  book_cci_m100: "20-day CCI crosses back above -100.",
  book_cci_0: "20-day CCI crosses above 0.",
  book_mom10: "Close minus the close 10 days ago turns from zero or below to above zero.",
  book_rsi50: "14-day RSI crosses above 50.",
  book_sma20: "Close crosses above its 20-day average.",
  book_retrace: "Above the 200-day average, price falls back 33–66% of its last rise to a 20-day high, then closes up (first time only).",
  book_rectangle: "In the last 40 days two swing highs and two swing lows each within 1.5%, range at most 12%; close breaks above the top.",
};

/** _wilder: s.ewm(alpha=1/n, adjust=False).mean() — note: NO min_periods here. */
const wilder = (s: Series, n: number): Series => ewmAlpha(s, 1 / n);

/** _cross_up: a > b today and a <= b yesterday. */
function crossUp(a: Series, b: Series | number): Flags {
  const bb = typeof b === "number" ? a.map(() => b) : b;
  return a.map((x, i) => x > bb[i] && i > 0 && a[i - 1] <= bb[i - 1]);
}

/** max / min of arr[from, to) (numpy slice .max() / .min(); the callers never pass an empty slice). */
function sliceMax(arr: Series, from: number, to: number): number {
  let m = -Infinity;
  for (let j = from; j < to; j++) if (arr[j] > m || arr[j] !== arr[j]) m = arr[j] !== arr[j] ? NaN : arr[j];
  return m;
}
function sliceMin(arr: Series, from: number, to: number): number {
  let m = Infinity;
  for (let j = from; j < to; j++) if (arr[j] < m || arr[j] !== arr[j]) m = arr[j] !== arr[j] ? NaN : arr[j];
  return m;
}

/** 5-bar swing points: index j where arr[j] beats the 2 bars on each side (strictly). */
function swingPoints(arr: Series, high: boolean): { js: number[]; vs: number[] } {
  const js: number[] = [], vs: number[] = [];
  for (let j = 2; j < arr.length - 2; j++) {
    const x = arr[j];
    const ok = high
      ? x > arr[j - 1] && x > arr[j - 2] && x > arr[j + 1] && x > arr[j + 2]
      : x < arr[j - 1] && x < arr[j - 2] && x < arr[j + 1] && x < arr[j + 2];
    if (ok) {
      js.push(j);
      vs.push(x);
    }
  }
  return { js, vs };
}

/** bisect.bisect_left / bisect_right on a sorted number list. */
function bisectLeft(a: number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function bisectRight(a: number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Buy signal per rule (true on the signal day's close), keyed like LABELS. */
export function bookSignals(b: Bars): Record<string, Flags> {
  const { open: o, high: h, low: l, close: c, volume: v } = b;
  const N = c.length;
  const ema = (n: number) => ewmSpan(c, n);
  const sma = (n: number) => rollingMean(c, n);
  const d = diff(c);
  const g14 = wilder(clipLower(d, 0), 14);
  const l14 = wilder(map1(clipUpper(d, 0), (x) => -x), 14);
  const r14 = map2(g14, l14, (g, x) => 100 - 100 / (1 + g / x));
  const pc = shift(c);
  const a14 = wilder(trueRange(h, l, c), 14);
  const S: Record<string, Flags> = {};

  S.book_ema50 = crossUp(c, ema(50));
  S.book_ema9_21 = crossUp(ema(9), ema(21));
  const s4 = sma(4), s9 = sma(9), s18 = sma(18);
  const al = and(gt(s4, s9), gt(s9, s18));
  S.book_4_9_18 = and(al, not(shiftFlags(al, 1, false)));

  // Bollinger squeeze (sample std, ddof=1)
  const mid = sma(20), sd = rollingStd(c, 20, 1);
  const upB = map2(mid, sd, (m, s) => m + 2 * s), loB = map2(mid, sd, (m, s) => m - 2 * s);
  const bw = upB.map((u, i) => (u - loB[i]) / mid[i]);
  const bwMin = rollingMin(bw, 120);
  const hit = bw.map((x, i) => x <= bwMin[i] && isNum(x));
  S.book_bb_squeeze = and(gt(rollingMax(asFloat(hit), 5), 0), crossUp(c, upB));

  S.book_rsi30 = crossUp(r14, 30.0);
  S.book_rsi_div = and(le(c, rollingMin(c, 20)), gt(r14, rollingMin(shift(r14), 20)), lt(r14, 40));

  // Slow stochastic (14, 3, 3)
  const ll14 = rollingMin(l, 14), hh14 = rollingMax(h, 14);
  const fk = c.map((x, i) => (100 * (x - ll14[i])) / (hh14[i] - ll14[i]));
  const k = rollingMean(fk, 3), dd = rollingMean(k, 3);
  S.book_stoch = and(crossUp(k, dd), lt(k, 20), lt(dd, 20));

  const macd = map2(ema(12), ema(26), (a, z) => a - z);
  S.book_macd = and(crossUp(macd, ewmSpan(macd, 9)), lt(macd, 0));

  const lMin20 = rollingMin(l, 20);
  S.book_key_reversal = and(le(l, lMin20), gt(c, shift(h)));

  // Candles
  const body = map2(c, o, (x, y) => Math.abs(x - y)), rng = map2(h, l, (x, y) => x - y);
  const lw = map2(rowMin(o, c), l, (x, y) => x - y);
  const uw = map2(h, rowMax(o, c), (x, y) => x - y);
  S.book_hammer = c.map((_, i) =>
    lw[i] >= 2 * body[i] && uw[i] <= 0.3 * rng[i] && body[i] > 0 && l[i] <= lMin20[i]);
  const sma20 = sma(20), o1 = shift(o);
  S.book_engulfing = c.map((x, i) => pc[i] < o1[i] && x > o[i] && o[i] <= pc[i] && x >= o1[i] && x < sma20[i]);
  const b2 = shift(body, 2), c2 = shift(c, 2), o2 = shift(o, 2), a2 = shift(a14, 2), body1 = shift(body, 1), c1 = pc;
  S.book_morning_star = c.map((x, i) =>
    c2[i] < o2[i] && b2[i] > 0.6 * a2[i] && body1[i] < 0.3 * b2[i] && c1[i] < c2[i] && x > o[i]
    && x > (o2[i] + c2[i]) / 2);

  // On-balance volume (cumulative sum, sequential like numpy's cumsum)
  const obv = new Array<number>(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const sg = d[i] !== d[i] ? 0 : Math.sign(d[i]);
    acc += sg * v[i];
    obv[i] = acc;
  }
  const realVolume = rollingMin(asFloat(gt(v, 0)), 20).map((x) => x === 1);
  S.book_obv = and(map2Flags(obv, rollingMax(obv, 20), (x, m) => x >= m), lt(c, rollingMax(c, 20)), gt(c, sma(50)),
    realVolume);

  // Bull flag: pole of 2.5x ATR in 5-10 days, 3-5 day pullback of at most half, close above yesterday's high
  const flag = new Array<boolean>(N).fill(false);
  for (let t = 16; t < N; t++) {
    if (!(c[t] > h[t - 1])) continue;
    for (const kk of [3, 4, 5]) {
      const e = t - kk;
      if (c[e] < sliceMax(c, e, t)) continue; // the pole top must be the highest close since
      let found = false;
      for (let n = 5; n < 11 && !found; n++) {
        if (e - n < 0) continue;
        found = c[e] - c[e - n] >= 2.5 * a14[e] && c[e] - sliceMin(l, e + 1, t + 1) <= 0.5 * (c[e] - c[e - n]);
      }
      if (found) {
        flag[t] = true;
        break;
      }
    }
  }
  S.book_bull_flag = flag;

  // Pipe bottom
  const lows = rowMin(l, shift(l));
  const rng1 = shift(rng), a14p = shift(a14), l1 = shift(l);
  S.book_pipe = c.map((_, i) =>
    rng[i] > 1.5 * a14[i] && rng1[i] > 1.5 * a14p[i] && Math.abs(l[i] - l1[i]) <= 0.005 * lows[i]
    && lows[i] <= lMin20[i]);

  // Three rising valleys and double bottom, from 5-bar swing lows confirmed 2 bars later
  const sl = swingPoints(l, false);
  const valleys = new Array<boolean>(N).fill(false), double = new Array<boolean>(N).fill(false);
  let p = 0;
  for (let t = 0; t < N; t++) {
    while (p < sl.js.length && sl.js[p] + 2 <= t) p++;
    if (p >= 3) {
      const v1 = sl.vs[p - 3], j2 = sl.js[p - 2], v2 = sl.vs[p - 2], j3 = sl.js[p - 1], v3 = sl.vs[p - 1];
      if (v1 < v2 && v2 < v3 && j3 - j2 > 1) valleys[t] = c[t] > sliceMax(h, j2 + 1, j3);
    }
    if (p >= 2 && t >= 1) {
      const j1 = sl.js[p - 2], v1 = sl.vs[p - 2], j2 = sl.js[p - 1], v2 = sl.vs[p - 1];
      const lo2 = Math.min(v1, v2);
      if (10 <= j2 - j1 && j2 - j1 <= 60 && Math.abs(v1 - v2) / lo2 <= 0.03) {
        const peak = sliceMax(h, j1 + 1, j2);
        double[t] = peak >= 1.05 * lo2 && c[t] > peak && c[t - 1] <= peak;
      }
    }
  }
  S.book_valleys = valleys;
  S.book_double_bottom = double;

  // ---- second round
  // CCI(20) with the mean absolute deviation (numpy mean of each 20-day window)
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
  const mad = new Array<number>(N).fill(NaN);
  for (let i = 19; i < N; i++) {
    const win = tp.slice(i - 19, i + 1);
    const m = npMean(win);
    mad[i] = npMean(win.map((x) => Math.abs(x - m)));
  }
  const tpMean = rollingMean(tp, 20);
  const cci = tp.map((x, i) => (x - tpMean[i]) / (0.015 * mad[i]));
  S.book_cci_m100 = crossUp(cci, -100.0);
  S.book_cci_0 = crossUp(cci, 0.0);
  const mom = map2(c, shift(c, 10), (a, z) => a - z);
  S.book_mom10 = mom.map((x, i) => x > 0 && i > 0 && mom[i - 1] <= 0);
  S.book_rsi50 = crossUp(r14, 50.0);
  S.book_sma20 = crossUp(c, sma20);

  // 33-66% retracement of the last rise to a 20-day high, above the 200-day average (first time per high)
  const s200 = sma(200);
  const retrace = new Array<boolean>(N).fill(false);
  let firedFor = -1;
  for (let t = 80; t < N; t++) {
    let jb = t - 20; // latest day of the prior 20-day high (np.argmax on the reversed window)
    for (let j = t - 20; j < t; j++) if (h[j] >= h[jb]) jb = j;
    if (jb - 60 < 0) continue;
    const B = h[jb], A = sliceMin(l, jb - 60, jb);
    if (c[t] > s200[t] && B - 0.66 * (B - A) <= c[t] && c[t] <= B - 0.33 * (B - A) && c[t] > c[t - 1] && firedFor !== jb) {
      retrace[t] = true;
      firedFor = jb;
    }
  }
  S.book_retrace = retrace;

  // Rectangle: two swing highs and two swing lows within 1.5% in the last 40 days, close breaks above the top
  const sh = swingPoints(h, true), sw = swingPoints(l, false);
  const rect = new Array<boolean>(N).fill(false);
  for (let t = 41; t < N; t++) {
    const hs = sh.vs.slice(bisectLeft(sh.js, t - 40), bisectRight(sh.js, t - 2)); // swings known by today
    const ls = sw.vs.slice(bisectLeft(sw.js, t - 40), bisectRight(sw.js, t - 2));
    if (hs.length < 2 || ls.length < 2) continue;
    const top = Math.max(...hs), bottom = Math.min(...ls);
    if (!(c[t] > top && c[t - 1] <= top)) continue;
    if (hs.filter((x) => x >= top / 1.015).length >= 2 && ls.filter((x) => x <= bottom * 1.015).length >= 2
      && (top - bottom) / c[t] <= 0.12) rect[t] = true;
  }
  S.book_rectangle = rect;
  return S;
}

/** Element-wise comparison through a custom predicate. */
function map2Flags(a: Series, b: Series, f: (x: number, y: number) => boolean): Flags {
  return a.map((x, i) => f(x, b[i]));
}
