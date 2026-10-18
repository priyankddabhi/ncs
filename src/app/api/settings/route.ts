import { connection } from "next/server";
import { getInterval } from "@/lib/server/advice.ts";
import { INTERVALS, KEYS, type Settings } from "@/lib/shared.ts";
import { store } from "@/lib/store.ts";

/** GET /api/settings: { interval }. */
export async function GET() {
  await connection();
  return Response.json({ interval: await getInterval() } satisfies Settings, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/settings { interval: "1 min" | "5 min" | "1 hour" | "3 hours" }. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<Settings> | null;
  const interval = body?.interval;
  if (typeof interval !== "string" || !(interval in INTERVALS)) {
    return Response.json({ error: `interval must be one of ${Object.keys(INTERVALS).join(", ")}` }, { status: 400 });
  }
  await store.set(KEYS.settings, { interval } satisfies Settings);
  return Response.json({ interval });
}
