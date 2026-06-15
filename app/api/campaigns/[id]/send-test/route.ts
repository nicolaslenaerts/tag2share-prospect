import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail, type MergeData } from "@/lib/email";
import { sendEmail } from "@/lib/resend";

export const runtime = "nodejs";

/**
 * Envoie un email de TEST à l'adresse TEST_EMAIL (override du destinataire réel).
 * Permet de vérifier le rendu, avec possibilité de surcharger les données fusionnées.
 * N'envoie JAMAIS au prospect réel.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { recipientId, overrideData, testEmail } = await readJson<{
    recipientId: string;
    overrideData?: Partial<MergeData>;
    testEmail?: string;
  }>(req);
  if (!recipientId) return fail("recipientId requis.");

  const to = testEmail || process.env.TEST_EMAIL;
  if (!to) return fail("Aucune adresse de test (TEST_EMAIL manquante).");

  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*, segment:segments(*)")
    .eq("id", id)
    .single();
  const { data: recipient } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*, segment:segments!prospects_segment_id_fkey(*))")
    .eq("id", recipientId)
    .single();
  if (!campaign || !recipient) return fail("Campagne ou destinataire introuvable.", 404);

  const { subject, html } = buildRecipientEmail({
    campaign,
    recipient,
    prospect: recipient.prospect,
    // Produit résolu depuis le segment d'origine du prospect.
    segment: recipient.prospect?.segment,
    overrideData,
  });

  try {
    const data = await sendEmail({
      to,
      subject: `[TEST] ${subject}`,
      html,
    });
    await db
      .from("campaign_recipients")
      .update({ status: "test_sent", test_sent_at: new Date().toISOString() })
      .eq("id", recipientId);
    return ok({ sent: true, to, resend: data });
  } catch (e) {
    return fail(`Échec envoi test : ${(e as Error).message}`, 500);
  }
}
