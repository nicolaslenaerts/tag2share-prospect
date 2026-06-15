-- ============================================================
-- Migration : liste de suppression (désinscriptions, bounces, plaintes).
-- Respectée à chaque envoi. Idempotent.
-- ============================================================

create table if not exists public.suppressions (
  email      text primary key,
  reason     text not null default 'unsubscribe', -- unsubscribe | bounce | complaint | manual
  detail     text,
  created_at timestamptz not null default now()
);

alter table public.suppressions enable row level security;
