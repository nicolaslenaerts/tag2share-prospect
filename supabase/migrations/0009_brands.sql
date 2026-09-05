-- ============================================================
-- 0009 : multi-marque (produit/enseigne).
--
-- Une MARQUE = une identité d'envoi, un catalogue produit, un gabarit d'email
-- et un positionnement IA. Elle est déclarée en code (lib/brands/<slug>.ts) ;
-- la base ne stocke que son slug, pour cloisonner les données.
--
-- Attention au vocabulaire : la colonne `product` existante désigne une
-- VARIANTE de produit à l'intérieur d'une marque (ex. card | keyring | stand
-- pour Tag2Share) et alimente les tokens {{product_*}}. Elle n'a rien à voir
-- avec `brand`. Une marque possède N produits.
--
-- Le default 'tag2share' fait office de backfill : toutes les données
-- existantes appartiennent à la marque historique.
--
-- `prospects` ne reçoit PAS de colonne brand : le vivier de business est
-- PARTAGÉ entre les marques (les données enrichies - email, contact, logo -
-- sont des données d'entreprise, pas des données de marque), ce qui évite de
-- repayer Places + Gemini pour un business déjà enrichi. Le cloisonnement se
-- fait sur segments / campaigns / email_log.
--
-- Idempotent.
-- ============================================================

alter table public.segments  add column if not exists brand text not null default 'tag2share';
alter table public.campaigns add column if not exists brand text not null default 'tag2share';
alter table public.searches  add column if not exists brand text not null default 'tag2share';
alter table public.email_log add column if not exists brand text not null default 'tag2share';

create index if not exists segments_brand_idx  on public.segments(brand);
create index if not exists campaigns_brand_idx on public.campaigns(brand);
create index if not exists searches_brand_idx  on public.searches(brand);
create index if not exists email_log_brand_idx on public.email_log(brand);

-- Une campagne ne doit cibler que des segments de SA marque. La contrainte
-- n'est pas exprimable simplement en SQL sur la table de liaison ; elle est
-- garantie côté application (app/api/campaigns/[id]/segments). Cet index sert
-- les vérifications de cohérence.
create index if not exists campaign_segments_campaign_idx
  on public.campaign_segments(campaign_id);
