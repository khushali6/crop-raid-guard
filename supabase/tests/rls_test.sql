-- Run against a database with the migrations applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Everything runs inside a transaction that is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('11111111-1111-1111-1111-111111111111', 'asha@example.com', '{"full_name":"Asha"}', 'authenticated', 'authenticated'),
       ('22222222-2222-2222-2222-222222222222', 'ravi@example.com', '{"full_name":"Ravi"}', 'authenticated', 'authenticated');

create temp table ctx as
select (select default_org_id from public.profiles where id = '11111111-1111-1111-1111-111111111111') as org_a,
       (select default_org_id from public.profiles where id = '22222222-2222-2222-2222-222222222222') as org_b;
grant select on ctx to authenticated;

do $$ begin
  assert (select org_a from ctx) is not null, 'signup trigger should create a personal organization';
  assert (select org_a <> org_b from ctx), 'each user gets their own organization';
end $$;

-- Worker-side seed (service role bypasses RLS).
insert into public.farms (id, org_id, name, crop)
select 'aaaaaaaa-0000-0000-0000-000000000001', org_a, 'North Field', 'Maize' from ctx;
insert into public.farms (id, org_id, name, crop)
select 'bbbbbbbb-0000-0000-0000-000000000001', org_b, 'Ravi Field', 'Wheat' from ctx;

-- ---------------------------------------------------------------- user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

do $$ begin
  assert (select count(*) from public.farms) = 1, 'user A must only see their own farm';
  assert (select count(*) from public.organizations) = 1, 'user A must only see their own organization';
end $$;

-- Uploading a video enqueues exactly one analysis job.
insert into public.videos (id, org_id, farm_id, title, storage_path, sha256)
select 'cccccccc-0000-0000-0000-000000000001', org_a, 'aaaaaaaa-0000-0000-0000-000000000001', 'Night clip',
       org_a::text || '/cccccccc-0000-0000-0000-000000000001.mp4', repeat('a', 64) from ctx;

-- Cross-tenant write must fail (RLS on org_b).
do $$ begin
  begin
    insert into public.farms (org_id, name) select org_b, 'Sneaky' from ctx;
    raise exception 'cross-tenant insert should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A farm from another org cannot be attached to my video.
do $$ begin
  begin
    insert into public.videos (org_id, farm_id, title, storage_path)
    select org_a, 'bbbbbbbb-0000-0000-0000-000000000001', 'x', org_a::text || '/x.mp4' from ctx;
    raise exception 'foreign farm insert should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Users cannot set workflow columns on insert.
do $$ begin
  begin
    insert into public.videos (org_id, farm_id, title, storage_path, status)
    select org_a, 'aaaaaaaa-0000-0000-0000-000000000001', 'x', org_a::text || '/y.mp4', 'completed' from ctx;
    raise exception 'status insert should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select status from public.videos where id = 'cccccccc-0000-0000-0000-000000000001') = 'queued', 'video should be queued';
  assert (select count(*) from public.jobs where video_id = 'cccccccc-0000-0000-0000-000000000001') = 1, 'one job per video';
end $$;

-- Worker writes an event.
insert into public.events (id, org_id, video_id, farm_id, species_key, common_name, species_conf, started_at,
                           start_offset_s, end_offset_s, risk_score, risk_band, needs_review)
select 'dddddddd-0000-0000-0000-000000000001', org_a, 'cccccccc-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-000000000001', 'wild_boar', 'Wild boar', 0.62, now() - interval '2 hours', 10, 44, 82, 'High', true
from ctx;

-- ---------------------------------------------------------------- user B cannot see A's data
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  assert (select count(*) from public.events) = 0, 'user B must not see user A events';
  assert (select count(*) from public.videos) = 0, 'user B must not see user A videos';
  begin
    perform public.review_event('dddddddd-0000-0000-0000-000000000001', 'reject');
    raise exception 'user B should not review A events';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- user A workflows
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

do $$
declare v_claim public.claims; v_summary jsonb;
begin
  -- Direct updates to worker-owned columns are rejected.
  begin
    update public.events set risk_score = 1 where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'direct event update should have failed';
  exception when insufficient_privilege then null;
  end;

  perform public.review_event('dddddddd-0000-0000-0000-000000000001', 'correct', 'nilgai', 'Nilgai');
  assert (select final_common_name from public.events where id = 'dddddddd-0000-0000-0000-000000000001') = 'Nilgai';

  v_claim := public.create_claim('aaaaaaaa-0000-0000-0000-000000000001', array['dddddddd-0000-0000-0000-000000000001']::uuid[]);
  assert v_claim.deadline_at = v_claim.incident_at + interval '72 hours', 'deadline is 72 hours after the incident';

  -- Approval requires an evidence pack and claim text (human-in-the-loop gate).
  begin
    perform public.approve_claim(v_claim.id);
    raise exception 'approval without evidence should fail';
  exception when invalid_parameter_value then null;
  end;

  v_summary := public.dashboard_summary((select org_a from ctx));
  assert (v_summary ->> 'events_7d')::int = 1, 'dashboard counts the event';
  assert (select sum(events) from public.activity_series((select org_a from ctx), 7)) = 1, 'activity series counts the event';
  assert (select count(*) from public.activity_series((select org_a from ctx), 90)) = 13, '90 days = 13 weekly buckets';
  assert (select risk_band from public.farm_summaries((select org_a from ctx)) limit 1) = 'High';
  assert (select species_key from public.species_summary((select org_a from ctx)) limit 1) = 'nilgai';
end $$;

reset role;
select 'rls_test passed' as result;
rollback;
