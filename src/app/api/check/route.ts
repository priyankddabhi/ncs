import { runCheck } from "@/lib/server/checker.ts";

export const maxDuration = 60;

/** POST /api/check: run the checker once (called by scripts/checker.ts now, by an external scheduler on Vercel). */
export async function POST() {
  try {
    const { alerts, status } = await runCheck();
    return Response.json({ ok: true, alerts, status });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
