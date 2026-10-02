-- ============================================================
-- 0018 : réseaux sociaux par marque, publiés via Buffer.
--
-- Chaque marque connecte SON compte Buffer avec une clé API personnelle
-- (Buffer → Settings → API). La clé est chiffrée par l'application
-- (AES-256-GCM, variable SOCIAL_ENCRYPTION_KEY) avant d'arriver ici : la base
-- ne voit jamais la clé en clair.
--
-- Un post de l'outil = un texte + des médias + N canaux Buffer. Buffer, lui,
-- ne connaît qu'un canal par post : chaque canal ciblé devient une ligne de
-- social_post_targets, qui porte l'id du post Buffer, son statut et le lien
-- public une fois publié.
--
-- Les médias vivent dans le bucket PUBLIC `social-media` : Buffer télécharge
-- chaque fichier AU MOMENT DE LA PUBLICATION (developers.buffer.com, guide
-- « Hosting media »), parfois des jours après la programmation. Une URL
-- signée expirerait avant : il faut une URL publique stable. Les chemins
-- contiennent un UUID aléatoire, impossible à deviner.
--
-- Idempotent.
-- ============================================================

-- Connexion Buffer d'une marque.
create table if not exists public.brand_buffer (
  brand               text primary key,          -- slug de la marque
  api_key_encrypted   text not null,             -- base64(ciphertext + tag GCM)
  api_key_iv          text not null,             -- base64(IV 12 octets)
  api_key_version     int  not null default 1,   -- version de la clé maître
  api_key_hint        text,                      -- 4 derniers caractères, affichage seul
  account_email       text,                      -- compte Buffer associé à la clé
  notify_email        text,                      -- destinataire par défaut des notifications
  channels_synced_at  timestamptz,
  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Canaux Buffer (comptes Instagram, pages Facebook, pages LinkedIn...).
-- Cache local : l'API Buffer est plafonnée (250 requêtes/jour sur l'offre
-- gratuite), le calendrier et l'éditeur ne doivent pas l'interroger à chaque
-- affichage. `enabled` permet d'écarter un canal qu'une même clé Buffer
-- partagerait avec une autre marque.
create table if not exists public.social_channels (
  brand            text not null,
  id               text not null,                 -- channelId Buffer
  service          text not null,                 -- instagram | facebook | linkedin | ...
  name             text,
  display_name     text,
  avatar           text,
  organization_id  text,
  enabled          boolean not null default true,
  disconnected     boolean not null default false,
  synced_at        timestamptz not null default now(),
  primary key (brand, id)
);

create table if not exists public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  brand          text not null,
  title          text,                            -- libellé interne (calendrier, titre du PDF)
  text           text not null default '',
  format         text not null default 'post',
  scheduled_at   timestamptz,
  status         text not null default 'draft',
  first_comment  text,
  notify         boolean not null default true,   -- email à la publication
  notify_email   text,                            -- surcharge du destinataire
  notified_at    timestamptz,                     -- email de publication parti
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.social_posts drop constraint if exists social_posts_format_check;
alter table public.social_posts add constraint social_posts_format_check
  check (format in ('post', 'reel', 'carousel'));
alter table public.social_posts drop constraint if exists social_posts_status_check;
alter table public.social_posts add constraint social_posts_status_check
  check (status in ('draft', 'scheduled', 'published', 'partial', 'failed'));

create index if not exists social_posts_brand_date_idx
  on public.social_posts (brand, scheduled_at);

-- Un canal ciblé par un post.
create table if not exists public.social_post_targets (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.social_posts(id) on delete cascade,
  channel_id       text not null,
  service          text not null,
  status           text not null default 'pending',
  buffer_post_id   text,
  published_url    text,
  published_at     timestamptz,
  error            text,
  last_checked_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (post_id, channel_id)
);

alter table public.social_post_targets drop constraint if exists social_post_targets_status_check;
alter table public.social_post_targets add constraint social_post_targets_status_check
  check (status in ('pending', 'scheduled', 'buffer_draft', 'published', 'failed'));

create index if not exists social_post_targets_due_idx
  on public.social_post_targets (status, last_checked_at);

-- Médias d'un post, dans l'ordre du carrousel.
--   image / video : partagés par tous les réseaux du post ;
--   document      : PDF réservé à LinkedIn (carrousel document).
create table if not exists public.social_media (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.social_posts(id) on delete cascade,
  brand           text not null,
  kind            text not null,
  position        int  not null default 0,
  storage_path    text not null,
  mime_type       text not null,
  filename        text not null,
  size_bytes      bigint,
  width           int,
  height          int,
  thumbnail_path  text,                           -- vignette (page 1 d'un PDF, image d'une vidéo)
  page_count      int,
  created_at      timestamptz not null default now()
);

alter table public.social_media drop constraint if exists social_media_kind_check;
alter table public.social_media add constraint social_media_kind_check
  check (kind in ('image', 'video', 'document'));

create index if not exists social_media_post_idx on public.social_media (post_id, position);
create index if not exists social_media_path_idx on public.social_media (storage_path);

-- Même posture que le reste du schéma : RLS active sans policy publique,
-- tous les accès passent par la clé service_role côté serveur.
alter table public.brand_buffer        enable row level security;
alter table public.social_channels     enable row level security;
alter table public.social_posts        enable row level security;
alter table public.social_post_targets enable row level security;
alter table public.social_media        enable row level security;

-- Bucket public des médias. Pas de policy d'écriture : les uploads passent
-- par des URL signées émises côté serveur (clé service_role), le navigateur
-- envoie le fichier directement à Supabase sans transiter par les fonctions
-- serverless (plafonnées à 4,5 Mo de requête chez Vercel).
-- ⚠️ Offre gratuite Supabase : 50 Mo maximum par fichier.
insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'social-media',
  'social-media',
  true,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types;
