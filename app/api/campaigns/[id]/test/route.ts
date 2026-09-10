import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { buildRecipientEmail, type MergeData } from "@/lib/email";
import { sendEmail } from "@/lib/resend";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { publicBaseFor } from "@/lib/public-url";
import { activeBrand } from "@/lib/brand-context";
import { resolveBrandStrict } from "@/lib/brands/store";
import { brandSender } from "@/lib/brand-sender";
import { loadVariants } from "@/lib/campaign-variants";

export const runtime = "nodejs";

/**
 * Envoi d'un email de TEST au niveau campagne, SANS destinataire réel :
 * on fournit l'adresse de test + les données de fusion à simuler (name, city, ...)
 * et le produit à mettre en avant ({{product_*}}). N'envoie JAMAIS à un prospect.
 * L'email part sous l'identité de la marque de la campagne.
 *
 * `variantId` choisit la variante d'email à tester (à défaut : la première).
 * C'est ainsi qu'on relit chaque texte d'un A/B avant de lancer l'envoi.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { testEmail, data, product, variantId } = await readJson<{
    testEmail?: string;
    data?: Partial<MergeData>;
    product?: string;
    variantId?: string;
  }>(req);

  const requestBrand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("brand", requestBrand.slug)
    .single();
  if (!campaign) return fail("Campagne introuvable.", 404);

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
      "Adresse de test requise : renseignez-la dans /reglages pour cette marque."
    );

  // Variante demandée, sinon la première. Une campagne sans variante teste son
  // propre template.
  const variants = await loadVariants(db, id);
  const variant = variantId
    ? variants.find((v) => v.id === variantId) ?? null
    : variants[0] ?? null;

  const { subject, html } = buildRecipientEmail({
    brand,
    // Le produit choisi pour le test prime ; sinon on garde le produit cible de la campagne.
    campaign: { ...campaign, product: product || campaign.product },
    // Le produit du test prime aussi sur celui de la variante : c'est le
    // sélecteur que l'opérateur vient de manipuler.
    variant: variant && product ? { ...variant, product: null } : variant,
    recipient: {},
    prospect: data || {},
    segment: null,
    unsubscribeUrl: unsubscribeUrl(to, brand, publicBase),
  });

  try {
    const sent = await sendEmail({
      brand,
      sender,
      to,
      subject: `[TEST${variant ? " " + variant.name : ""}] ${subject}`,
      html,
    });
    return ok({ sent: true, to, resend: sent });
  } catch (e) {
    return fail(`Échec envoi test : ${(e as Error).message}`, 500);
  }
}
