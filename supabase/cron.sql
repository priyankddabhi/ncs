-- Scheduler for the advisor checker on Vercel (NOT run yet; run it in Supabase SQL Editor when the site is live).
-- Every 5 minutes Supabase calls POST https://YOUR-VERCEL-URL/api/check with the checker secret header.
--
-- Replace before running:
--   YOUR-VERCEL-URL     the site's address without https:// (for example my-advisor.vercel.app)
--   YOUR-CHECK-SECRET   the same value as env CHECK_SECRET on Vercel (never commit the real value)
--
-- Note: this fixed 5-minute schedule replaces the "Check every" timer of the local checker (scripts/checker.ts).

create extension if not exists pg_net;   -- HTTP calls from the database
create extension if not exists pg_cron;  -- the timer

select cron.schedule(
  'advisor-check',                        -- job name (used to unschedule)
  '*/5 * * * *',                          -- every 5 minutes
  $$
  select net.http_post(
    url                  := 'https://YOUR-VERCEL-URL/api/check',
    headers              := jsonb_build_object(
                              'x-check-secret', 'YOUR-CHECK-SECRET',
                              'content-type',   'application/json'
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 60000         -- 60 s
  );
  $$
);

-- See the job and its recent runs:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select * from net._http_response order by created desc limit 10;

-- Stop it:
--   select cron.unschedule('advisor-check');
