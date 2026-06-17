-- ============================================================
-- 0005 : journal des emails envoyés (append-only).
-- Une ligne par email RÉELLEMENT envoyé à un prospect, avec toutes les
-- informations figées au moment de l'envoi (campagne, segment, produit mis
-- en avant, sujet, résultat). Sert de base pour savoir si un prospect a déjà
-- été contacté, par quelle campagne et avec quel produit.
--
-- On ne supprime jamais ces lignes : les FK sont en "on delete set null" pour
-- préserver l'historique (l'email reste connu via to_email) même si le
-- prospect / la campagne / le segment est supprimé.
-- ============================================================
create table if not exists public.email_log (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid references public.prospects(id)            on delete set null,
  campaign_id   uuid references public.campaigns(id)            on delete set null,
  recipient_id  uuid references public.campaign_recipients(id)  on delete set null,
  segment_id    uuid references public.segments(id)             on delete set null,
  to_email      text not null,                 -- email destinataire (normalisé, minuscules)
  prospect_name text,                           -- nom du business au moment de l'envoi
  campaign_name text,                           -- nom de la campagne au moment de l'envoi
  segment_label text,                           -- segment d'origine au moment de l'envoi
  product_key   text,                           -- produit mis en avant : card | keyring | stand
  product_name  text,                           -- nom du produit mis en avant (figé)
  product_price text,                           -- prix du produit mis en avant (figé)
  subject       text,                           -- sujet réellement envoyé (variables fusionnées)
  status        text not null,                  -- sent | failed
  resend_id     text,                           -- id Resend (suivi délivrabilité)
  error         text,                           -- message d'erreur si échec
  event         text,                           -- dernier événement Resend : delivered | opened | clicked | bounced | complained
  event_at      timestamptz,                    -- date du dernier événement
  meta          jsonb,                          -- infos additionnelles (ville, pays, catégorie, reply_to…)
  created_at    timestamptz not null default now()  -- moment de l'envoi
);

create index if not exists email_log_prospect_idx on public.email_log(prospect_id);
create index if not exists email_log_email_idx    on public.email_log(to_email);
create index if not exists email_log_campaign_idx on public.email_log(campaign_id);
create index if not exists email_log_resend_idx   on public.email_log(resend_id);

-- RLS : accès uniquement via service_role (routes API serveur), comme les autres tables.
alter table public.email_log enable row level security;
