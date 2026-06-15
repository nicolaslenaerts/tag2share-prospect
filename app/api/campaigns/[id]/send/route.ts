import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail } from "@/lib/email";
import { sendEmail } from "@/lib/resend";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Envoi RÉEL aux prospects. SÉCURITÉ :
 * - exige confirm === true (accord explicite),
 * - n'envoie qu'aux recipientIds explicitement fournis,
 * - chaque destinataire doit avoir le statut "approved" et un email valide,
 * - ignore ceux déjà envoyés.
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
    .select("*, segment:segments(*)")
    .eq("id", id)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

  const { data: recipients, error } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*, segment:segments!prospects_segment_id_fkey(*))")
    .eq("campaign_id", id)
    .in("id", recipientIds);
  if (error) return fail(error.message, 500);

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

    const { subject, html } = buildRecipientEmail({
      campaign,
      recipient: r,
      prospect: r.prospect,
      // Produit résolu depuis le segment d'origine du prospect.
      segment: r.prospect?.segment,
    });

    try {
      const data = await sendEmail({ to, subject, html, replyTo });
      await db
        .from("campaign_recipients")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_id: (data as any)?.id ?? null,
          error: null,
        })
        .eq("id", r.id);
      results.push({ id: r.id, to, sent: true });
    } catch (e) {
      await db
        .from("campaign_recipients")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", r.id);
      results.push({ id: r.id, to, error: (e as Error).message });
    }
  }

  return ok({ results });
}
