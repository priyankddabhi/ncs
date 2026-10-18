/**
 * Tiny key -> JSON value store. Keys used: holdings, settings, alerts, status, heartbeat, push (see shared.ts KEYS).
 *
 * Two backends behind the same two functions, picked on every call from the environment:
 * - Supabase (hosting): env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set. One row per key in table public.kv
 *   (supabase/kv.sql), read and upserted through Supabase's REST API (PostgREST) with plain fetch. Nothing is written
 *   to the local disk.
 * - Files (this PC): otherwise. One JSON file per key in web/.data/ (gitignored), written via a temp file + rename so
 *   a reader never sees a half-written file, and two processes (the website and scripts/checker.ts) never overwrite
 *   each other's keys.
 * Picking per call (not at import) lets scripts load .env.local after their imports and still get the right store.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9_-]+$/i;
const checkKey = (key: string) => {
  if (!SAFE_KEY.test(key)) throw new Error(`bad store key: ${key}`);
  return key;
};

function fileStore(dir: string): Store {
  const path = (key: string) => join(dir, `${checkKey(key)}.json`);
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(path(key), "utf8")) as T;
      } catch {
        return null; // missing or unreadable = no value yet
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      await mkdir(dir, { recursive: true });
      const file = path(key);
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
      for (let i = 0; ; i++) {
        try {
          await rename(tmp, file);
          return;
        } catch (e) {
          // Windows: the other process is reading the file right now
          if (i >= 20) throw e;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    },
  };
}

// ---------------- Supabase (PostgREST) ----------------

export interface SupabaseConfig { url: string; key: string }

/** The Supabase settings from the environment, or null when either is missing (= use the file store). */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

/**
 * Request headers for the server key. Always `apikey`; `Authorization: Bearer` only for the legacy JWT keys
 * (service_role, "eyJ..."). The new secret keys (sb_secret_...) are not JWTs and must not be sent as a Bearer token.
 */
export function supabaseHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: key, Accept: "application/json", ...extra };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

const TIMEOUT_MS = 15_000;

/** fetch with a timeout and clear error messages ("Supabase store: GET "alerts" failed: HTTP 401 ..."). */
export async function supabaseFetch(what: string, url: string, init: RequestInit): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const why = e instanceof Error ? (e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : e.message) : String(e);
    throw new Error(`Supabase store: ${what} failed: ${why} (check SUPABASE_URL)`);
  }
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 300);
    const hint = r.status === 401 || r.status === 403 ? " (check SUPABASE_SERVICE_ROLE_KEY)"
      : r.status === 404 ? " (is table public.kv created? run supabase/kv.sql)" : "";
    throw new Error(`Supabase store: ${what} failed: HTTP ${r.status}${hint}${body ? ` ${body}` : ""}`);
  }
  return r;
}

function supabaseStore({ url, key }: SupabaseConfig): Store {
  const table = `${url}/rest/v1/kv`;
  return {
    async get<T>(k: string): Promise<T | null> {
      const r = await supabaseFetch(`GET "${k}"`, `${table}?key=eq.${encodeURIComponent(checkKey(k))}&select=value`,
        { method: "GET", headers: supabaseHeaders(key) });
      const rows = (await r.json()) as { value: T }[];
      return Array.isArray(rows) && rows.length ? rows[0].value : null;
    },
    async set(k: string, value: unknown): Promise<void> {
      // upsert on the primary key; updated_at is set here because the column default only applies to new rows
      const body = JSON.stringify({ key: checkKey(k), value, updated_at: new Date().toISOString() });
      const r = await supabaseFetch(`SET "${k}"`, table, {
        method: "POST",
        headers: supabaseHeaders(key, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
        body,
      });
      await r.body?.cancel();
    },
  };
}

// ---------------- the store everyone imports ----------------

const files = fileStore(process.env.DATA_DIR ?? join(process.cwd(), ".data"));

const backend = (): Store => {
  const cfg = supabaseConfig();
  if (cfg) return supabaseStore(cfg);
  // Vercel's disk is read-only and not shared between requests: refuse the file store there with a clear message
  if (process.env.VERCEL) throw new Error("Store not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel's settings");
  return files;
};

export const store: Store = {
  get: <T>(key: string) => backend().get<T>(key),
  set: (key, value) => backend().set(key, value),
};
