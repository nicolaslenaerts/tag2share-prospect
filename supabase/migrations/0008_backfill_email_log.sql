-- ============================================================
-- 0008 : backfill du journal email_log depuis les envois historiques.
--
-- email_log est append-only et n'enregistre que les envois faits APRÈS sa
-- création. Les prospects contactés avant (présents uniquement dans
-- campaign_recipients en status 'sent') doivent y être recopiés pour rester
-- "déjà contacté" dans la liste prospects.
--
-- Idempotent : on n'insère que les destinataires qui ne sont pas déjà
-- journalisés (via recipient_id). Rejouable sans créer de doublons.
--
-- Produit mis en avant : on reproduit la résolution réelle de l'email,
-- c.-à-d. override de la campagne (campaigns.product) prioritaire, sinon
-- produit du segment d'ORIGINE du prospect (prospects.segment_id -> segments.product),
-- puis normalisation vers card | keyring | stand (défaut keyring).
-- ============================================================
insert into public.email_log (
  prospect_id, campaign_id, recipient_id, segment_id,
  to_email, prospect_name, campaign_name, segment_label,
  product_key, product_name, product_price,
  subject, status, resend_id, created_at
)
select
  cr.prospect_id,
  cr.campaign_id,
  cr.id,
  p.segment_id,
  lower(trim(coalesce(cr.to_email, p.email))),
  p.name,
  c.name,
  seg.label,
  prod.key,
  case prod.key
    when 'card'  then 'Carte de visite connectée'
    when 'stand' then 'Présentoir connecté'
    else 'Porte-clé connecté'
  end,
  case prod.key
    when 'card'  then '24,90 €'
    when 'stand' then '34,90 €'
    else '14,90 €'
  end,
  coalesce(cr.custom_subject, c.subject),
  'sent',
  cr.resend_id,
  coalesce(cr.sent_at, cr.created_at)
from public.campaign_recipients cr
join public.campaigns c        on c.id = cr.campaign_id
join public.prospects p        on p.id = cr.prospect_id
left join public.segments seg  on seg.id = p.segment_id
cross join lateral (
  select case
    when lower(coalesce(nullif(c.product, ''), seg.product, '')) ~ 'card|carte|visite' then 'card'
    when lower(coalesce(nullif(c.product, ''), seg.product, '')) ~ 'stand|présentoir|presentoir' then 'stand'
    else 'keyring'
  end as key
) prod
where cr.status = 'sent'
  and coalesce(cr.to_email, p.email) is not null
  and not exists (
    select 1 from public.email_log el where el.recipient_id = cr.id
  );
