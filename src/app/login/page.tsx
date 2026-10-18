"use client";
import { useState } from "react";
import { LogoMark } from "../ui/Icons";
import { LoginFx } from "./LoginFx.tsx";

/** First-visit PIN screen. After a correct PIN this device is remembered and this page is not shown again. */
export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (r.ok && body.ok) { window.location.replace("/"); return; }
      setError(body.error ?? "Could not check the PIN");
      setPin("");
    } catch {
      setError("No connection. Try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <LoginFx />
      <main className="login">
        <form className="card loginCard" onSubmit={submit}>
          <span className="logo"><LogoMark size={28} /> Advisor</span>
          <label className="field" htmlFor="pin">Enter PIN</label>
          <input
            id="pin" className="pinInput" type="password" inputMode="numeric" autoComplete="off" autoFocus
            maxLength={32} value={pin} onChange={(e) => setPin(e.target.value.replace(/\s/g, ""))} aria-invalid={Boolean(error)}
          />
          {error && <p className="loginError" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={!pin || busy}>{busy ? "Checking…" : "Open"}</button>
        </form>
      </main>
    </>
  );
}
