-- ============================================================
-- 0019 : cron de suivi des publications réseaux sociaux.
--
-- Toutes les minutes, Postgres appelle GET /api/cron/social-status
-- (statuts Buffer, liens publics, emails de notification). Planificateur
-- côté base plutôt que Vercel Cron : l'offre Hobby de Vercel n'autorise
-- qu'un passage par jour.
--
-- Le secret (CRON_SECRET) n'est PAS écrit ici ni dans la définition du job :
-- il est lu à chaque passage dans le coffre Supabase (Vault), où il est
-- chiffré. À créer AVANT cette migration, une seule fois :
--
--   select vault.create_secret('<CRON_SECRET>', 'social_cron_secret',
--     'Bearer de /api/cron/social-status');
--
-- (pour le changer : vault.update_secret(id, '<nouveau>') sur la même ligne,
-- et la même valeur dans les variables d'environnement Vercel).
--
-- Suivi : select * from cron.job_run_details order by start_time desc limit 5;
--         select status_code, content from net._http_response order by created desc limit 5;
-- Arrêt : select cron.unschedule('social-status');
--
-- Idempotent.
-- ============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;

select cron.unschedule(jobid) from cron.job where jobname = 'social-status';

select cron.schedule(
  'social-status',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://marketing.tag2share.com/api/cron/social-status',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
