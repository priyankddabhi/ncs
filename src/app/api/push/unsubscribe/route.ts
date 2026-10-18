import { removeSubs } from "@/lib/server/push.ts";

/** POST /api/push/unsubscribe { endpoint }: turn phone alerts off for this browser. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || !body.endpoint) {
    return Response.json({ ok: false, error: "endpoint is required" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, subscriptions: await removeSubs([body.endpoint]) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
