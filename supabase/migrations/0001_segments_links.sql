-- ============================================================
-- Migration : rattachement multi-segment, journal des recherches,
-- campagne rattachée à un segment.
-- Idempotent : peut être ré-exécuté sans danger.
-- ============================================================

create extension if not exists "pgcrypto";

-- Rattachement multiple prospect <-> segment ------------------
create table if not exists public.segment_prospects (
  segment_id   uuid not null references public.segments(id)  on delete cascade,
  prospect_id  uuid not null references public.prospects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (segment_id, prospect_id)
);
create index if not exists segment_prospects_prospect_idx on public.segment_prospects(prospect_id);

-- Journal des recherches --------------------------------------
create table if not exists public.searches (
  id           uuid primary key default gen_random_uuid(),
  segment_id   uuid references public.segments(id) on delete cascade,
  country      text,
  city         text,
  zone         text,
  max_results  integer,
  found_count  integer not null default 0,
  new_count    integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists searches_segment_idx on public.searches(segment_id);

-- Campagne rattachée à un segment -----------------------------
alter table public.campaigns
  add column if not exists segment_id uuid references public.segments(id) on delete set null;
create index if not exists campaigns_segment_idx on public.campaigns(segment_id);

-- Backfill : l'appartenance existante (prospects.segment_id) devient une liaison
insert into public.segment_prospects (segment_id, prospect_id)
select segment_id, id
from public.prospects
where segment_id is not null
on conflict do nothing;

-- RLS (cohérent avec le reste : accès uniquement via service_role) ---
alter table public.segment_prospects enable row level security;
alter table public.searches          enable row level security;
