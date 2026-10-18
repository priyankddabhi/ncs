"use client";
/** Pastel text badge for a backend advice string (its emoji becomes a word). Pulses once when its label changes. */
import { useEffect, useRef } from "react";
import { badgeInfo } from "./fmt.ts";

export function Badge({ advice }: { advice: string }) {
  const { tone, label } = badgeInfo(advice);
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(label);
  useEffect(() => {
    if (prev.current === label) return;
    prev.current = label;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth; // restart the animation
    el.classList.add("pulse");
  }, [label]);
  return (
    <span ref={ref} className={`badge ${tone}`} onAnimationEnd={(e) => e.currentTarget.classList.remove("pulse")}>
      {label}
    </span>
  );
}
