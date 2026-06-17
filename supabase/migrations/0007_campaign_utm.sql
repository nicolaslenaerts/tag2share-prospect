-- ============================================================
-- 0007 : surcharges UTM au niveau campagne.
-- Chaque lien tag2share.com du corps de l'email reçoit des paramètres UTM.
-- Ces colonnes permettent d'adapter les valeurs par campagne ; si null/vide :
--   utm_source   → "email"
--   utm_medium   → "prospection"
--   utm_campaign → slug du nom de la campagne
-- ============================================================
alter table public.campaigns
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text;
