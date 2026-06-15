-- ============================================================
-- Migration : accroche sous le logo, éditable par campagne.
-- null = accroche par défaut · '' = masquée. Idempotent.
-- ============================================================

alter table public.campaigns
  add column if not exists email_tagline text;
