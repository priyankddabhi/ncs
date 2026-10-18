/**
 * Supabase store check: writes a test key, reads it back, overwrites it, reads again, then deletes it.
 * Prints PASS or FAIL (exit code 1), or "Supabase not configured" when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 * not set (then the website uses the local files in web/.data).
 *
 * Run from the web folder:  node --no-warnings scripts/store-check.ts
 */
import { store, supabaseConfig, supabaseFetch, supabaseHeaders } from "../src/lib/store.ts";

try { process.loadEnvFile(".env.local"); } catch { /* keys may come from the environment instead */ }

const cfg = supabaseConfig();
if (!cfg) {
  console.log("Supabase not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not set): the local file store is used.");
} else {
  const key = "store_check";
  const host = new URL(cfg.url).host;
  const kind = cfg.key.startsWith("eyJ") ? "legacy JWT key (apikey + Bearer)" : "secret key (apikey only)";
  console.log(`Supabase store check on ${host}, ${kind}`);
  let ok = true;
  const expect = (label: string, got: unknown, want: unknown) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    ok &&= pass;
    console.log(`  ${pass ? "ok  " : "FAIL"} ${label}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  };
  try {
    const a = { n: 1, text: "₹ test", at: Date.now() };
    await store.set(key, a);
    expect("write + read back", await store.get(key), a);
    const b = { n: 2, list: [1, 2, 3] };
    await store.set(key, b);
    expect("overwrite + read back", await store.get(key), b);
    await supabaseFetch(`DELETE "${key}"`, `${cfg.url}/rest/v1/kv?key=eq.${key}`,
      { method: "DELETE", headers: supabaseHeaders(cfg.key, { Prefer: "return=minimal" }) });
    expect("delete", await store.get(key), null);
    expect("missing key reads as null", await store.get("store_check_missing"), null);
  } catch (e) {
    ok = false;
    console.log(`  FAIL ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(ok ? "PASS" : "FAIL");
  if (!ok) process.exitCode = 1;
}
