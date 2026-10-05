-- Crop Raid Guard core schema.
-- Tenancy: every row belongs to an organization; access is enforced by RLS through public.is_member().

create extension if not exists vector with schema extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.video_status as enum ('uploaded', 'queued', 'processing', 'completed', 'failed');
create type public.review_status as enum ('pending', 'confirmed', 'corrected', 'rejected');
create type public.claim_status as enum ('draft', 'evidence_ready', 'approved', 'submitted', 'paid', 'rejected');
create type public.alert_status as enum ('open', 'resolved');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'personal' check (kind in ('personal', 'fpo', 'ngo', 'insurer', 'research')),
  country_code text not null default 'IND',
  admin1_region text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 80),
  language text not null default 'en' check (language in ('en', 'hi', 'gu')),
  default_org_id uuid references public.organizations (id) on delete set null,
  onboarded boolean not null default false,
  telegram_chat_id bigint unique,
  whatsapp_phone text unique,
  link_code text unique,
  link_code_expires_at timestamptz,
  notify_high_risk boolean not null default true,
  notify_analysis boolean not null default true,
  notify_weekly boolean not null default false,
  retention_days integer default 90 check (retention_days is null or retention_days between 7 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership helpers are SECURITY DEFINER so policies on memberships do not recurse.
create or replace function public.is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_write(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.is_admin(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Farms, cameras, videos
-- ---------------------------------------------------------------------------
create table public.farms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  crop text not null default 'Maize',
  village text check (char_length(village) <= 120),
  description text check (char_length(description) <= 2000),
  location extensions.geography(Point, 4326),
  boundary extensions.geography(Polygon, 4326),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index farms_org_idx on public.farms (org_id);

create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'camera_trap' check (kind in ('camera_trap', 'cctv', 'phone', 'edge')),
  location extensions.geography(Point, 4326),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index cameras_farm_idx on public.cameras (farm_id);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete cascade,
  camera_id uuid references public.cameras (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  storage_path text not null unique,
  original_filename text,
  size_bytes bigint check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text,
  captured_at timestamptz not null default now(),
  device_captured_at timestamptz,
  capture_time_mismatch boolean not null default false,
  gps extensions.geography(Point, 4326),
  device_meta jsonb not null default '{}'::jsonb,
  options jsonb not null default '{"report": true, "recurring": true, "notify": false}'::jsonb,
  duration_s real,
  fps real,
  width integer,
  height integer,
  status public.video_status not null default 'uploaded',
  progress smallint not null default 0 check (progress between 0 and 100),
  stage text,
  error text,
  thumbnail_path text,
  playback_path text,
  model_versions jsonb not null default '{}'::jsonb,
  frames_sampled integer,
  frames_analyzed integer,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index videos_org_created_idx on public.videos (org_id, created_at desc);
create index videos_farm_idx on public.videos (farm_id);
create unique index videos_org_sha_uidx on public.videos (org_id, sha256) where sha256 is not null;

-- ---------------------------------------------------------------------------
-- Durable job queue (worker connects with the service role; no user access)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  org_id uuid references public.organizations (id) on delete cascade,
  video_id uuid references public.videos (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  locked_by text,
  last_error text,
  checkpoint jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_pending_idx on public.jobs (run_after) where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Events and detections
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete cascade,
  camera_id uuid references public.cameras (id) on delete set null,
  species_key text not null,
  common_name text not null,
  scientific_name text,
  model_label text,
  species_conf real not null check (species_conf between 0 and 1),
  started_at timestamptz not null,
  start_offset_s real not null,
  end_offset_s real not null,
  duration_s real generated always as (greatest(end_offset_s - start_offset_s, 0)) stored,
  track_ids integer[] not null default '{}',
  detection_count integer not null default 0,
  max_individuals integer not null default 1,
  contains_people boolean not null default false,
  risk_score smallint not null default 0 check (risk_score between 0 and 100),
  risk_band text not null default 'Low' check (risk_band in ('Low', 'Moderate', 'High')),
  risk_factors jsonb not null default '[]'::jsonb,
  risk_model text not null default 'risk-v1',
  needs_review boolean not null default false,
  review_status public.review_status not null default 'pending',
  reviewed_species_key text,
  reviewed_common_name text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  final_species_key text generated always as (coalesce(reviewed_species_key, species_key)) stored,
  final_common_name text generated always as (coalesce(reviewed_common_name, common_name)) stored,
  clip_path text,
  keyframe_path text,
  best_bbox real[],
  description text,
  vlm_caption text,
  created_at timestamptz not null default now()
);
create index events_org_started_idx on public.events (org_id, started_at desc);
create index events_farm_started_idx on public.events (farm_id, started_at desc);
create index events_video_idx on public.events (video_id, start_offset_s);
create index events_review_idx on public.events (org_id) where needs_review and review_status = 'pending';
create index events_species_idx on public.events (org_id, final_species_key);

create table public.detections (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  t_offset_s real not null,
  bbox real[] not null,
  label text not null,
  conf real not null,
  track_id integer
);
create index detections_event_idx on public.detections (event_id, t_offset_s);

create table public.event_embeddings (
  event_id uuid primary key references public.events (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  model text not null,
  content text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now()
);
create index event_embeddings_hnsw on public.event_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Knowledge base (global corpus, readable by any signed-in user)
-- ---------------------------------------------------------------------------
create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_url text,
  publisher text,
  state text,
  scheme text,
  language text not null default 'en',
  effective_from date,
  effective_to date,
  version integer not null default 1,
  sha256 text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sha256)
);

create table public.kb_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  chunk_index integer not null,
  heading_path text not null default '',
  content text not null,
  token_count integer not null default 0,
  embedding extensions.vector(768),
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading_path, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored,
  unique (document_id, chunk_index)
);
create index kb_chunks_tsv_idx on public.kb_chunks using gin (tsv);
create index kb_chunks_hnsw on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Claims and evidence
-- ---------------------------------------------------------------------------
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  status public.claim_status not null default 'draft',
  incident_at timestamptz not null,
  deadline_at timestamptz not null,
  event_ids uuid[] not null default '{}',
  evidence_pack_id uuid,
  crop text,
  affected_area_note text check (char_length(affected_area_note) <= 1000),
  farmer_notes text check (char_length(farmer_notes) <= 4000),
  draft_text text,
  draft_language text check (draft_language in ('en', 'hi', 'gu')),
  draft_generated_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  submitted_at timestamptz,
  submission_ref text check (char_length(submission_ref) <= 120),
  submitted_via text check (submitted_via in ('crop_insurance_app', 'helpline', 'agent', 'office', 'other')),
  outcome_note text check (char_length(outcome_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claims_org_idx on public.claims (org_id, created_at desc);

create table public.evidence_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete cascade,
  claim_id uuid references public.claims (id) on delete set null,
  event_ids uuid[] not null,
  manifest jsonb not null,
  manifest_sha256 text not null,
  signature text not null,
  signing_key_id text not null,
  storage_path text not null,
  size_bytes bigint,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.claims
  add constraint claims_evidence_pack_fk foreign key (evidence_pack_id)
  references public.evidence_packs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Alerts, reports
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  farm_id uuid references public.farms (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  video_id uuid references public.videos (id) on delete cascade,
  species_key text,
  title text not null,
  body text not null,
  severity text not null check (severity in ('Low', 'Moderate', 'High')),
  occurrences integer not null default 1,
  status public.alert_status not null default 'open',
  channels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index alerts_org_idx on public.alerts (org_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  kind text not null default 'weekly' check (kind in ('weekly', 'farm', 'video', 'custom')),
  title text not null,
  farm_id uuid references public.farms (id) on delete cascade,
  video_id uuid references public.videos (id) on delete set null,
  period_start date not null,
  period_end date not null,
  stats jsonb not null default '{}'::jsonb,
  narrative text,
  language text not null default 'en',
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  created_at timestamptz not null default now()
);
create index reports_org_idx on public.reports (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agents, API keys, audit
-- ---------------------------------------------------------------------------
create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_threads_user_idx on public.agent_threads (user_id, updated_at desc);

create table public.agent_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.agent_threads (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  route text,
  citations jsonb not null default '[]'::jsonb,
  trace jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index agent_messages_thread_idx on public.agent_messages (thread_id, id);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads (id) on delete set null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  channel text not null default 'web',
  route text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'blocked')),
  steps integer not null default 0,
  tool_calls integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_user_day_idx on public.agent_runs (user_id, created_at desc);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{events:read}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'agent', 'mcp', 'system')),
  action text not null,
  entity text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger claims_touch before update on public.claims for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- PMFBY localised-risk reporting window: 72 hours from the incident.
create or replace function public.set_claim_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.deadline_at := new.incident_at + interval '72 hours';
  return new;
end;
$$;
create trigger claims_deadline before insert or update of incident_at on public.claims
  for each row execute function public.set_claim_deadline();

-- New user: profile + personal organization + owner membership.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_name text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Farmer');
begin
  insert into public.organizations (name, kind) values (left(v_name, 100) || '''s fields', 'personal') returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'owner');
  insert into public.profiles (id, full_name, default_org_id) values (new.id, left(v_name, 80), v_org);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Uploaded video: enqueue analysis exactly once.
create or replace function public.mark_video_queued()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.status := 'queued';
  new.stage := 'Waiting for an analysis worker';
  return new;
end;
$$;
create trigger videos_mark_queued before insert on public.videos
  for each row when (new.status = 'uploaded') execute function public.mark_video_queued();

create or replace function public.enqueue_video_analysis()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs (kind, org_id, video_id, idempotency_key)
  values ('analyze_video', new.org_id, new.id, 'analyze:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return null;
end;
$$;
create trigger videos_enqueue after insert on public.videos
  for each row when (new.status = 'queued') execute function public.enqueue_video_analysis();

-- Keep org_id consistent with the parent farm (prevents cross-tenant writes through a foreign farm id).
create or replace function public.enforce_farm_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.farms where id = new.farm_id;
  if v_org is null or v_org <> new.org_id then
    raise exception 'farm % does not belong to organization %', new.farm_id, new.org_id using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger cameras_farm_org before insert or update of farm_id, org_id on public.cameras for each row execute function public.enforce_farm_org();
create trigger videos_farm_org before insert or update of farm_id, org_id on public.videos for each row execute function public.enforce_farm_org();
create trigger claims_farm_org before insert or update of farm_id, org_id on public.claims for each row execute function public.enforce_farm_org();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.cameras enable row level security;
alter table public.videos enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;
alter table public.detections enable row level security;
alter table public.event_embeddings enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.claims enable row level security;
alter table public.evidence_packs enable row level security;
alter table public.alerts enable row level security;
alter table public.reports enable row level security;
alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.api_keys enable row level security;
alter table public.audit_log enable row level security;

create policy org_read on public.organizations for select to authenticated using (public.is_member(id));
create policy org_update on public.organizations for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

create policy membership_read on public.memberships for select to authenticated using (public.is_member(org_id));
create policy membership_admin on public.memberships for all to authenticated using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy profile_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profile_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Generic org-scoped tables.
do $$
declare t text;
begin
  foreach t in array array['farms', 'cameras', 'videos', 'claims', 'reports'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_member(org_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_write(org_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_write(org_id)) with check (public.can_write(org_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin(org_id))', t);
  end loop;
  foreach t in array array['events', 'detections', 'event_embeddings', 'evidence_packs', 'alerts', 'audit_log'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_member(org_id))', t);
  end loop;
end;
$$;

-- Events and alerts are written by the worker; users change them only through the RPCs below.
create policy kb_documents_read on public.kb_documents for select to authenticated using (is_active);
create policy kb_chunks_read on public.kb_chunks for select to authenticated using (
  exists (select 1 from public.kb_documents d where d.id = document_id and d.is_active)
);

create policy threads_own on public.agent_threads for all to authenticated
  using (user_id = (select auth.uid()) and public.is_member(org_id))
  with check (user_id = (select auth.uid()) and public.is_member(org_id));
create policy messages_own on public.agent_messages for select to authenticated using (
  exists (select 1 from public.agent_threads t where t.id = thread_id and t.user_id = (select auth.uid()))
);
create policy runs_own on public.agent_runs for select to authenticated using (user_id = (select auth.uid()));
create policy api_keys_own on public.api_keys for select to authenticated using (user_id = (select auth.uid()));

-- Worker-owned tables are written only by the service role or SECURITY DEFINER functions.
revoke insert, update, delete on public.events, public.detections, public.event_embeddings, public.alerts,
  public.evidence_packs, public.audit_log, public.jobs, public.kb_documents, public.kb_chunks,
  public.agent_messages, public.agent_runs, public.api_keys
  from authenticated, anon;
revoke all on public.jobs from authenticated, anon;

-- Column-level protection: users may not rewrite worker-owned or derived columns.
revoke update on public.videos from authenticated;
grant update (title, farm_id, camera_id, captured_at, options) on public.videos to authenticated;
revoke update on public.claims from authenticated;
grant update (title, crop, affected_area_note, farmer_notes, draft_text, draft_language, event_ids) on public.claims to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, language, onboarded, notify_high_risk, notify_analysis, notify_weekly, retention_days, default_org_id) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets. Object paths always start with the organization id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('videos', 'videos', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm']),
  ('media', 'media', false, 52428800, array['video/mp4', 'image/jpeg', 'image/png']),
  ('evidence', 'evidence', false, 52428800, array['application/zip'])
on conflict (id) do nothing;

create policy storage_org_read on storage.objects for select to authenticated using (
  bucket_id in ('videos', 'media', 'evidence')
  and public.is_member(((storage.foldername(name))[1])::uuid)
);
create policy storage_video_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'videos'
  and public.can_write(((storage.foldername(name))[1])::uuid)
);
create policy storage_video_delete on storage.objects for delete to authenticated using (
  bucket_id = 'videos'
  and public.is_admin(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- Realtime: progress, alerts and new events stream to the UI (RLS applies).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.videos, public.alerts, public.events;
