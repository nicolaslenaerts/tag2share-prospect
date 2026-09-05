-- ============================================================
-- 0011 : identité d'expédition par marque, éditable dans l'interface.
--
-- La clé API Resend est UNIQUE pour toute l'app (variable RESEND_API_KEY) :
-- un seul compte Resend, plusieurs domaines vérifiés. Ce qui change d'une
-- marque à l'autre, c'est l'ADRESSE d'envoi - et elle doit pouvoir être
-- modifiée sans redéploiement, donc elle vit ici.
--
-- Ordre de résolution appliqué par lib/brand-sender.ts :
--   1. cette table (saisie dans l'interface)
--   2. la variable d'environnement nommée dans lib/brands/<slug>.ts
--   3. la valeur littérale de lib/brands/<slug>.ts
-- Une colonne NULL ou vide = « pas de valeur enregistrée », on retombe à
-- l'étape suivante. Supprimer la valeur dans l'UI revient donc au défaut.
--
-- Idempotent.
-- ============================================================

create table if not exists public.brand_settings (
  brand       text primary key,              -- slug de la marque (lib/brands/index.ts)
  from_name   text,                          -- nom affiché, ex. "Nicolas de Tag2Share"
  from_email  text,                          -- adresse d'envoi, ex. nicolas@reach.tag2share.com
  reply_to    text,                          -- adresse de réponse
  test_email  text,                          -- destinataire des emails de test
  updated_at  timestamptz not null default now()
);

-- Même posture que le reste du schéma : RLS active sans policy publique,
-- tous les accès passent par la clé service_role côté serveur.
alter table public.brand_settings enable row level security;
