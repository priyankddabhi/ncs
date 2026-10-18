/**
 * Guard for every page and API route: a remembered device (signed cookie) passes and its cookie is renewed;
 * the scheduler passes /api/check with its secret header; everyone else gets the PIN page (or 401 for APIs).
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieOptions, validCheckSecret, validDeviceToken } from "@/lib/server/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (pathname === "/api/check" && validCheckSecret(req.headers.get("x-check-secret"))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (validDeviceToken(token)) {
    const res = NextResponse.next();
    res.cookies.set(COOKIE, token!, cookieOptions(req.nextUrl.protocol === "https:")); // renew: never expires while used
    return res;
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "PIN needed" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // everything except Next.js files, the app icons, the notification badge, the manifest (needed before login to
  // install the app) and the service worker (the browser loads it without following a redirect)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|badge-96.png|manifest.webmanifest|sw.js).*)"],
};
