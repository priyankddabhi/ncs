import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieOptions, lockedFor, newDeviceToken, pinMatches, recordAttempt } from "@/lib/server/auth";

/** POST { pin } → remembers this device with a signed cookie when the PIN is right. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const wait = lockedFor(ip);
  if (wait) return NextResponse.json({ ok: false, error: `Too many wrong tries. Wait ${Math.ceil(wait / 60000)} min.` }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  const ok = pin.length > 0 && pin.length <= 32 && pinMatches(pin);
  recordAttempt(ip, ok);
  if (!ok) return NextResponse.json({ ok: false, error: "Wrong PIN" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, newDeviceToken(), cookieOptions(req.nextUrl.protocol === "https:"));
  return res;
}
