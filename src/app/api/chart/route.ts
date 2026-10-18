import { connection } from "next/server";
import { chartData, TIMEFRAMES, type Timeframe } from "@/lib/server/chart.ts";
import { json } from "@/lib/server/http.ts";
import { marketName } from "@/lib/server/markets.ts";
import { PLANS } from "@/lib/shared.ts";

/** GET /api/chart?market=Nifty%2050&tf=1m|5m|1d|1w|1mo[&plan=1%20week]: candles + markers. */
export async function GET(request: Request) {
  await connection();
  const q = new URL(request.url).searchParams;
  const market = marketName(q.get("market"));
  const tf = (q.get("tf") ?? "1d") as Timeframe;
  const plan = q.get("plan") ?? PLANS[0];
  if (!market) return json(request, { error: "market must be one of Nifty 50, Sensex, Crude oil (Brent)" }, { status: 400 });
  if (!TIMEFRAMES.includes(tf)) return json(request, { error: `tf must be one of ${TIMEFRAMES.join(", ")}` }, { status: 400 });
  if (!PLANS.includes(plan)) return json(request, { error: `plan must be one of ${PLANS.join(", ")}` }, { status: 400 });
  try {
    return json(request, await chartData(market, tf, plan));
  } catch (e) {
    return json(request, { error: `Could not load chart data: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
