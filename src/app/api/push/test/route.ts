import { sendToAll } from "@/lib/server/push.ts";

export const maxDuration = 30;

/** POST /api/push/test: send a test message to every phone with alerts on. */
export async function POST() {
  try {
    const r = await sendToAll([{ title: "Advisor · test notification", body: "Phone alerts are on. New BUY / SELL alerts will appear like this.", tag: "test", url: "/" }]);
    return Response.json({ ok: r.sent > 0, ...r, error: r.sent ? undefined : r.subscriptions ? "no phone could be reached" : "no phone has alerts on" });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
