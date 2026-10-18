/**
 * Tiny key -> JSON value store. Keys used: holdings, settings, alerts, status, heartbeat (see shared.ts KEYS).
 *
 * Now: one JSON file per key in web/.data/ (gitignored), written via a temp file + rename so a reader never sees a
 * half-written file, and two processes (the website and scripts/checker.ts) never overwrite each other's keys.
 * Step 4: replace `fileStore` with an Upstash Redis version of the same two functions (GET/SET of a JSON string).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9_-]+$/i;

function fileStore(dir: string): Store {
  const path = (key: string) => {
    if (!SAFE_KEY.test(key)) throw new Error(`bad store key: ${key}`);
    return join(dir, `${key}.json`);
  };
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

export const store: Store = fileStore(process.env.DATA_DIR ?? join(process.cwd(), ".data"));
