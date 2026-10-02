-- ============================================================
-- 0021 : offre Buffer de chaque marque.
--
-- L'API Buffer n'expose pas le nom de l'offre souscrite, seulement les
-- limites de l'organisation (`Organization.limits`). L'offre gratuite se
-- reconnaît à son plafond de 10 posts programmés par canal ; elle n'a pas
-- non plus le premier commentaire.
--
-- Relevé le 02/10/2026 sur les trois comptes connectés (offre gratuite) :
--   channels 3, scheduledPosts 10, members 0, tags 3, postTemplates 1,
--   ideas 100, ideaGroups 3, savedReplies 1.
--
-- `plan` : 'free' | 'paid' | NULL (pas encore détectée). `limits` garde la
-- réponse brute de Buffer, pour afficher les plafonds réels dans l'interface.
--
-- Idempotent.
-- ============================================================

alter table public.brand_buffer add column if not exists plan text;
alter table public.brand_buffer add column if not exists limits jsonb;
alter table public.brand_buffer add column if not exists plan_checked_at timestamptz;

alter table public.brand_buffer drop constraint if exists brand_buffer_plan_check;
alter table public.brand_buffer add constraint brand_buffer_plan_check
  check (plan is null or plan in ('free', 'paid'));
