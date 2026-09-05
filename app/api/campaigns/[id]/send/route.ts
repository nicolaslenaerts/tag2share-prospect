import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { suppressedSet, normEmail } from "@/lib/suppression";
import { validateSendable } from "@/lib/email-validation";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { publicBaseFor } from "@/lib/public-url";
import { logEmailSend } from "@/lib/email-log";
import { activeBrand, requireSendableBrand } from "@/lib/brand-context";

import { brandSender } from "@/lib/brand-sender";
import { resolveProspectSegments } from "@/lib/campaign-segments";

export const runtime = "nodejs";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoi RÉEL aux prospects. SÉCURITÉ & délivrabilité :
 * - exige confirm === true, n'envoie qu'aux recipientIds fournis et "approved",
 * - l'identité d'envoi est celle de la MARQUE DE LA CAMPAGNE (résolution
 *   stricte : une marque inconnue fait échouer l'envoi plutôt que d'expédier
 *   sous une autre identité),
 * - ignore les emails de la liste de suppression de cette marque (désinscrits /
 *   bounces / plaintes),
 * - valide chaque adresse (format, no-reply, MX) pour limiter les bounces,
 * - part de l'adresse d'envoi de la marque (saisie dans /reglages, sinon
 *   défaut du code) via l'unique compte Resend,
 * - respecte un plafond quotidien et un délai PROPRES À LA MARQUE (la
 *   réputation d'envoi se joue par domaine),
 * - ajoute le lien + l'en-tête List-Unsubscribe signés pour cette marque.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { recipientIds, confirm, replyTo } = await readJson<{
    recipientIds: string[];
    confirm: boolean;
    replyTo?: string;
  }>(req);

  if (confirm !== true)
    return fail("Confirmation explicite requise (confirm: true).", 403);
  if (!Array.isArray(recipientIds) || recipientIds.length === 0)
    return fail("recipientIds requis.");

  const requestBrand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("brand", requestBrand.slug)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

  // Identité d'envoi = marque de la campagne, pas celle de la session. Refus si
  // la marque est encore en brouillon : c'est le dernier garde-fou avant que de
  // vrais prospects reçoivent un email sous une identité non vérifiée.
  let brand;
  try {
    brand = await requireSendableBrand(campaign.brand);
  } catch (e) {
    return fail((e as Error).message, 409);
  }
  // Identité d'expédition résolue UNE fois : elle reste figée pour tout le
  // lot, même si quelqu'un l'édite dans /reglages pendant l'envoi.
  // Domaine public de la marque : l'app peut répondre sur plusieurs noms de
  // domaine, le lien de désinscription doit sortir sur celui de la marque.
  const publicBase = await publicBaseFor(brand, req);
  const sender = await brandSender(brand);

  const { data: recipients, error } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*)")
    .eq("campaign_id", id)
    .in("id", recipientIds);
  if (error) return fail(error.message, 500);

  // Produit mis en avant : résolu depuis un segment DE CETTE MARQUE auquel le
  // prospect est rattaché. On passe par les segments de la campagne plutôt que
  // par prospects.segment_id, qui peut encore pointer vers un segment d'une
  // autre marque sur les données antérieures à la migration 0015.
  const segmentByProspect = await resolveProspectSegments(
    db,
    id,
    brand.slug,
    (recipients ?? []).map((r) => r.prospect_id).filter(Boolean)
  );

  // Plafond quotidien PAR MARQUE (0 = illimité), lu dans le journal d'envois.
  const dailyCap = sender.dailyCap;
  const delayMs = sender.delayMs;
  let remaining = Infinity;
  if (dailyCap > 0) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await db
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("brand", brand.slug)
      .eq("status", "sent")
      .gte("created_at", startOfDay.toISOString());
    remaining = Math.max(0, dailyCap - (count ?? 0));
  }

  // Liste de suppression de cette marque (+ exclusions globales).
  const emails = (recipients ?? []).map((r) => r.to_email || r.prospect?.email || "");
  const suppressed = await suppressedSet(emails, brand.slug);

  // Emails DÉJÀ contactés POUR CETTE MARQUE (toutes campagnes confondues) :
  // journal immuable, source de vérité. On ne renvoie jamais à une adresse déjà
  // jointe par un envoi réussi de cette marque, même via une autre campagne ou
  // un autre prospect partageant la même adresse. Un envoi d'une AUTRE marque
  // ne bloque pas : les marques démarchent chacune pour leur compte, et le
  // journal reste la seule table où leurs chemins se croisent (par email).
  // Cet ensemble est aussi enrichi au fil de l'envoi pour bloquer les doublons
  // présents dans le lot courant (ex. deux prospects avec le même email).
  const normalizedEmails = Array.from(new Set(emails.map(normEmail).filter(Boolean)));
  const alreadyContacted = new Set<string>();
  if (normalizedEmails.length > 0) {
    const { data: logged } = await db
      .from("email_log")
      .select("to_email")
      .eq("brand", brand.slug)
      .eq("status", "sent")
      .in("to_email", normalizedEmails);
    for (const row of logged ?? []) alreadyContacted.add(normEmail(row.to_email));
  }

  const results: any[] = [];
  for (const r of recipients || []) {
    if (r.status === "sent") {
      results.push({ id: r.id, skipped: "déjà envoyé" });
      continue;
    }
    if (r.status !== "approved") {
      results.push({ id: r.id, skipped: "non approuvé" });
      continue;
    }

    // Garde-fou de cloisonnement : le vivier appartient à une marque depuis la
    // migration 0015, qui laisse volontairement en place les destinataires
    // inter-marques créés avant elle (une campagne envoyée est une archive).
    // Ils ne doivent pas partir sous l'identité de cette marque-ci.
    if (r.prospect && r.prospect.brand && r.prospect.brand !== brand.slug) {
      await db
        .from("campaign_recipients")
        .update({ status: "skipped", error: "prospect d'une autre marque" })
        .eq("id", r.id);
      results.push({ id: r.id, skipped: "prospect d'une autre marque" });
      continue;
    }

    const to = r.to_email || r.prospect?.email;
    if (!to) {
      results.push({ id: r.id, skipped: "pas d'email" });
      continue;
    }

    // Désinscription / bounce / plainte : on ne renvoie jamais.
    if (suppressed.has(normEmail(to))) {
      await db
        .from("campaign_recipients")
        .update({ status: "skipped", error: "liste de suppression" })
        .eq("id", r.id);
      results.push({ id: r.id, to, skipped: "supprimé/désinscrit" });
      continue;
    }

    // Déjà contacté par cette marque (même via une autre campagne / un autre
    // prospect) : on ne renvoie jamais. Le destinataire bascule dans le groupe
    // « Déjà contactés ».
    if (alreadyContacted.has(normEmail(to))) {
      await db
        .from("campaign_recipients")
        .update({ status: "already_contacted", error: "déjà contacté" })
        .eq("id", r.id);
      results.push({ id: r.id, to, skipped: "déjà contacté" });
      continue;
    }

    // Validation (format, no-reply, MX) pour éviter les bounces.
    const v = await validateSendable(to);
    if (!v.ok) {
      await db
        .from("campaign_recipients")
        .update({ status: "failed", error: `email invalide : ${v.reason}` })
        .eq("id", r.id);
      results.push({ id: r.id, to, error: `email invalide : ${v.reason}` });
      continue;
    }

    // Plafond quotidien atteint : on garde "approved" pour reprendre plus tard.
    if (remaining <= 0) {
      results.push({ id: r.id, to, skipped: "plafond quotidien atteint" });
      continue;
    }

    const segment = segmentByProspect.get(r.prospect_id) ?? null;
    const unsub = unsubscribeUrl(to, brand, publicBase);
    const { subject, html } = buildRecipientEmail({
      brand,
      campaign,
      recipient: r,
      prospect: r.prospect,
      segment, // produit du segment de CETTE marque
      unsubscribeUrl: unsub,
    });

    try {
      const data = await sendEmail({
        brand,
        sender,
        to,
        subject,
        html,
        replyTo,
        headers: {
          "List-Unsubscribe": `<${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      const resendId = (data as any)?.id ?? null;
      await db
        .from("campaign_recipients")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_id: resendId,
          error: null,
        })
        .eq("id", r.id);
      // Journal immuable : marque, produit mis en avant + infos figés.
      await logEmailSend({
        brand,
        prospect: r.prospect,
        campaign,
        recipient: r,
        segment,
        toEmail: to,
        subject,
        status: "sent",
        resendId,
        replyTo,
      });
      // Marque cette adresse comme contactée pour bloquer tout doublon ultérieur
      // dans ce même lot (deux destinataires partageant la même adresse).
      alreadyContacted.add(normEmail(to));
      results.push({ id: r.id, to, sent: true });
      remaining -= 1;
      if (delayMs > 0) await sleep(delayMs);
    } catch (e) {
      await db
        .from("campaign_recipients")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", r.id);
      await logEmailSend({
        brand,
        prospect: r.prospect,
        campaign,
        recipient: r,
        segment,
        toEmail: to,
        subject,
        status: "failed",
        error: (e as Error).message,
        replyTo,
      });
      results.push({ id: r.id, to, error: (e as Error).message });
    }
  }

  const sent = results.filter((x) => x.sent).length;
  const capped = results.some((x) => x.skipped === "plafond quotidien atteint");
  return ok({ results, sent, capped });
}
