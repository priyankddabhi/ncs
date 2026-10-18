/**
 * pandas/numpy-exact series primitives, plus engine/indicators.py.
 *
 * The rolling and ewm functions copy the arithmetic of pandas 2.x (pandas/_libs/window/aggregations.pyx)
 * step by step, so the results are bit-identical and signals that compare two close numbers flip on the same day.
 * NaN means "missing", like in pandas; every comparison with NaN is false.
 */
import type { Flags, Series } from "./types.ts";

// ---------------------------------------------------------------- element-wise helpers
export const isNum = (x: number): boolean => x === x; // not NaN

/** s.shift(k): value from k days earlier, NaN for the first k days. */
export function shift(s: Series, k = 1): Series {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = i - k >= 0 && i - k < s.length ? s[i - k] : NaN;
  return out;
}

/** Shift a bool Series with fill_value (pandas `s.shift(fill_value=False)`). */
export function shiftFlags(s: Flags, k = 1, fill = false): Flags {
  const out = new Array<boolean>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = i - k >= 0 ? s[i - k] : fill;
  return out;
}

/** s.diff(): s[i] - s[i-1]. */
export function diff(s: Series): Series {
  return s.map((x, i) => (i === 0 ? NaN : x - s[i - 1]));
}

/** Apply f to each element (NaN flows through f's own arithmetic). */
export const map1 = (a: Series, f: (x: number, i: number) => number): Series => a.map(f);
export const map2 = (a: Series, b: Series, f: (x: number, y: number) => number): Series => a.map((x, i) => f(x, b[i]));

/** Element-wise comparisons, false where either side is NaN (like pandas). */
export const gt = (a: Series, b: Series | number): Flags => a.map((x, i) => x > (typeof b === "number" ? b : b[i]));
export const ge = (a: Series, b: Series | number): Flags => a.map((x, i) => x >= (typeof b === "number" ? b : b[i]));
export const lt = (a: Series, b: Series | number): Flags => a.map((x, i) => x < (typeof b === "number" ? b : b[i]));
export const le = (a: Series, b: Series | number): Flags => a.map((x, i) => x <= (typeof b === "number" ? b : b[i]));

/** a & b & c ... for bool Series. */
export function and(...xs: Flags[]): Flags {
  const out = xs[0].slice();
  for (let k = 1; k < xs.length; k++) for (let i = 0; i < out.length; i++) out[i] = out[i] && xs[k][i];
  return out;
}

export const not = (a: Flags): Flags => a.map((x) => !x);

/** Bool series as 0/1 floats (`astype(float)` / `astype(int)`). */
export const asFloat = (a: Flags): Series => a.map((x) => (x ? 1 : 0));

/** s.replace(0.0, np.nan). */
export const zeroToNaN = (s: Series): Series => s.map((x) => (x === 0 ? NaN : x));

/** s.fillna(v). */
export const fillna = (s: Series, v: number): Series => s.map((x) => (x === x ? x : v));

/** s.clip(lower=lo) / s.clip(upper=hi); NaN stays NaN. */
export const clipLower = (s: Series, lo: number): Series => s.map((x) => (x === x ? (x < lo ? lo : x) : NaN));
export const clipUpper = (s: Series, hi: number): Series => s.map((x) => (x === x ? (x > hi ? hi : x) : NaN));

/** Row-wise max / min of several columns, skipping NaN (DataFrame.max(axis=1)); NaN if all are NaN. */
export function rowMax(...cols: Series[]): Series {
  return cols[0].map((_, i) => {
    let m = NaN;
    for (const c of cols) if (c[i] === c[i] && !(m >= c[i])) m = c[i];
    return m;
  });
}
export function rowMin(...cols: Series[]): Series {
  return cols[0].map((_, i) => {
    let m = NaN;
    for (const c of cols) if (c[i] === c[i] && !(m <= c[i])) m = c[i];
    return m;
  });
}

// ---------------------------------------------------------------- numpy sums
/** numpy's pairwise summation (pairwise_sum_DOUBLE) of a[lo, lo+n). */
function pairwise(a: ArrayLike<number>, lo: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[lo + i];
    return res;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = (r[0] + r[1] + (r[2] + r[3])) + (r[4] + r[5] + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
}

/** np.sum of a 1-d float64 array (the add.reduce identity -0.0 plus a pairwise sum). */
export function npSum(a: ArrayLike<number>): number {
  return -0 + pairwise(a, 0, a.length);
}

/** pandas Series.mean() without bottleneck: np.sum / count (no NaN in our inputs). */
export function npMean(a: ArrayLike<number>): number {
  return npSum(a) / a.length;
}

// ---------------------------------------------------------------- rolling windows (fixed window, min_periods)
/** pandas rolling(w, min_periods).mean() — roll_mean with Kahan summation and the same-value guard. */
export function rollingMean(v: Series, w: number, minp = w): Series {
  const N = v.length;
  const out = new Array<number>(N);
  let sum = 0, compAdd = 0, compRem = 0, nobs = 0, negCt = 0, same = 0, prev = NaN;
  const add = (val: number) => {
    if (val !== val) return;
    nobs++;
    const y = val - compAdd;
    const t = sum + y;
    compAdd = t - sum - y;
    sum = t;
    if (val < 0 || Object.is(val, -0)) negCt++;
    if (val === prev) same++;
    else same = 1;
    prev = val;
  };
  const remove = (val: number) => {
    if (val !== val) return;
    nobs--;
    const y = -val - compRem;
    const t = sum + y;
    compRem = t - sum - y;
    sum = t;
    if (val < 0 || Object.is(val, -0)) negCt--;
  };
  for (let i = 0; i < N; i++) {
    const s = Math.max(0, i - w + 1), e = i + 1;
    if (i === 0) {
      prev = v[s];
      for (let j = s; j < e; j++) add(v[j]);
    } else {
      const s0 = Math.max(0, i - w);
      for (let j = s0; j < s; j++) remove(v[j]);
      add(v[i]);
    }
    let r = NaN;
    if (nobs >= minp && nobs > 0) {
      r = sum / nobs;
      if (same >= nobs) r = prev;
      else if (negCt === 0 && r < 0) r = 0;
      else if (negCt === nobs && r > 0) r = 0;
    }
    out[i] = r;
  }
  return out;
}

/** pandas rolling(w, min_periods).sum() — roll_sum with Kahan summation and the same-value guard. */
export function rollingSum(v: Series, w: number, minp = w): Series {
  const N = v.length;
  const out = new Array<number>(N);
  let sum = 0, compAdd = 0, compRem = 0, nobs = 0, same = 0, prev = NaN;
  const add = (val: number) => {
    if (val !== val) return;
    nobs++;
    const y = val - compAdd;
    const t = sum + y;
    compAdd = t - sum - y;
    sum = t;
    if (val === prev) same++;
    else same = 1;
    prev = val;
  };
  const remove = (val: number) => {
    if (val !== val) return;
    nobs--;
    const y = -val - compRem;
    const t = sum + y;
    compRem = t - sum - y;
    sum = t;
  };
  for (let i = 0; i < N; i++) {
    const s = Math.max(0, i - w + 1);
    if (i === 0) {
      prev = v[0];
      add(v[0]);
    } else {
      for (let j = Math.max(0, i - w); j < s; j++) remove(v[j]);
      add(v[i]);
    }
    let r = NaN;
    if (nobs === 0 && minp === 0) r = 0;
    else if (nobs >= minp) r = same >= nobs ? prev * nobs : sum;
    out[i] = r;
  }
  return out;
}

/** pandas rolling(w, min_periods).var(ddof) — roll_var: Welford with Kahan, same-value guard. */
export function rollingVar(v: Series, w: number, ddof = 1, minp = w): Series {
  const N = v.length;
  const out = new Array<number>(N);
  minp = Math.max(minp, 1);
  let nobs = 0, mean = 0, ssqdm = 0, compAdd = 0, compRem = 0, same = 0, prev = NaN;
  const add = (val: number) => {
    if (val !== val) return;
    nobs++;
    if (val === prev) same++;
    else same = 1;
    prev = val;
    const prevMean = mean - compAdd;
    const y = val - compAdd;
    const t = y - mean;
    compAdd = t + mean - y;
    const delta = t;
    if (nobs) mean = mean + delta / nobs;
    else mean = 0;
    ssqdm = ssqdm + (val - prevMean) * (val - mean);
  };
  const remove = (val: number) => {
    if (val !== val) return;
    nobs--;
    if (nobs) {
      const prevMean = mean - compRem;
      const y = val - compRem;
      const t = y - mean;
      compRem = t + mean - y;
      const delta = t;
      mean = mean - delta / nobs;
      ssqdm = ssqdm - (val - prevMean) * (val - mean);
    } else {
      mean = 0;
      ssqdm = 0;
    }
  };
  for (let i = 0; i < N; i++) {
    const s = Math.max(0, i - w + 1);
    if (i === 0) {
      prev = v[0];
      add(v[0]);
    } else {
      for (let j = Math.max(0, i - w); j < s; j++) remove(v[j]);
      add(v[i]);
    }
    let r = NaN;
    if (nobs >= minp && nobs > ddof) r = nobs === 1 || same >= nobs ? 0 : ssqdm / (nobs - ddof);
    out[i] = r;
  }
  return out;
}

/** pandas rolling(w).std(ddof): sqrt of the rolling variance, negatives set to 0 (zsqrt). */
export function rollingStd(v: Series, w: number, ddof = 1, minp = w): Series {
  return rollingVar(v, w, ddof, minp).map((x) => (x < 0 ? 0 : Math.sqrt(x)));
}

/** Rolling max / min over the last w values, skipping NaN; NaN if fewer than minp real values. */
function rollingExtreme(v: Series, w: number, minp: number, isMax: boolean): Series {
  const N = v.length;
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let m = NaN, nobs = 0;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) {
      const x = v[j];
      if (x !== x) continue;
      nobs++;
      if (m !== m || (isMax ? x > m : x < m)) m = x;
    }
    out[i] = nobs >= minp && nobs > 0 ? m : NaN;
  }
  return out;
}
export const rollingMax = (v: Series, w: number, minp = w): Series => rollingExtreme(v, w, minp, true);
export const rollingMin = (v: Series, w: number, minp = w): Series => rollingExtreme(v, w, minp, false);

// ---------------------------------------------------------------- exponential averages
/** pandas ewm(..., adjust=False, ignore_na=False).mean() for a given centre of mass. */
function ewmCom(vals: Series, com: number, minPeriods: number): Series {
  const minp = Math.max(minPeriods, 1);
  const alpha = 1 / (1 + com);
  const oldWtFactor = 1 - alpha;
  const newWt = alpha; // adjust=False
  const N = vals.length;
  const out = new Array<number>(N);
  if (!N) return out;
  let weighted = vals[0];
  let nobs = weighted === weighted ? 1 : 0;
  out[0] = nobs >= minp ? weighted : NaN;
  let oldWt = 1;
  for (let i = 1; i < N; i++) {
    const cur = vals[i];
    const isObs = cur === cur;
    if (isObs) nobs++;
    if (weighted === weighted) {
      oldWt *= oldWtFactor; // ignore_na=False: missing days still age the old weight
      if (isObs) {
        if (weighted !== cur) {
          weighted = oldWt * weighted + newWt * cur;
          weighted /= oldWt + newWt;
        }
        oldWt = 1;
      }
    } else if (isObs) {
      weighted = cur;
    }
    out[i] = nobs >= minp ? weighted : NaN;
  }
  return out;
}

/** s.ewm(alpha=a, adjust=False, min_periods=m).mean() (pandas turns alpha into com = (1 - a) / a). */
export const ewmAlpha = (s: Series, alpha: number, minPeriods = 0): Series => ewmCom(s, (1 - alpha) / alpha, minPeriods);

/** s.ewm(span=n, adjust=False, min_periods=m).mean() (com = (span - 1) / 2). */
export const ewmSpan = (s: Series, span: number, minPeriods = 0): Series => ewmCom(s, (span - 1) / 2, minPeriods);

// ---------------------------------------------------------------- engine/indicators.py
/** Simple moving average: s.rolling(n, min_periods=n).mean(). */
export const sma = (s: Series, n: number): Series => rollingMean(s, n, n);

/** Highest value of the n days BEFORE today. */
export const priorHigh = (s: Series, n: number): Series => rollingMax(shift(s), n, n);

/** Average of the n days BEFORE today. */
export const priorMean = (s: Series, n: number): Series => rollingMean(shift(s), n, n);

/** True range: max of high-low, |high-prev close|, |low-prev close| (NaN skipped, so day 0 is high-low). */
export function trueRange(high: Series, low: Series, close: Series): Series {
  const prev = shift(close);
  return rowMax(
    map2(high, low, (h, l) => h - l),
    map2(high, prev, (h, p) => Math.abs(h - p)),
    map2(low, prev, (l, p) => Math.abs(l - p)),
  );
}

/** engine/indicators.py atr: a SIMPLE rolling mean of the true range (not Wilder). */
export const atrSimple = (high: Series, low: Series, close: Series, n: number): Series =>
  rollingMean(trueRange(high, low, close), n, n);

/** Rate of change: s / s.shift(n) - 1. */
export const roc = (s: Series, n: number): Series => map2(s, shift(s, n), (a, b) => a / b - 1);
