import { connection } from "next/server";
import { getHoldings, type Holdings } from "@/lib/server/advice.ts";
import type { Holding } from "@/lib/engine/index.ts";
import { KEYS, MARKET_NAMES, PLANS } from "@/lib/shared.ts";
import { store } from "@/lib/store.ts";

/** GET /api/holdings: { [market]: { buy_date, buy_price, horizon, stop_change } }. */
export async function GET() {
  await connection();
  return Response.json(await getHoldings(), { headers: { "Cache-Control": "no-store" } });
}

/** Same rules as the Python sidebar: price optional (> 0), stop % from −50 to +50 (0 = off, needs a buy price). */
function validate(h: unknown): Holding | string {
  if (typeof h !== "object" || h === null) return "holding must be an object";
  const x = h as Record<string, unknown>;
  const date = x.buy_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return "buy_date must be YYYY-MM-DD";
  if (typeof x.horizon !== "string" || !PLANS.includes(x.horizon)) return `horizon must be one of ${PLANS.join(", ")}`;
  const price = x.buy_price === undefined || x.buy_price === null || x.buy_price === 0 ? null : Number(x.buy_price);
  if (price !== null && !(Number.isFinite(price) && price > 0)) return "buy_price must be a positive number (or empty)";
  const stop = x.stop_change === undefined || x.stop_change === null ? 0 : Number(x.stop_change);
  if (!Number.isFinite(stop) || stop < -50 || stop > 50) return "stop_change must be between -50 and +50";
  return { buy_date: date, buy_price: price, horizon: x.horizon, stop_change: stop === 0 ? null : stop };
}

/** POST /api/holdings { market, holding: {...} | null }: add / edit (holding) or remove (null) one market. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { market?: unknown; holding?: unknown } | null;
  const market = body?.market;
  if (typeof market !== "string" || !MARKET_NAMES.includes(market)) {
    return Response.json({ error: `market must be one of ${MARKET_NAMES.join(", ")}` }, { status: 400 });
  }
  const all: Holdings = await getHoldings();
  if (body?.holding === null || body?.holding === undefined) delete all[market];
  else {
    const h = validate(body.holding);
    if (typeof h === "string") return Response.json({ error: h }, { status: 400 });
    all[market] = h;
  }
  await store.set(KEYS.holdings, all);
  return Response.json(all);
}
