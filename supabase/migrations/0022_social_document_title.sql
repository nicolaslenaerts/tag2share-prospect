-- ============================================================
-- 0022 : titre du document d'un carrousel LinkedIn.
--
-- LinkedIn affiche un titre au-dessus d'un post document (PDF). Buffer le
-- reçoit dans `assets.document.title`, requis par le schéma. Jusqu'ici il
-- reprenait le libellé interne du post (`title`), à défaut le nom du fichier.
--
-- `document_title` le rend saisissable à part. NULL : on garde l'ancien repli
-- (libellé interne, puis nom du fichier), ce qui ne change rien pour les
-- posts existants.
--
-- Porté par le post et non par la ligne du média : un post n'a qu'un PDF, et
-- le titre survit ainsi au remplacement ou à la régénération du fichier.
--
-- Idempotent.
-- ============================================================

alter table public.social_posts add column if not exists document_title text;
