-- ============================================================
-- 0014 : origine d'un prospect.
--
-- Jusqu'ici tous les prospects venaient de Google Places. L'import de fichiers
-- CSV ouvre une seconde porte d'entrée, avec une fiabilité de données très
-- différente (un fichier acheté ou exporté à la main n'a pas la qualité d'une
-- fiche Places). Tracer l'origine permet de filtrer, d'auditer et de décider
-- quoi enrichir en priorité.
--
--   places  : trouvé par la recherche Google Places (défaut historique)
--   csv     : importé depuis un fichier
--   manual  : créé à la main dans l'interface
--
-- Idempotent.
-- ============================================================

alter table public.prospects
  add column if not exists source text not null default 'places';

create index if not exists prospects_source_idx on public.prospects(source);

-- Les prospects importés n'ont pas de place_id. Rappel : la contrainte unique
-- sur place_id ne les dédoublonne donc PAS (Postgres autorise plusieurs NULL) ;
-- la déduplication d'un import est applicative (lib/prospect-import.ts).
