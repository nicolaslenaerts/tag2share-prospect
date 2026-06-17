-- ============================================================
-- 0006 : produit cible au niveau campagne (override).
-- Par défaut (null), le produit mis en avant ({{product_*}}) reste résolu par
-- destinataire depuis le segment d'origine du prospect. Si renseigné
-- (card | keyring | stand), il remplace ce choix pour TOUS les destinataires
-- de la campagne.
-- ============================================================
alter table public.campaigns
  add column if not exists product text; -- null = produit du segment ; sinon override campagne
