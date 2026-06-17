-- ============================================================
-- Tag2Share Prospect - schéma Supabase
-- À exécuter dans le SQL Editor du projet umabxfhfsacnxbbsxwat
-- ============================================================

-- Extension pour UUID
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Segments : types de business proposés par l'IA, validés par l'utilisateur
-- ------------------------------------------------------------
create table if not exists public.segments (
  id           uuid primary key default gen_random_uuid(),
  label         text not null,                -- ex: "Salons de coiffure"
  rationale     text,                         -- pourquoi ce business a besoin des produits
  product       text,                         -- clé produit mise en avant : card | keyring | stand
  search_terms  text[] default '{}',          -- requêtes Google Places associées
  email_subject text,                         -- sujet de l'email tailored pour ce segment/produit
  email_body    text,                         -- corps de l'email (HTML, variables {{...}})
  approved      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Prospects : business trouvés via Google Places + enrichissement
-- ------------------------------------------------------------
create table if not exists public.prospects (
  id            uuid primary key default gen_random_uuid(),
  segment_id    uuid references public.segments(id) on delete set null,
  place_id      text unique,                  -- Google place_id (dédoublonnage)
  name          text not null,
  category      text,
  address       text,
  city          text,
  country       text,
  phone         text,
  website       text,
  email         text,
  contact_name  text,
  logo_url      text,
  rating        numeric,
  reviews_count integer,
  raw_place     jsonb,                         -- réponse brute Places
  enrichment    jsonb,                         -- données extraites du site (réseaux, description, etc.)
  status        text not null default 'found', -- found | enriched | rejected
  created_at    timestamptz not null default now()
);

create index if not exists prospects_segment_idx on public.prospects(segment_id);
create index if not exists prospects_status_idx  on public.prospects(status);

-- ------------------------------------------------------------
-- Rattachement multiple prospect <-> segment.
-- Un même business (dédoublonné globalement par place_id) peut être pertinent
-- pour plusieurs segments. prospects.segment_id reste le segment d'ORIGINE
-- (premier segment où il a été trouvé) ; l'appartenance complète vit ici.
-- ------------------------------------------------------------
create table if not exists public.segment_prospects (
  segment_id   uuid not null references public.segments(id)  on delete cascade,
  prospect_id  uuid not null references public.prospects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (segment_id, prospect_id)
);

create index if not exists segment_prospects_prospect_idx on public.segment_prospects(prospect_id);

-- ------------------------------------------------------------
-- Journal des recherches lancées (par segment + zone).
-- Permet de voir ce qui a déjà été cherché et d'éviter de relancer inutilement.
-- ------------------------------------------------------------
create table if not exists public.searches (
  id           uuid primary key default gen_random_uuid(),
  segment_id   uuid references public.segments(id) on delete cascade,
  country      text,
  city         text,
  zone         text,
  max_results  integer,
  found_count  integer not null default 0,   -- nb de prospects retournés par cette recherche
  new_count    integer not null default 0,   -- dont nouveaux pour ce segment
  created_at   timestamptz not null default now()
);

create index if not exists searches_segment_idx on public.searches(segment_id);

-- ------------------------------------------------------------
-- Campagnes : un template d'email + sujet par défaut
-- ------------------------------------------------------------
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  segment_id    uuid references public.segments(id) on delete set null, -- (déprécié) 1er segment, conservé pour compat ; voir campaign_segments
  name          text not null,
  subject       text not null default '',
  body_html     text not null default '',     -- template avec variables {{name}}, {{contact_name}}, ...
  email_tagline text,                          -- accroche sous le logo (null = défaut, '' = masquée)
  product       text,                          -- produit cible (override) : null = produit du segment ; sinon card | keyring | stand
  utm_source    text,                          -- surcharge UTM (null/vide = "email")
  utm_medium    text,                          -- surcharge UTM (null/vide = "prospection")
  utm_campaign  text,                          -- surcharge UTM (null/vide = slug du nom)
  status        text not null default 'draft', -- draft | ready | sending | done
  created_at    timestamptz not null default now()
);

create index if not exists campaigns_segment_idx on public.campaigns(segment_id);

-- ------------------------------------------------------------
-- Une campagne peut cibler PLUSIEURS segments. L'email est rédigé au niveau
-- de la campagne ; le produit mis en avant ({{product_*}}) est résolu par
-- destinataire depuis le segment d'origine du prospect.
-- ------------------------------------------------------------
create table if not exists public.campaign_segments (
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  segment_id   uuid not null references public.segments(id)  on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, segment_id)
);

create index if not exists campaign_segments_segment_idx on public.campaign_segments(segment_id);

-- ------------------------------------------------------------
-- Destinataires : un prospect rattaché à une campagne, avec contenu adaptable
-- ------------------------------------------------------------
create table if not exists public.campaign_recipients (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  prospect_id     uuid not null references public.prospects(id) on delete cascade,
  to_email        text,                         -- email résolu (peut être édité)
  custom_subject  text,                         -- override du sujet pour ce prospect (sinon template)
  custom_html     text,                         -- override du corps pour ce prospect (sinon template rendu)
  status          text not null default 'draft',-- draft | approved | test_sent | sent | failed | skipped | excluded (retiré manuellement, jamais ré-ajouté par la synchro)
  resend_id       text,
  error           text,
  test_sent_at    timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (campaign_id, prospect_id)
);

create index if not exists recipients_campaign_idx on public.campaign_recipients(campaign_id);
create index if not exists recipients_status_idx   on public.campaign_recipients(status);

-- ------------------------------------------------------------
-- Liste de suppression : emails à ne JAMAIS recontacter
-- (désinscription, bounce dur, plainte spam, ajout manuel).
-- Respectée à chaque envoi.
-- ------------------------------------------------------------
create table if not exists public.suppressions (
  email      text primary key,              -- email normalisé (minuscules)
  reason     text not null default 'unsubscribe', -- unsubscribe | bounce | complaint | manual
  detail     text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Journal des emails envoyés (append-only). Une ligne par email RÉELLEMENT
-- envoyé à un prospect, avec les infos figées au moment de l'envoi (campagne,
-- segment, produit mis en avant, sujet, résultat). Base pour savoir si un
-- prospect a déjà été contacté. FK "on delete set null" : l'historique survit
-- à la suppression d'un prospect / d'une campagne (l'email reste dans to_email).
-- ------------------------------------------------------------
create table if not exists public.email_log (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid references public.prospects(id)            on delete set null,
  campaign_id   uuid references public.campaigns(id)            on delete set null,
  recipient_id  uuid references public.campaign_recipients(id)  on delete set null,
  segment_id    uuid references public.segments(id)             on delete set null,
  to_email      text not null,                 -- email destinataire (normalisé)
  prospect_name text,
  campaign_name text,
  segment_label text,
  product_key   text,                           -- card | keyring | stand
  product_name  text,
  product_price text,
  subject       text,
  status        text not null,                  -- sent | failed
  resend_id     text,
  error         text,
  event         text,                           -- delivered | opened | clicked | bounced | complained
  event_at      timestamptz,
  meta          jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists email_log_prospect_idx on public.email_log(prospect_id);
create index if not exists email_log_email_idx    on public.email_log(to_email);
create index if not exists email_log_campaign_idx on public.email_log(campaign_id);
create index if not exists email_log_resend_idx   on public.email_log(resend_id);

-- ------------------------------------------------------------
-- RLS : l'app est mono-utilisateur et accède via service_role côté serveur.
-- On active RLS et on n'ajoute PAS de policy publique : l'anon key ne peut rien lire/écrire,
-- toutes les écritures passent par les routes API serveur (service_role).
-- ------------------------------------------------------------
alter table public.segments            enable row level security;
alter table public.prospects           enable row level security;
alter table public.segment_prospects   enable row level security;
alter table public.searches            enable row level security;
alter table public.campaigns           enable row level security;
alter table public.campaign_segments   enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.suppressions        enable row level security;
alter table public.email_log           enable row level security;
