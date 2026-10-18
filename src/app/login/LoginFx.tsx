"use client";
/**
 * Ambient smoke behind the PIN card: a small stable-fluids simulation (semi-Lagrangian advection, pressure
 * projection, light vorticity confinement) on a low-res grid, scaled up smoothly.
 * - The screen starts already filled with soft clouds (layered value noise); there is no emitter.
 * - A slow, ever-changing breeze (a smooth swirl field) keeps the smoke drifting and curling.
 * - Density is gently pulled back toward a slowly moving cloud pattern, so it never thins out or clumps.
 * One fixed full-screen canvas, never interactive: ~30 fps, devicePixelRatio capped at 1.5, paused while the
 * tab is hidden, one still frame under reduced motion.
 */
import { useEffect, useRef } from "react";

const FRAME_MS = 1000 / 30;
const SHORT = 48, MAX_LONG = 96, ITER = 8; // grid cells on the short side, cap on the long side, pressure iterations
const SPEED = 0.6; // overall motion speed (lower = slower)

/** Smooth 2D value noise in [0, 1], a few octaves. */
function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const one = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x: number, y: number) => (one(x, y) * 0.55 + one(x * 2.1, y * 2.1) * 0.3 + one(x * 4.3, y * 4.3) * 0.15);
}

function smoke(ctx: CanvasRenderingContext2D) {
  const off = document.createElement("canvas");
  const octx = off.getContext("2d")!;
  const noise = makeNoise(7);
  let W = 0, H = 0, S = 0, t = Math.random() * 100;
  let u = new Float32Array(0), v = u, u0 = u, v0 = u, d = u, d0 = u, p = u, dv = u, cu = u;
  let img: ImageData | null = null;
  let rgb = [40, 40, 38], amax = 0.2;

  /** Closed box: velocity reflects at the walls, scalars copy the neighbour (smoke stays on screen). */
  const bnd = (x: Float32Array, kind: number) => {
    for (let j = 1; j <= H; j++) {
      x[j * S] = kind === 1 ? -x[j * S + 1] : x[j * S + 1];
      x[j * S + W + 1] = kind === 1 ? -x[j * S + W] : x[j * S + W];
    }
    for (let i = 1; i <= W; i++) {
      x[i] = kind === 2 ? -x[S + i] : x[S + i];
      x[(H + 1) * S + i] = kind === 2 ? -x[H * S + i] : x[H * S + i];
    }
  };

  const advect = (dst: Float32Array, src: Float32Array, uu: Float32Array, vv: Float32Array, kind: number) => {
    for (let j = 1; j <= H; j++) {
      for (let i = 1; i <= W; i++) {
        const k = j * S + i;
        let x = i - uu[k], y = j - vv[k];
        x = x < 0.5 ? 0.5 : x > W + 0.5 ? W + 0.5 : x;
        y = y < 0.5 ? 0.5 : y > H + 0.5 ? H + 0.5 : y;
        const i0 = x | 0, j0 = y | 0, sx = x - i0, sy = y - j0, q = j0 * S + i0;
        dst[k] = (1 - sy) * ((1 - sx) * src[q] + sx * src[q + 1]) + sy * ((1 - sx) * src[q + S] + sx * src[q + S + 1]);
      }
    }
    bnd(dst, kind);
  };

  const project = () => {
    for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
      const k = j * S + i;
      dv[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + S] - v[k - S]);
    }
    bnd(dv, 0); bnd(p, 0);
    for (let it = 0; it < ITER; it++) {
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        const k = j * S + i;
        p[k] = (dv[k] + p[k - 1] + p[k + 1] + p[k - S] + p[k + S]) * 0.25;
      }
      bnd(p, 0);
    }
    for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
      const k = j * S + i;
      u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
      v[k] -= 0.5 * (p[k + S] - p[k - S]);
    }
    bnd(u, 1); bnd(v, 2);
  };

  const confine = (eps: number) => {
    for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
      const k = j * S + i;
      cu[k] = 0.5 * (v[k + 1] - v[k - 1] - (u[k + S] - u[k - S]));
    }
    for (let j = 2; j < H; j++) for (let i = 2; i < W; i++) {
      const k = j * S + i;
      const nx = 0.5 * (Math.abs(cu[k + 1]) - Math.abs(cu[k - 1]));
      const ny = 0.5 * (Math.abs(cu[k + S]) - Math.abs(cu[k - S]));
      const l = Math.sqrt(nx * nx + ny * ny) + 1e-5;
      u[k] += (eps * ny * cu[k]) / l;
      v[k] -= (eps * nx * cu[k]) / l;
    }
  };

  /** The slowly moving cloud pattern the density relaxes toward (cloud scale ≈ a third of the short side). */
  const cloud = (i: number, j: number) => {
    const sc = 3 / Math.min(W, H);
    const n = noise(i * sc + t * 0.02, j * sc - t * 0.013);
    const q = (n - 0.38) / 0.5;
    return q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q);
  };

  return {
    warm: 40,
    resize(w: number, h: number) {
      const cell = Math.min(w, h) / SHORT;
      const nW = Math.max(8, Math.min(MAX_LONG, Math.round(w / cell)));
      const nH = Math.max(8, Math.min(MAX_LONG, Math.round(h / cell)));
      if (nW === W && nH === H) return;
      W = nW; H = nH; S = W + 2;
      const n = S * (H + 2);
      u = new Float32Array(n); v = new Float32Array(n); u0 = new Float32Array(n); v0 = new Float32Array(n);
      d = new Float32Array(n); d0 = new Float32Array(n); p = new Float32Array(n); dv = new Float32Array(n); cu = new Float32Array(n);
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) d[j * S + i] = cloud(i, j); // already there at start
      off.width = W; off.height = H;
      img = octx.createImageData(W, H);
    },
    setTheme(dark: boolean) {
      rgb = dark ? [226, 225, 220] : [52, 52, 50];
      amax = dark ? 0.34 : 0.2;
    },
    step() {
      t += 1 / 30;
      // gentle breeze: a smooth swirl field that slowly changes over time
      const k1 = (2 * Math.PI) / Math.min(W, H);
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        const k = j * S + i;
        const a = Math.sin(i * k1 * 1.1 + t * 0.05) * Math.cos(j * k1 * 0.9 - t * 0.04);
        const b = Math.cos(i * k1 * 0.7 - t * 0.03) * Math.sin(j * k1 * 1.3 + t * 0.06);
        u[k] = u[k] * 0.98 + 0.004 * SPEED * (a + 0.35); // slight drift to the right
        v[k] = v[k] * 0.98 + 0.004 * SPEED * (b - 0.2); // slight drift upward
      }
      confine(0.05 * SPEED);
      u0.set(u); v0.set(v);
      advect(u, u0, u0, v0, 1);
      advect(v, v0, u0, v0, 2);
      project();
      d0.set(d);
      advect(d, d0, u, v, 0);
      // keep the smoke spread over the screen: relax gently toward the moving cloud pattern
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        const k = j * S + i;
        d[k] += (cloud(i, j) - d[k]) * 0.004;
      }
    },
    draw() {
      if (!img) return;
      const px = img.data, [cr, cg, cb] = rgb, A = amax * 255;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = (j + 1) * S + i + 1;
        const q = (4 * d[k] + 2 * (d[k - 1] + d[k + 1] + d[k - S] + d[k + S]) + d[k - S - 1] + d[k - S + 1] + d[k + S - 1] + d[k + S + 1]) / 16;
        const o = (j * W + i) * 4;
        px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
        px[o + 3] = A * (1 - Math.exp(-2.2 * (q > 0 ? q : 0)));
      }
      octx.putImageData(img, 0, 0);
      const cv = ctx.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, 0, 0, W, H, 0, 0, cv.width, cv.height);
    },
  };
}

export function LoginFx() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const fx = smoke(ctx);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const dark = matchMedia("(prefers-color-scheme: dark)");
    let raf = 0, last = 0, pending = 0;

    const size = () => {
      const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      fx.resize(w, h);
    };
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < FRAME_MS - 2) return;
      last = ts;
      fx.step();
      fx.draw();
    };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const start = () => {
      stop();
      if (reduce.matches) { for (let k = 0; k < fx.warm; k++) fx.step(); fx.draw(); return; } // one still frame
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; size(); fx.draw(); });
    };
    const onVisible = () => (document.hidden ? stop() : start());
    const onScheme = () => { fx.setTheme(dark.matches); fx.draw(); };

    fx.setTheme(dark.matches);
    size();
    fx.draw(); // clouds visible on the very first frame
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisible);
    reduce.addEventListener("change", start);
    dark.addEventListener("change", onScheme);
    return () => {
      stop();
      if (pending) cancelAnimationFrame(pending);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
      reduce.removeEventListener("change", start);
      dark.removeEventListener("change", onScheme);
    };
  }, []);

  return <canvas ref={ref} className="loginFx" aria-hidden="true" />;
}
