import { addSub, parseSubscription } from "@/lib/server/push.ts";

/** POST /api/push/subscribe <PushSubscription JSON>: turn phone alerts on for this browser (replaces the same endpoint). */
export async function POST(request: Request) {
  const sub = parseSubscription(await request.json().catch(() => null));
  if (!sub) return Response.json({ ok: false, error: "not a valid push subscription" }, { status: 400 });
  try {
    return Response.json({ ok: true, subscriptions: await addSub(sub) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
