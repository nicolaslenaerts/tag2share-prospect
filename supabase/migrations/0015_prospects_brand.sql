-- ============================================================
-- 0015 : cloisonnement du vivier de prospects par marque.
--
-- Renverse la décision de 0009, qui laissait `prospects` PARTAGÉ entre les
-- marques pour ne pas repayer Places + Gemini sur un business déjà enrichi.
-- Un prospect appartient désormais à UNE marque : ses corrections manuelles,
-- son historique et son rattachement aux segments ne débordent plus.
--
-- L'économie d'appels API est conservée autrement : quand une marque découvre
-- un business déjà connu d'une autre, l'application CRÉE SA PROPRE LIGNE et la
-- pré-remplit avec l'enrichissement déjà payé (app/api/prospects/search,
-- app/api/prospects/import). Les deux lignes sont ensuite indépendantes.
--
-- Attention au vocabulaire : `brand` est la MARQUE ; la colonne `product`
-- désigne une variante de produit à l'intérieur d'une marque (voir 0009).
--
-- Backfill retenu : chaque prospect va à la marque de son segment d'ORIGINE.
-- Conséquence assumée : un business capté par une marque puis réutilisé par
-- une autre n'apparaît plus que dans la première. Les rattachements devenus
-- inter-marques sont supprimés (étape 4) pour que les compteurs de segments
-- disent la vérité.
--
-- Idempotent.
-- ============================================================

-- 1. La colonne. Le défaut couvre les prospects qu'aucun segment ne rattache
--    (import orphelin, prospect créé à la main) : ils restent à la marque
--    historique plutôt que de tomber dans une marque nulle.
alter table public.prospects
  add column if not exists brand text not null default 'tag2share';

create index if not exists prospects_brand_idx on public.prospects(brand);

-- 2. Unicité du place_id : PAR MARQUE, et non plus globale. Sans cette bascule,
--    la deuxième marque à trouver un commerce écraserait la ligne de la
--    première au lieu d'obtenir la sienne (upsert on conflict place_id).
--    `place_id` reste nullable : les prospects importés n'en ont pas, et
--    Postgres autorise autant de NULL qu'on veut dans un index unique.
alter table public.prospects drop constraint if exists prospects_place_id_key;
drop index if exists public.prospects_place_id_key;

create unique index if not exists prospects_brand_place_id_idx
  on public.prospects (brand, place_id);

-- 3. Backfill : marque du segment d'origine.
update public.prospects p
   set brand = s.brand
  from public.segments s
 where p.segment_id = s.id
   and p.brand is distinct from s.brand;

--    Prospects sans segment d'origine : marque du plus ancien rattachement.
update public.prospects p
   set brand = t.brand
  from (
    select sp.prospect_id,
           (array_agg(s.brand order by sp.created_at, s.id))[1] as brand
      from public.segment_prospects sp
      join public.segments s on s.id = sp.segment_id
     group by sp.prospect_id
  ) t
 where p.segment_id is null
   and p.id = t.prospect_id
   and p.brand is distinct from t.brand;

-- 4. Rattachements devenus inter-marques : un segment de la marque A ne peut
--    plus lister un prospect de la marque B. Les laisser gonflerait
--    `prospect_count` de segments dont la liste, elle, reviendrait vide
--    (l'API filtre désormais les prospects sur la marque).
delete from public.segment_prospects sp
 using public.segments s, public.prospects p
 where s.id = sp.segment_id
   and p.id = sp.prospect_id
   and s.brand <> p.brand;

-- 5. Destinataires de campagne inter-marques : VOLONTAIREMENT non supprimés.
--    Une campagne déjà envoyée est une archive ; effacer ses destinataires
--    réécrirait l'historique. L'envoi les ignore désormais (garde-fou dans
--    app/api/campaigns/[id]/send). Pour les recenser :
--
--    select c.brand as campagne, p.brand as prospect, count(*)
--      from public.campaign_recipients r
--      join public.campaigns c on c.id = r.campaign_id
--      join public.prospects p on p.id = r.prospect_id
--     where c.brand <> p.brand
--     group by 1, 2;
