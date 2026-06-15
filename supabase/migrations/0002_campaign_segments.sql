-- ============================================================
-- Migration : une campagne peut cibler plusieurs segments.
-- L'email est désormais rédigé au niveau de la campagne (plus du segment).
-- Idempotent.
-- ============================================================

create table if not exists public.campaign_segments (
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  segment_id   uuid not null references public.segments(id)  on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, segment_id)
);
create index if not exists campaign_segments_segment_idx on public.campaign_segments(segment_id);

-- Backfill : le segment unique existant devient un rattachement de campagne.
insert into public.campaign_segments (campaign_id, segment_id)
select id, segment_id
from public.campaigns
where segment_id is not null
on conflict do nothing;

alter table public.campaign_segments enable row level security;
