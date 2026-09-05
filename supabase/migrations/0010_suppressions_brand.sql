-- ============================================================
-- 0010 : périmètre des suppressions par marque.
--
-- Avant : suppressions.email en clé primaire → une désinscription valait pour
-- TOUT l'outil. Avec plusieurs marques, il faut pouvoir distinguer :
--   brand = '*'      → l'adresse est exclue pour TOUTES les marques
--   brand = '<slug>' → l'adresse est exclue pour CETTE marque uniquement
--
-- Les lignes existantes deviennent '*' : le comportement historique (exclusion
-- globale) est préservé, ce qui est le choix prudent. La règle qui décide du
-- périmètre selon la raison (unsubscribe / bounce / complaint / manual) vit
-- dans lib/suppression.ts → suppressionScope().
--
-- Idempotent.
-- ============================================================

alter table public.suppressions
  add column if not exists brand text not null default '*';

-- Repose la clé primaire sur (email, brand).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'suppressions_pkey'
      and conrelid = 'public.suppressions'::regclass
      and array_length(conkey, 1) = 1
  ) then
    alter table public.suppressions drop constraint suppressions_pkey;
    alter table public.suppressions add primary key (email, brand);
  end if;
end $$;

create index if not exists suppressions_email_idx on public.suppressions(email);
create index if not exists suppressions_brand_idx on public.suppressions(brand);
