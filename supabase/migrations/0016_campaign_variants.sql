-- ============================================================
-- 0016 : plusieurs templates par campagne, avec proportion d'envoi.
--
-- Jusqu'ici une campagne portait UN template (campaigns.subject / body_html).
-- Elle porte désormais N « variantes », chacune avec un poids en % : ex.
-- variante A 35 %, B 35 %, C 30 %. La variante retenue pour un destinataire
-- est FIGÉE sur sa ligne (campaign_recipients.variant_id) avant l'envoi, et
-- non tirée au moment d'expédier : l'envoi se fait par lots, un tirage par lot
-- ferait dériver la proportion globale et empêcherait de prévisualiser ce qui
-- part réellement.
--
-- Vocabulaire : `brand` = la marque, `product` = une variante de PRODUIT dans
-- le catalogue de la marque (0009), `variant` = une version du TEXTE de l'email.
--
-- Le template de la campagne reste en place (campaigns.subject / body_html) :
--   - il sert de repli si une campagne n'a aucune variante,
--   - il reflète la 1re variante pour les lectures historiques.
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Les variantes.
--    `weight` est une part en % ; la somme des variantes d'une campagne doit
--    faire 100 (contrainte applicative : le SQL ne peut pas vérifier une somme
--    par groupe sans trigger, et un état transitoire hors-100 doit rester
--    enregistrable pendant l'édition). L'envoi, lui, refuse une somme ≠ 100.
-- ------------------------------------------------------------
create table if not exists public.campaign_variants (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  name          text not null default 'Variante',
  subject       text not null default '',
  body_html     text not null default '',
  email_tagline text,                          -- accroche sous le logo (null = défaut marque, '' = masquée)
  product       text,                          -- produit mis en avant (override) ; null = produit de la campagne, sinon du segment
  weight        integer not null default 0 check (weight >= 0 and weight <= 100),
  sort_order    integer not null default 0,    -- ordre d'affichage (« position » est un mot réservé SQL)
  created_at    timestamptz not null default now()
);

create index if not exists campaign_variants_campaign_idx
  on public.campaign_variants(campaign_id, sort_order);

-- ------------------------------------------------------------
-- 2. Variante figée sur le destinataire.
--    « on delete set null » : supprimer une variante ne supprime pas des
--    destinataires. Ceux qui la portaient repassent à null et seront
--    re-répartis au prochain calcul (ou à l'envoi, en dernier recours).
-- ------------------------------------------------------------
alter table public.campaign_recipients
  add column if not exists variant_id uuid
    references public.campaign_variants(id) on delete set null;

create index if not exists recipients_variant_idx
  on public.campaign_recipients(variant_id);

-- ------------------------------------------------------------
-- 3. Journal : variante figée à l'envoi.
--    `variant_name` est dupliqué volontairement (comme campaign_name /
--    segment_label) : le journal doit rester lisible après suppression de la
--    variante, c'est la seule base pour comparer les performances des textes.
-- ------------------------------------------------------------
alter table public.email_log
  add column if not exists variant_id uuid
    references public.campaign_variants(id) on delete set null,
  add column if not exists variant_name text;

create index if not exists email_log_variant_idx on public.email_log(variant_id);

alter table public.campaign_variants enable row level security;

-- ------------------------------------------------------------
-- 4. Backfill : chaque campagne existante reçoit UNE variante à 100 %,
--    copie de son template actuel. Idempotent (ne fait rien si la campagne a
--    déjà au moins une variante).
-- ------------------------------------------------------------
-- `product` reste NULL volontairement : la variante n'impose pas de produit et
-- laisse jouer la cascade (variante -> campagne -> segment). Le sélecteur
-- « Produit cible » de la campagne continue donc de fonctionner comme avant,
-- une variante ne pouvant le surcharger que si on le lui demande explicitement.
insert into public.campaign_variants
  (campaign_id, name, subject, body_html, email_tagline, product, weight, sort_order)
select c.id, 'Variante A', c.subject, c.body_html, c.email_tagline, null, 100, 0
from public.campaigns c
where not exists (
  select 1 from public.campaign_variants v where v.campaign_id = c.id
);

-- ------------------------------------------------------------
-- 5. Backfill des destinataires : ils pointent vers l'unique variante de leur
--    campagne. Ces campagnes n'ont jamais eu qu'un template, l'affectation est
--    donc exacte et non une approximation.
-- ------------------------------------------------------------
update public.campaign_recipients r
set variant_id = v.id
from public.campaign_variants v
where v.campaign_id = r.campaign_id
  and r.variant_id is null
  and (select count(*) from public.campaign_variants v2 where v2.campaign_id = r.campaign_id) = 1;

-- ------------------------------------------------------------
-- 6. Backfill du journal, même raisonnement : un envoi passé d'une campagne
--    mono-template a forcément utilisé cette variante.
-- ------------------------------------------------------------
update public.email_log l
set variant_id = v.id, variant_name = v.name
from public.campaign_variants v
where v.campaign_id = l.campaign_id
  and l.variant_id is null
  and (select count(*) from public.campaign_variants v2 where v2.campaign_id = l.campaign_id) = 1;
