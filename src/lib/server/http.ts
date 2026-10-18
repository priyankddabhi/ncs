/**
 * JSON response, gzipped when the browser accepts it (`next start` compresses pages but not route handler bodies;
 * chart data is several hundred KB, which matters on a phone).
 */
import { gzipSync } from "node:zlib";

export function json(request: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Accept-Encoding", ...init.headers };
  if (text.length > 2048 && /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
    return new Response(gzipSync(text), { status: init.status ?? 200, headers: { ...headers, "Content-Encoding": "gzip" } });
  }
  return new Response(text, { status: init.status ?? 200, headers });
}
