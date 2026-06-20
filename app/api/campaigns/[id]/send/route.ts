import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { suppressedSet, normEmail } from "@/lib/suppression";
import { validateSendable } from "@/lib/email-validation";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { logEmailSend } from "@/lib/email-log";

export const runtime = "nodejs";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoi RÉEL aux prospects. SÉCURITÉ & délivrabilité :
 * - exige confirm === true, n'envoie qu'aux recipientIds fournis et "approved",
 * - ignore les emails de la liste de suppression (désinscrits / bounces / plaintes),
 * - valide chaque adresse (format, no-reply, MX) pour limiter les bounces,
 * - respecte un plafond quotidien (DAILY_SEND_CAP) et un délai entre envois (SEND_DELAY_MS),
 * - ajoute le lien + l'en-tête List-Unsubscribe.
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

  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

  const { data: recipients, error } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*, segment:segments!prospects_segment_id_fkey(*))")
    .eq("campaign_id", id)
    .in("id", recipientIds);
  if (error) return fail(error.message, 500);

  // Plafond quotidien (0 = illimité) : compte les envois déjà faits aujourd'hui.
  const dailyCap = Number(process.env.DAILY_SEND_CAP || 0);
  const delayMs = Number(process.env.SEND_DELAY_MS || 1200);
  let remaining = Infinity;
  if (dailyCap > 0) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await db
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", startOfDay.toISOString());
    remaining = Math.max(0, dailyCap - (count ?? 0));
  }

  // Liste de suppression pour toutes les adresses concernées.
  const emails = (recipients ?? []).map((r) => r.to_email || r.prospect?.email || "");
  const suppressed = await suppressedSet(emails);

  // Emails DÉJÀ contactés (toutes campagnes confondues) : journal immuable, source
  // de vérité. On ne renvoie jamais à une adresse déjà jointe par un envoi réussi,
  // même via une autre campagne ou un autre prospect partageant la même adresse.
  // Cet ensemble est aussi enrichi au fil de l'envoi pour bloquer les doublons
  // présents dans le lot courant (ex. deux prospects avec le même email).
  const normalizedEmails = Array.from(new Set(emails.map(normEmail).filter(Boolean)));
  const alreadyContacted = new Set<string>();
  if (normalizedEmails.length > 0) {
    const { data: logged } = await db
      .from("email_log")
      .select("to_email")
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

    // Déjà contacté (même via une autre campagne / un autre prospect) : on ne
    // renvoie jamais. Le destinataire bascule dans le groupe « Déjà contactés ».
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

    const unsub = unsubscribeUrl(to);
    const { subject, html } = buildRecipientEmail({
      campaign,
      recipient: r,
      prospect: r.prospect,
      segment: r.prospect?.segment, // produit du segment d'origine
      unsubscribeUrl: unsub,
    });

    try {
      const data = await sendEmail({
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
      // Journal immuable : email envoyé, produit mis en avant + infos figés.
      await logEmailSend({
        prospect: r.prospect,
        campaign,
        recipient: r,
        segment: r.prospect?.segment,
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
        prospect: r.prospect,
        campaign,
        recipient: r,
        segment: r.prospect?.segment,
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
