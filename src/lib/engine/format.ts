/**
 * Python number formatting, exactly: f"{x:.2f}", f"{x:+.2f}", f"{x:,.2f}", f"{x:.0f}", f"{x:+g}", f"{x:.0%}".
 * Python rounds the exact binary value half-to-even; JS toFixed rounds exact ties up, so ties are fixed here.
 */

/** |x| rounded to d decimals as Python does (round-half-even on the exact binary value). */
function fixedAbs(ax: number, d: number): string {
  const js = ax.toFixed(d); // nearest; on an exact tie JS picks the larger
  const exact = ax.toFixed(100); // the exact decimal expansion (always finite for a double this size)
  const dot = exact.indexOf(".");
  const rest = exact.slice(dot + 1 + d);
  if (!/^50*$/.test(rest)) return js; // not a tie
  const down = d ? exact.slice(0, dot + 1 + d) : exact.slice(0, dot);
  const lastDigit = Number(down[down.length - 1]);
  return lastDigit % 2 === 0 ? down : js;
}

/** Python format spec for floats: [+][,].{d}f. */
export function fmtFixed(x: number, d: number, opts: { plus?: boolean; comma?: boolean } = {}): string {
  const neg = x < 0 || Object.is(x, -0);
  const sign = neg ? "-" : opts.plus ? "+" : "";
  if (x !== x) return (opts.plus ? "+" : "") + "nan";
  if (!isFinite(x)) return sign + "inf";
  let s = fixedAbs(Math.abs(x), d);
  if (opts.comma) {
    const [ip, fp] = s.split(".");
    s = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fp !== undefined ? "." + fp : "");
  }
  return sign + s;
}

/** f"{x:+.2f}" */
export const plus2 = (x: number): string => fmtFixed(x, 2, { plus: true });
/** f"{x:,.2f}" */
export const comma2 = (x: number): string => fmtFixed(x, 2, { comma: true });
/** f"{x:.0f}" */
export const fixed0 = (x: number): string => fmtFixed(x, 0);
/** f"{x:.0%}" (Python multiplies by 100 first, then formats like 'f'). */
export const pct0 = (x: number): string => fmtFixed(x * 100, 0) + "%";

/** f"{x:g}" / f"{x:+g}": 6 significant digits, trailing zeros removed, exponent form outside 1e-4 .. 1e6. */
export function fmtG(x: number, plus = false): string {
  const neg = x < 0 || Object.is(x, -0);
  const sign = neg ? "-" : plus ? "+" : "";
  if (x !== x) return (plus ? "+" : "") + "nan";
  if (!isFinite(x)) return sign + "inf";
  const ax = Math.abs(x);
  if (ax === 0) return sign + "0";
  const p = 6;
  const exp = Number(ax.toExponential(p - 1).split("e")[1]); // exponent after rounding to 6 digits
  if (exp >= -4 && exp < p) {
    let s = fixedAbs(ax, p - 1 - exp);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return sign + s;
  }
  const [mant, e] = ax.toExponential(p - 1).split("e");
  const m = mant.includes(".") ? mant.replace(/0+$/, "").replace(/\.$/, "") : mant;
  const en = Number(e);
  return sign + m + "e" + (en < 0 ? "-" : "+") + String(Math.abs(en)).padStart(2, "0");
}
