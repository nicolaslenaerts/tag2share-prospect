import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail, type MergeData } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { publicBaseFor } from "@/lib/public-url";
import { activeBrand } from "@/lib/brand-context";
import { resolveBrandStrict } from "@/lib/brands/store";
import { brandSender } from "@/lib/brand-sender";
import { resolveProspectSegments } from "@/lib/campaign-segments";

export const runtime = "nodejs";

/**
 * Envoie un email de TEST à l'adresse de test de la marque (override du
 * destinataire réel). Permet de vérifier le rendu, avec possibilité de
 * surcharger les données fusionnées. N'envoie JAMAIS au prospect réel.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { recipientId, overrideData, testEmail } = await readJson<{
    recipientId: string;
    overrideData?: Partial<MergeData>;
    testEmail?: string;
  }>(req);
  if (!recipientId) return fail("recipientId requis.");

  const requestBrand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("brand", requestBrand.slug)
    .single();
  const { data: recipient } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*)")
    .eq("id", recipientId)
    .eq("campaign_id", id)
    .single();
  if (!campaign || !recipient) return fail("Campagne ou destinataire introuvable.", 404);

  // Identité d'envoi = marque de la campagne. Un email de TEST part même si la
  // marque est encore en brouillon : c'est précisément l'outil qui sert à la
  // vérifier avant de l'activer.
  let brand;
  try {
    brand = await resolveBrandStrict(campaign.brand);
  } catch (e) {
    return fail((e as Error).message, 500);
  }

  // Domaine public de la marque : l'app peut répondre sur plusieurs noms de
  // domaine, le lien de désinscription doit sortir sur celui de la marque.
  const publicBase = await publicBaseFor(brand, req);
  const sender = await brandSender(brand);
  const to = testEmail || sender.testEmail;
  if (!to)
    return fail(
      "Aucune adresse de test : renseignez-la dans /reglages pour cette marque."
    );

  // Produit résolu depuis un segment DE CETTE MARQUE, comme à l'envoi réel.
  const segments = await resolveProspectSegments(db, id, brand.slug, [
    recipient.prospect_id,
  ]);

  const realEmail = recipient.to_email || recipient.prospect?.email;
  const { subject, html } = buildRecipientEmail({
    brand,
    campaign,
    recipient,
    prospect: recipient.prospect,
    segment: segments.get(recipient.prospect_id) ?? null,
    overrideData,
    unsubscribeUrl: realEmail ? unsubscribeUrl(realEmail, brand, publicBase) : null,
  });

  try {
    const data = await sendEmail({
      brand,
      sender,
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
