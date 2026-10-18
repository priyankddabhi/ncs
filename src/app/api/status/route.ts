import { connection } from "next/server";
import { getInterval } from "@/lib/server/advice.ts";
import type { AlertLog } from "@/lib/server/checker.ts";
import { KEYS, type CheckStatus, type Heartbeat, type StatusResponse } from "@/lib/shared.ts";
import { store } from "@/lib/store.ts";

/** GET /api/status: the checker's live state + the alert list (cheap: store reads only, polled by the page). */
export async function GET() {
  await connection();
  const [status, heartbeat, log, interval] = await Promise.all([
    store.get<CheckStatus>(KEYS.status), store.get<Heartbeat>(KEYS.heartbeat), store.get<AlertLog>(KEYS.alerts), getInterval(),
  ]);
  const body: StatusResponse = { now: Date.now(), interval, status, heartbeat, alerts: log?.alerts ?? [] };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
