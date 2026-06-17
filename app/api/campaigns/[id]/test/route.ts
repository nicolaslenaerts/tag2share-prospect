import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail, type MergeData } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { unsubscribeUrl } from "@/lib/unsubscribe";

export const runtime = "nodejs";

/**
 * Envoi d'un email de TEST au niveau campagne, SANS destinataire réel :
 * on fournit l'adresse de test + les données de fusion à simuler (name, city, ...)
 * et le produit à mettre en avant ({{product_*}}). N'envoie JAMAIS à un prospect.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { testEmail, data, product } = await readJson<{
    testEmail?: string;
    data?: Partial<MergeData>;
    product?: string;
  }>(req);

  const to = testEmail || process.env.TEST_EMAIL;
  if (!to) return fail("Adresse de test requise (ou TEST_EMAIL).");

  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

  const { subject, html } = buildRecipientEmail({
    // Le produit choisi pour le test prime ; sinon on garde le produit cible de la campagne.
    campaign: { ...campaign, product: product || campaign.product },
    recipient: {},
    prospect: data || {},
    segment: null,
    unsubscribeUrl: unsubscribeUrl(to),
  });

  try {
    const sent = await sendEmail({ to, subject: `[TEST] ${subject}`, html });
    return ok({ sent: true, to, resend: sent });
  } catch (e) {
    return fail(`Échec envoi test : ${(e as Error).message}`, 500);
  }
}
