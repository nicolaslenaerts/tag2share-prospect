/**
 * Journal des emails envoyés (table email_log, append-only).
 *
 * Chaque email RÉELLEMENT envoyé à un prospect y crée une ligne, avec toutes
 * les infos figées au moment de l'envoi (campagne, segment, produit mis en
 * avant, sujet, résultat). C'est la base pour savoir si un prospect a déjà été
 * contacté, par quelle campagne et avec quel produit.
 *
 * Le logging ne doit JAMAIS faire échouer un envoi : toutes les écritures
 * avalent leurs erreurs (console.error) au lieu de les propager.
 */
import { supabaseAdmin } from "./supabase";
import { getProduct } from "./products";
import { normEmail } from "./suppression";

export type EmailLogStatus = "sent" | "failed";

/** Enregistre un envoi (succès ou échec) dans le journal. Ne lève jamais. */
export async function logEmailSend(args: {
  prospect?: Record<string, any> | null;
  campaign?: Record<string, any> | null;
  recipient?: Record<string, any> | null;
  segment?: { id?: string; label?: string; product?: string | null } | null;
  toEmail: string;
  subject: string;
  status: EmailLogStatus;
  resendId?: string | null;
  error?: string | null;
  replyTo?: string | null;
}): Promise<void> {
  try {
    // Produit mis en avant : override campagne prioritaire, sinon segment. Figé ici.
    const product = getProduct(args.campaign?.product || args.segment?.product);
    const db = supabaseAdmin();
    const { error } = await db.from("email_log").insert({
      prospect_id: args.prospect?.id ?? null,
      campaign_id: args.campaign?.id ?? null,
      recipient_id: args.recipient?.id ?? null,
      segment_id: args.segment?.id ?? null,
      to_email: normEmail(args.toEmail),
      prospect_name: args.prospect?.name ?? null,
      campaign_name: args.campaign?.name ?? null,
      segment_label: args.segment?.label ?? null,
      product_key: product.key,
      product_name: product.name,
      product_price: product.price,
      subject: args.subject,
      status: args.status,
      resend_id: args.resendId ?? null,
      error: args.error ?? null,
      meta: {
        city: args.prospect?.city ?? null,
        country: args.prospect?.country ?? null,
        category: args.prospect?.category ?? null,
        contact_name: args.prospect?.contact_name ?? null,
        reply_to: args.replyTo ?? null,
      },
    });
    if (error) console.error("email_log insert failed:", error.message);
  } catch (e) {
    console.error("email_log insert threw:", (e as Error).message);
  }
}

// Rang des événements de délivrabilité : on ne "rétrograde" jamais un envoi
// (ex. un "delivered" tardif n'écrase pas un "clicked" déjà enregistré).
const EVENT_RANK: Record<string, number> = {
  delivered: 1,
  opened: 2,
  clicked: 3,
  bounced: 4,
  complained: 5,
};

/**
 * Met à jour le dernier événement de délivrabilité d'un envoi (via resend_id),
 * sans jamais rétrograder. Appelé depuis le webhook Resend. Ne lève jamais.
 */
export async function recordEmailEvent(
  resendId: string | null | undefined,
  event: string
): Promise<void> {
  if (!resendId || !(event in EVENT_RANK)) return;
  try {
    const db = supabaseAdmin();
    const { data: rows } = await db
      .from("email_log")
      .select("id, event")
      .eq("resend_id", resendId);
    for (const row of rows ?? []) {
      const currentRank = row.event ? EVENT_RANK[row.event] ?? 0 : 0;
      if (EVENT_RANK[event] < currentRank) continue; // ne pas rétrograder
      await db
        .from("email_log")
        .update({ event, event_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  } catch (e) {
    console.error("email_log event update threw:", (e as Error).message);
  }
}

export type ContactInfo = {
  /** Au moins un email réellement envoyé (status "sent"). */
  emailed: boolean;
  /** Date du premier envoi réussi. */
  emailedAt: string | null;
  /** Campagnes (noms figés) ayant contacté ce prospect, dédupliquées. */
  campaigns: string[];
  /** Produits mis en avant lors des envois réussis, dédupliqués. */
  products: string[];
};

/**
 * Statut "déjà contacté" par prospect, lu depuis le journal des emails envoyés
 * (source de vérité, immuable). Un envoi réussi est rattaché à un prospect via
 * son `prospect_id` OU son email (`to_email`), ce qui reste fiable même si le
 * prospect a été ré-importé avec un nouvel id, ou si la campagne a été supprimée.
 *
 * Seuls les envois "sent" comptent ; les échecs ("failed") ne valent pas contact.
 */
export async function contactHistory(
  prospects: Array<{ id: string; email?: string | null }>
): Promise<Map<string, ContactInfo>> {
  const map = new Map<string, ContactInfo>();
  const ids = Array.from(new Set(prospects.map((p) => p.id).filter(Boolean)));
  const emails = Array.from(
    new Set(prospects.map((p) => (p.email ? normEmail(p.email) : "")).filter(Boolean))
  );
  if (ids.length === 0) return map;

  const db = supabaseAdmin();
  // Lignes rattachées soit par id, soit par email (toutes campagnes).
  const filters = [`prospect_id.in.(${ids.join(",")})`];
  if (emails.length > 0)
    filters.push(`to_email.in.(${emails.map((e) => `"${e}"`).join(",")})`);
  const { data } = await db
    .from("email_log")
    .select("prospect_id, to_email, campaign_name, product_name, created_at")
    .eq("status", "sent")
    .or(filters.join(","));

  // Index des prospects par email pour rattacher une ligne sans prospect_id.
  const byEmail = new Map<string, string>();
  for (const p of prospects) if (p.email) byEmail.set(normEmail(p.email), p.id);
  const idSet = new Set(ids);

  const blank = (): ContactInfo => ({
    emailed: false,
    emailedAt: null,
    campaigns: [],
    products: [],
  });

  for (const row of data ?? []) {
    // Rattachement : prospect_id direct, sinon via l'email.
    const pid =
      (row.prospect_id && idSet.has(row.prospect_id) && row.prospect_id) ||
      (row.to_email && byEmail.get(normEmail(row.to_email))) ||
      null;
    if (!pid) continue;
    const cur = map.get(pid) ?? blank();
    cur.emailed = true;
    if (row.created_at && (!cur.emailedAt || row.created_at < cur.emailedAt))
      cur.emailedAt = row.created_at;
    if (row.campaign_name && !cur.campaigns.includes(row.campaign_name))
      cur.campaigns.push(row.campaign_name);
    if (row.product_name && !cur.products.includes(row.product_name))
      cur.products.push(row.product_name);
    map.set(pid, cur);
  }
  return map;
}
