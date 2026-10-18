-- Key -> JSON store for the advisor website (src/lib/store.ts).
-- Run once in Supabase: Dashboard -> SQL Editor -> paste -> Run.
-- One row per key: holdings, settings, alerts, status, heartbeat, push.

create table if not exists public.kv (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Row level security ON with no policies: the public (anon / publishable) key can read or write nothing.
-- Only the server key (service_role / sb_secret_...), kept in the host's env SUPABASE_SERVICE_ROLE_KEY, bypasses RLS.
alter table public.kv enable row level security;
