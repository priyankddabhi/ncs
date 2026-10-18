"use client";
/**
 * Ambient flow-field background: particles follow a smooth, slowly changing angle field and leave short, faint
 * trails in the theme's ink colour (CSS --flow-ink / --flow-alpha). Fixed full-screen canvas behind the content,
 * never interactive. Each frame is redrawn from a short per-particle trail history (no fading buffer, so no ghosting).
 * ~30 fps, devicePixelRatio capped at 1.5, paused while the tab is hidden, one static frame under reduced motion.
 */
import { useEffect, useRef } from "react";

const TRAIL = 14; // points per trail
const SPEED = 0.85; // css px per step
const FRAME_MS = 1000 / 30;

export function FlowField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const dark = matchMedia("(prefers-color-scheme: dark)");

    let w = 0, h = 0, dpr = 1, n = 0;
    let x = new Float32Array(0), y = new Float32Array(0), life = new Float32Array(0);
    let tx = new Float32Array(0), ty = new Float32Array(0); // trail ring, particle-major: [i * TRAIL + k]
    let head = 0, t = 0, raf = 0, last = 0;
    let ink = "#111", alpha = 0.06;

    const readInk = () => {
      const cs = getComputedStyle(document.documentElement);
      ink = cs.getPropertyValue("--flow-ink").trim() || "#111";
      alpha = Number(cs.getPropertyValue("--flow-alpha")) || 0.06;
    };

    const spawn = (i: number) => {
      const px = Math.random() * w, py = Math.random() * h;
      x[i] = px; y[i] = py;
      life[i] = 90 + Math.random() * 170;
      for (let k = 0; k < TRAIL; k++) { tx[i * TRAIL + k] = px; ty[i * TRAIL + k] = py; }
    };

    const size = () => {
      w = window.innerWidth; h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const want = w < 640 ? 120 : 260;
      if (want !== n) {
        n = want;
        x = new Float32Array(n); y = new Float32Array(n); life = new Float32Array(n);
        tx = new Float32Array(n * TRAIL); ty = new Float32Array(n * TRAIL);
        for (let i = 0; i < n; i++) { spawn(i); life[i] *= Math.random(); }
      }
    };

    /** Angle of the field at (px, py): layered sin/cos of x, y and slow time. */
    const angle = (px: number, py: number) =>
      (Math.sin(px * 0.0021 + t * 0.05) + Math.cos(py * 0.0024 - t * 0.04) + 0.6 * Math.sin((px + py) * 0.0011 + t * 0.03)) * 1.25;

    const step = () => {
      t += 1 / 30;
      head = (head + 1) % TRAIL;
      for (let i = 0; i < n; i++) {
        const a = angle(x[i], y[i]);
        x[i] += Math.cos(a) * SPEED;
        y[i] += Math.sin(a) * SPEED;
        if (--life[i] <= 0 || x[i] < -4 || x[i] > w + 4 || y[i] < -4 || y[i] > h + 4) spawn(i);
        tx[i * TRAIL + head] = x[i];
        ty[i * TRAIL + head] = y[i];
      }
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      // two passes: the older half of each trail lighter, the newer half at full (still very low) opacity
      const half = TRAIL >> 1;
      for (const [from, to, op] of [[0, half, alpha * 0.45], [half, TRAIL - 1, alpha]] as const) {
        ctx.globalAlpha = op;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const base = i * TRAIL;
          for (let k = from; k <= to; k++) {
            const j = base + ((head + 1 + k) % TRAIL); // oldest → newest
            if (k === from) ctx.moveTo(tx[j], ty[j]); else ctx.lineTo(tx[j], ty[j]);
          }
        }
        ctx.stroke();
      }
    };

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < FRAME_MS - 2) return;
      last = ts;
      step();
      draw();
    };

    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const start = () => {
      stop();
      if (reduce.matches) { // one still frame
        for (let k = 0; k < TRAIL; k++) step();
        draw();
        return;
      }
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    let pending = 0;
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; size(); if (!raf) start(); else draw(); });
    };
    const onVisible = () => (document.hidden ? stop() : start());
    const onScheme = () => { readInk(); draw(); };

    readInk();
    size();
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

  return <canvas ref={ref} className="flow" aria-hidden="true" />;
}
