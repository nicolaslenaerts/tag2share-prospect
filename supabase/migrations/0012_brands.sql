-- ============================================================
-- 0012 : marques créables dans l'interface.
--
-- Jusqu'ici une marque se déclarait en code (lib/brands/<slug>.ts) et la base
-- ne stockait que son slug pour cloisonner les données (voir 0009). Cette
-- table permet d'en créer une SANS redéploiement.
--
-- Les deux origines coexistent volontairement :
--   - marques en CODE  : tag2share, horodo. Lisibles, versionnées, non
--     modifiables depuis l'interface. Elles restent la référence pour les
--     données historiques.
--   - marques en BASE  : créées ici. Modifiables, supprimables.
-- Le registre applicatif fusionne les deux (lib/brands/store.ts). Un slug déjà
-- pris par une marque en code est refusé à l'écriture : sans cette règle, une
-- ligne de base masquerait silencieusement l'identité d'envoi d'une marque de
-- production.
--
-- `config` porte le BrandConfig complet en JSONB plutôt qu'une colonne par
-- champ : la forme du contrat évolue (produits, interdits IA, réseaux sociaux
-- sont des listes imbriquées) et la validation vit déjà en TypeScript, à un
-- seul endroit, partagée entre le formulaire et l'API (lib/brands/schema.ts).
--
-- `active` = autorisation d'ENVOI RÉEL. Une marque naît inactive : on peut
-- constituer ses segments, faire rédiger l'IA et s'envoyer des tests, mais pas
-- écrire à de vrais prospects tant que le domaine d'envoi n'est pas vérifié
-- chez Resend et l'identité relue. Un email parti ne se rattrape pas.
--
-- Idempotent.
-- ============================================================

create table if not exists public.brands (
  slug        text primary key,
  config      jsonb   not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Le slug voyage dans les colonnes `brand` des autres tables, dans le cookie
-- de préférence et dans l'URL du webhook Resend : on le contraint ici aussi,
-- pas seulement côté application.
alter table public.brands drop constraint if exists brands_slug_format;
alter table public.brands add constraint brands_slug_format
  check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$');

-- Même posture que le reste du schéma : RLS active sans policy publique,
-- tous les accès passent par la clé service_role côté serveur.
alter table public.brands enable row level security;
