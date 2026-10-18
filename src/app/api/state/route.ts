import { connection } from "next/server";
import { buildState } from "@/lib/server/advice.ts";
import { json } from "@/lib/server/http.ts";

/** GET /api/state[?fresh=1]: the 3 markets (chain, holding advice, data warning, open/closed), last update time. */
export async function GET(request: Request) {
  await connection();
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  return json(request, await buildState(fresh));
}
