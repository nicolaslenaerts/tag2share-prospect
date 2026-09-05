import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail, type MergeData } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { activeBrand } from "@/lib/brand-context";
import { getBrand } from "@/lib/brands";
import { brandSender } from "@/lib/brand-sender";

export const runtime = "nodejs";

/**
 * Envoi d'un email de TEST au niveau campagne, SANS destinataire réel :
 * on fournit l'adresse de test + les données de fusion à simuler (name, city, ...)
 * et le produit à mettre en avant ({{product_*}}). N'envoie JAMAIS à un prospect.
 * L'email part sous l'identité de la marque de la campagne.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { testEmail, data, product } = await readJson<{
    testEmail?: string;
    data?: Partial<MergeData>;
    product?: string;
  }>(req);

  const requestBrand = activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("brand", requestBrand.slug)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

  // Identité d'envoi = marque de la campagne.
  let brand;
  try {
    brand = getBrand(campaign.brand);
  } catch (e) {
    return fail((e as Error).message, 500);
  }

  const sender = await brandSender(brand);
  const to = testEmail || sender.testEmail;
  if (!to)
    return fail(
      "Adresse de test requise : renseignez-la dans /reglages pour cette marque."
    );

  const { subject, html } = buildRecipientEmail({
    brand,
    // Le produit choisi pour le test prime ; sinon on garde le produit cible de la campagne.
    campaign: { ...campaign, product: product || campaign.product },
    recipient: {},
    prospect: data || {},
    segment: null,
    unsubscribeUrl: unsubscribeUrl(to, brand.slug),
  });

  try {
    const sent = await sendEmail({
      brand,
      sender,
      to,
      subject: `[TEST] ${subject}`,
      html,
    });
    return ok({ sent: true, to, resend: sent });
  } catch (e) {
    return fail(`Échec envoi test : ${(e as Error).message}`, 500);
  }
}
