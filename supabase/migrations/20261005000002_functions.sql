-- State transitions, analytics and search functions.

-- ---------------------------------------------------------------------------
-- Insert privileges: users can only set safe columns; workflow columns keep defaults.
-- ---------------------------------------------------------------------------
revoke insert on public.videos from authenticated;
grant insert (id, org_id, farm_id, camera_id, uploaded_by, title, storage_path, original_filename,
  size_bytes, sha256, mime, captured_at, device_captured_at, device_meta, options, gps)
  on public.videos to authenticated;
revoke insert on public.claims from authenticated;

create or replace function public.audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_payload jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (org_id, actor_id, actor_kind, action, entity, entity_id, payload)
  values (p_org, (select auth.uid()), 'user', p_action, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb));
$$;
revoke execute on function public.audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Human review of detections (feeds the training set)
-- ---------------------------------------------------------------------------
create or replace function public.review_event(
  p_event uuid, p_decision text, p_species_key text default null, p_common_name text default null
) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v public.events;
begin
  select * into v from public.events where id = p_event;
  if v.id is null or not public.can_write(v.org_id) then
    raise exception 'event not found' using errcode = '42501';
  end if;
  if p_decision not in ('confirm', 'correct', 'reject') then
    raise exception 'decision must be confirm, correct or reject' using errcode = '22023';
  end if;
  if p_decision = 'correct' and (coalesce(trim(p_species_key), '') = '' or coalesce(trim(p_common_name), '') = '') then
    raise exception 'a corrected species is required' using errcode = '22023';
  end if;

  update public.events set
    review_status = case p_decision when 'confirm' then 'confirmed' when 'correct' then 'corrected' else 'rejected' end::public.review_status,
    reviewed_species_key = case when p_decision = 'correct' then left(trim(p_species_key), 60) else null end,
    reviewed_common_name = case when p_decision = 'correct' then left(trim(p_common_name), 80) else null end,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    needs_review = false
  where id = p_event
  returning * into v;

  perform public.audit(v.org_id, 'event.review', 'event', p_event::text,
    jsonb_build_object('decision', p_decision, 'species_key', p_species_key));
  return v;
end;
$$;

create or replace function public.resolve_alert(p_alert uuid)
returns public.alerts
language plpgsql security definer set search_path = '' as $$
declare v public.alerts;
begin
  select * into v from public.alerts where id = p_alert;
  if v.id is null or not public.can_write(v.org_id) then
    raise exception 'alert not found' using errcode = '42501';
  end if;
  update public.alerts set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid())
  where id = p_alert returning * into v;
  perform public.audit(v.org_id, 'alert.resolve', 'alert', p_alert::text);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claims lifecycle: draft -> evidence_ready -> approved (human) -> submitted -> paid | rejected
-- ---------------------------------------------------------------------------
create or replace function public.create_claim(
  p_farm uuid, p_event_ids uuid[], p_title text default null, p_notes text default null
) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_crop text;
  v_incident timestamptz;
  v_count integer;
  v public.claims;
begin
  select org_id, crop into v_org, v_crop from public.farms where id = p_farm;
  if v_org is null or not public.can_write(v_org) then
    raise exception 'farm not found' using errcode = '42501';
  end if;
  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    raise exception 'select at least one event' using errcode = '22023';
  end if;
  select min(started_at), count(*) into v_incident, v_count
  from public.events where id = any (p_event_ids) and farm_id = p_farm and review_status <> 'rejected';
  if v_count <> array_length(p_event_ids, 1) then
    raise exception 'every event must belong to this farm and not be rejected' using errcode = '22023';
  end if;

  insert into public.claims (org_id, farm_id, created_by, title, incident_at, event_ids, crop, farmer_notes)
  values (v_org, p_farm, (select auth.uid()),
          coalesce(nullif(trim(p_title), ''), 'Crop loss on ' || to_char(v_incident at time zone 'Asia/Kolkata', 'DD Mon YYYY')),
          v_incident, p_event_ids, v_crop, left(p_notes, 4000))
  returning * into v;
  perform public.audit(v_org, 'claim.create', 'claim', v.id::text, jsonb_build_object('events', p_event_ids));
  return v;
end;
$$;

create or replace function public.approve_claim(p_claim uuid)
returns public.claims
language plpgsql security definer set search_path = '' as $$
declare v public.claims;
begin
  select * into v from public.claims where id = p_claim;
  if v.id is null or not public.can_write(v.org_id) then
    raise exception 'claim not found' using errcode = '42501';
  end if;
  if v.evidence_pack_id is null then
    raise exception 'build the evidence pack before approving' using errcode = '22023';
  end if;
  if coalesce(trim(v.draft_text), '') = '' then
    raise exception 'add or generate the claim text before approving' using errcode = '22023';
  end if;
  if v.status not in ('draft', 'evidence_ready') then
    raise exception 'only unapproved claims can be approved' using errcode = '22023';
  end if;
  update public.claims set status = 'approved', approved_by = (select auth.uid()), approved_at = now()
  where id = p_claim returning * into v;
  perform public.audit(v.org_id, 'claim.approve', 'claim', p_claim::text);
  return v;
end;
$$;

create or replace function public.mark_claim_submitted(p_claim uuid, p_via text, p_ref text default null)
returns public.claims
language plpgsql security definer set search_path = '' as $$
declare v public.claims;
begin
  select * into v from public.claims where id = p_claim;
  if v.id is null or not public.can_write(v.org_id) then
    raise exception 'claim not found' using errcode = '42501';
  end if;
  if v.status <> 'approved' then
    raise exception 'approve the claim before marking it submitted' using errcode = '22023';
  end if;
  update public.claims set status = 'submitted', submitted_at = now(), submitted_via = p_via, submission_ref = left(p_ref, 120)
  where id = p_claim returning * into v;
  perform public.audit(v.org_id, 'claim.submitted', 'claim', p_claim::text, jsonb_build_object('via', p_via));
  return v;
end;
$$;

create or replace function public.set_claim_outcome(p_claim uuid, p_outcome text, p_note text default null)
returns public.claims
language plpgsql security definer set search_path = '' as $$
declare v public.claims;
begin
  select * into v from public.claims where id = p_claim;
  if v.id is null or not public.can_write(v.org_id) then
    raise exception 'claim not found' using errcode = '42501';
  end if;
  if v.status <> 'submitted' or p_outcome not in ('paid', 'rejected') then
    raise exception 'only submitted claims can be marked paid or rejected' using errcode = '22023';
  end if;
  update public.claims set status = p_outcome::public.claim_status, outcome_note = left(p_note, 2000)
  where id = p_claim returning * into v;
  perform public.audit(v.org_id, 'claim.outcome', 'claim', p_claim::text, jsonb_build_object('outcome', p_outcome));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics (SECURITY INVOKER: RLS applies to every row read)
-- ---------------------------------------------------------------------------
create or replace function public.risk_band(p_score integer)
returns text language sql immutable as $$
  select case when p_score >= 70 then 'High' when p_score >= 40 then 'Moderate' else 'Low' end;
$$;

create or replace function public.dashboard_summary(p_org uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'active_risks', (select count(*) from public.alerts a where a.org_id = p_org and a.status = 'open' and a.severity in ('High', 'Moderate')),
    'open_alerts', (select count(*) from public.alerts a where a.org_id = p_org and a.status = 'open'),
    'events_7d', (select count(*) from public.events e where e.org_id = p_org and e.review_status <> 'rejected' and e.started_at >= now() - interval '7 days'),
    'events_prev_7d', (select count(*) from public.events e where e.org_id = p_org and e.review_status <> 'rejected' and e.started_at >= now() - interval '14 days' and e.started_at < now() - interval '7 days'),
    'events_total', (select count(*) from public.events e where e.org_id = p_org and e.review_status <> 'rejected'),
    'videos_7d', (select count(*) from public.videos v where v.org_id = p_org and v.status = 'completed' and v.processed_at >= now() - interval '7 days'),
    'videos_processing', (select count(*) from public.videos v where v.org_id = p_org and v.status in ('uploaded', 'queued', 'processing')),
    'videos_total', (select count(*) from public.videos v where v.org_id = p_org),
    'farms', (select count(*) from public.farms f where f.org_id = p_org),
    'cameras', (select count(*) from public.cameras c where c.org_id = p_org),
    'pending_review', (select count(*) from public.events e where e.org_id = p_org and e.needs_review and e.review_status = 'pending'),
    'claims_open', (select count(*) from public.claims c where c.org_id = p_org and c.status in ('draft', 'evidence_ready', 'approved'))
  );
$$;

-- Buckets: 7 days -> daily, otherwise weekly. Labels are rendered in the org's timezone.
create or replace function public.activity_series(
  p_org uuid, p_days integer default 7, p_farm uuid default null, p_species text default null
) returns table (bucket_start date, label text, events integer, high_risk integer)
language sql stable security invoker set search_path = '' as $$
  with params as (
    select greatest(least(p_days, 365), 1) as days,
           case when p_days <= 7 then 1 else 7 end as step,
           (now() at time zone 'Asia/Kolkata')::date as today
  ),
  buckets as (
    select (p.today - (p.days - 1) + g * p.step)::date as bucket_start, p.step
    from params p, generate_series(0, ceil(p.days::numeric / p.step)::int - 1) g
  ),
  ev as (
    select (e.started_at at time zone 'Asia/Kolkata')::date as d, e.risk_band
    from public.events e, params p
    where e.org_id = p_org and e.review_status <> 'rejected'
      and (p_farm is null or e.farm_id = p_farm)
      and (p_species is null or e.final_species_key = p_species)
      and e.started_at >= ((p.today - (p.days - 1))::timestamp at time zone 'Asia/Kolkata')
  )
  select b.bucket_start,
         case when b.step = 1 then to_char(b.bucket_start, 'Dy') else to_char(b.bucket_start, 'DD Mon') end,
         count(ev.d)::int,
         count(ev.d) filter (where ev.risk_band = 'High')::int
  from buckets b
  left join ev on ev.d >= b.bucket_start and ev.d < b.bucket_start + b.step
  group by b.bucket_start, b.step
  order by b.bucket_start;
$$;

create or replace function public.species_summary(p_org uuid, p_farm uuid default null)
returns table (
  species_key text, common_name text, scientific_name text, events integer, high_risk integer,
  farms integer, peak_hour integer, last_seen timestamptz, max_risk integer, best_event_id uuid
)
language sql stable security invoker set search_path = '' as $$
  with ev as (
    select e.* from public.events e
    where e.org_id = p_org and e.review_status <> 'rejected' and (p_farm is null or e.farm_id = p_farm)
  )
  select ev.final_species_key,
         mode() within group (order by ev.final_common_name),
         mode() within group (order by ev.scientific_name),
         count(*)::int,
         count(*) filter (where ev.risk_band = 'High')::int,
         count(distinct ev.farm_id)::int,
         mode() within group (order by extract(hour from ev.started_at at time zone 'Asia/Kolkata')::int),
         max(ev.started_at),
         max(ev.risk_score)::int,
         (array_agg(ev.id order by ev.species_conf desc))[1]
  from ev
  group by ev.final_species_key
  order by count(*) desc;
$$;

create or replace function public.farm_summaries(p_org uuid)
returns table (
  id uuid, name text, crop text, village text, description text, created_at timestamptz,
  cameras integer, videos integer, events integer, events_7d integer, risk_score integer, risk_band text,
  last_event_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select f.id, f.name, f.crop, f.village, f.description, f.created_at,
    (select count(*) from public.cameras c where c.farm_id = f.id)::int,
    (select count(*) from public.videos v where v.farm_id = f.id)::int,
    (select count(*) from public.events e where e.farm_id = f.id and e.review_status <> 'rejected')::int,
    (select count(*) from public.events e where e.farm_id = f.id and e.review_status <> 'rejected' and e.started_at >= now() - interval '7 days')::int,
    coalesce((select max(e.risk_score) from public.events e where e.farm_id = f.id and e.review_status <> 'rejected' and e.started_at >= now() - interval '7 days'), 0)::int,
    public.risk_band(coalesce((select max(e.risk_score) from public.events e where e.farm_id = f.id and e.review_status <> 'rejected' and e.started_at >= now() - interval '7 days'), 0)::int),
    (select max(e.started_at) from public.events e where e.farm_id = f.id and e.review_status <> 'rejected')
  from public.farms f
  where f.org_id = p_org
  order by f.created_at;
$$;

create or replace function public.hourly_activity(p_org uuid, p_farm uuid default null, p_species text default null)
returns table (hour integer, events integer)
language sql stable security invoker set search_path = '' as $$
  select h, count(e.id)::int
  from generate_series(0, 23) h
  left join public.events e
    on e.org_id = p_org and e.review_status <> 'rejected'
   and (p_farm is null or e.farm_id = p_farm)
   and (p_species is null or e.final_species_key = p_species)
   and extract(hour from e.started_at at time zone 'Asia/Kolkata')::int = h
  group by h order by h;
$$;

-- ---------------------------------------------------------------------------
-- Retrieval
-- ---------------------------------------------------------------------------
-- Hybrid search: dense (cosine) + BM25-style full text, fused with reciprocal rank fusion.
create or replace function public.kb_hybrid_search(
  query_embedding extensions.vector(768),
  query_text text,
  match_count integer default 20,
  p_state text default null,
  rrf_k integer default 60
) returns table (
  chunk_id bigint, document_id uuid, title text, source_url text, publisher text, state text, scheme text,
  effective_from date, heading_path text, content text, dense_score real, text_score real, rrf_score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with docs as (
    select d.* from public.kb_documents d
    where d.is_active
      and (d.effective_to is null or d.effective_to >= current_date)
      and (p_state is null or d.state is null or d.state = p_state)
  ),
  dense as (
    select c.id, 1 - (c.embedding <=> query_embedding) as score,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from public.kb_chunks c join docs on docs.id = c.document_id
    where c.embedding is not null
    order by c.embedding <=> query_embedding
    limit match_count * 2
  ),
  sparse as (
    select c.id, ts_rank_cd(c.tsv, q) as score,
           row_number() over (order by ts_rank_cd(c.tsv, q) desc) as rnk
    from public.kb_chunks c join docs on docs.id = c.document_id,
         websearch_to_tsquery('english', query_text) q
    where c.tsv @@ q
    order by score desc
    limit match_count * 2
  ),
  fused as (
    select coalesce(dense.id, sparse.id) as id,
           dense.score as dense_score, sparse.score as text_score,
           coalesce(1.0 / (rrf_k + dense.rnk), 0) + coalesce(1.0 / (rrf_k + sparse.rnk), 0) as rrf
    from dense full outer join sparse on dense.id = sparse.id
  )
  select c.id, d.id, d.title, d.source_url, d.publisher, d.state, d.scheme, d.effective_from,
         c.heading_path, c.content, f.dense_score::real, f.text_score::real, f.rrf::real
  from fused f
  join public.kb_chunks c on c.id = f.id
  join docs d on d.id = c.document_id
  order by f.rrf desc
  limit match_count;
$$;

create or replace function public.match_events(
  p_org uuid,
  query_embedding extensions.vector(768),
  match_count integer default 10,
  p_farm uuid default null,
  p_species text default null,
  p_since timestamptz default null,
  p_min_risk integer default null
) returns table (
  event_id uuid, video_id uuid, farm_id uuid, farm_name text, species text, started_at timestamptz,
  start_offset_s real, risk_score smallint, risk_band text, description text, similarity real
)
language sql stable security invoker set search_path = public, extensions as $$
  select e.id, e.video_id, e.farm_id, f.name, e.final_common_name, e.started_at, e.start_offset_s,
         e.risk_score, e.risk_band, e.description,
         (1 - (ee.embedding <=> query_embedding))::real
  from public.event_embeddings ee
  join public.events e on e.id = ee.event_id
  join public.farms f on f.id = e.farm_id
  where ee.org_id = p_org and e.review_status <> 'rejected'
    and (p_farm is null or e.farm_id = p_farm)
    and (p_species is null or e.final_species_key = p_species)
    and (p_since is null or e.started_at >= p_since)
    and (p_min_risk is null or e.risk_score >= p_min_risk)
  order by ee.embedding <=> query_embedding
  limit least(match_count, 50);
$$;

-- Read-only views the analyst agent's SQL tool is allowed to query (RLS flows through).
create or replace view public.agent_events with (security_invoker = true) as
  select e.id, e.org_id, e.video_id, e.farm_id, f.name as farm_name, f.crop, c.name as camera_name,
         e.final_species_key as species_key, e.final_common_name as species, e.scientific_name,
         e.species_conf, e.started_at, (e.started_at at time zone 'Asia/Kolkata') as started_at_local,
         e.duration_s, e.max_individuals, e.risk_score, e.risk_band, e.review_status, e.needs_review
  from public.events e
  join public.farms f on f.id = e.farm_id
  left join public.cameras c on c.id = e.camera_id
  where e.review_status <> 'rejected';

create or replace view public.agent_farms with (security_invoker = true) as
  select f.id, f.org_id, f.name, f.crop, f.village, f.created_at from public.farms f;

create or replace view public.agent_videos with (security_invoker = true) as
  select v.id, v.org_id, v.farm_id, v.title, v.captured_at, v.duration_s, v.status, v.processed_at from public.videos v;

grant select on public.agent_events, public.agent_farms, public.agent_videos to authenticated;

-- Signed-in users only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.review_event(uuid, text, text, text)',
    'public.resolve_alert(uuid)',
    'public.create_claim(uuid, uuid[], text, text)',
    'public.approve_claim(uuid)',
    'public.mark_claim_submitted(uuid, text, text)',
    'public.set_claim_outcome(uuid, text, text)',
    'public.dashboard_summary(uuid)',
    'public.activity_series(uuid, integer, uuid, text)',
    'public.species_summary(uuid, uuid)',
    'public.farm_summaries(uuid)',
    'public.hourly_activity(uuid, uuid, text)',
    'public.kb_hybrid_search(extensions.vector, text, integer, text, integer)',
    'public.match_events(uuid, extensions.vector, integer, uuid, text, timestamptz, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
