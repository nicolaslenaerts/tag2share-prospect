import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import {
  loadVariants,
  assignVariants,
  totalWeight,
  weightsAreValid,
  evenWeights,
  TOTAL_WEIGHT,
  type CampaignVariant,
} from "@/lib/campaign-variants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Variantes d'email d'une campagne (plusieurs textes, chacun avec sa part en %).
 *
 * Toute mutation se termine par une REDISTRIBUTION des destinataires encore en
 * jeu (assignVariants) : un poids modifié doit se refléter tout de suite dans
 * la liste, sinon les proportions affichées ne seraient pas celles qui partent.
 * Les destinataires déjà envoyés gardent leur variante (voir assignVariants).
 */

/** Garde-fou : la campagne doit exister DANS la marque de la session. */
async function requireCampaign(req: Request, campaignId: string) {
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data } = await db
    .from("campaigns")
    .select("id, subject, body_html, email_tagline, product")
    .eq("id", campaignId)
    .eq("brand", brand.slug)
    .maybeSingle();
  return { db, brand, campaign: data };
}

/** Répartition RÉELLE (ce qui est affecté) vs cible (les poids). */
async function distribution(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string
) {
  const { data } = await db
    .from("campaign_recipients")
    .select("variant_id, status")
    .eq("campaign_id", campaignId)
    .neq("status", "excluded"); // les retirés ne comptent dans aucune part
  const counts: Record<string, number> = {};
  let unassigned = 0;
  for (const r of data ?? []) {
    if (!r.variant_id) unassigned += 1;
    else counts[r.variant_id] = (counts[r.variant_id] ?? 0) + 1;
  }
  return { counts, unassigned, total: (data ?? []).length };
}

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { db, campaign } = await requireCampaign(req, id);
  if (!campaign) return fail("Campagne introuvable.", 404);
  const variants = await loadVariants(db, id);
  return ok({
    variants,
    total_weight: totalWeight(variants),
    valid: weightsAreValid(variants),
    distribution: await distribution(db, id),
  });
}

/**
 * Crée une variante. Sans `weight`, les parts sont RÉPARTIES ÉQUITABLEMENT
 * entre toutes les variantes (100 / n, reste aux premières) : on part ainsi
 * toujours d'un total valide, quitte à ce que l'opérateur ajuste ensuite les
 * chiffres - c'est exactement le geste attendu (« 35 / 35 / 30 »).
 * Sans `subject`/`body_html`, la nouvelle variante part d'une COPIE du texte
 * existant : on écrit une variante d'un email, rarement un email de zéro.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson<Partial<CampaignVariant> & { copy_from?: string }>(req);
  const { db, campaign } = await requireCampaign(req, id);
  if (!campaign) return fail("Campagne introuvable.", 404);

  const existing = await loadVariants(db, id);
  if (existing.length >= 10)
    return fail("10 variantes maximum par campagne.", 400);

  // Source du texte : variante explicitement copiée, sinon la première, sinon
  // le template de la campagne.
  const source =
    (body.copy_from && existing.find((v) => v.id === body.copy_from)) ||
    existing[0] ||
    campaign;

  const letter = String.fromCharCode(65 + existing.length); // A, B, C...
  const explicitWeight = Number.isFinite(Number(body.weight))
    ? Math.max(0, Math.min(TOTAL_WEIGHT, Number(body.weight)))
    : null;

  const { data: created, error } = await db
    .from("campaign_variants")
    .insert({
      campaign_id: id,
      name: body.name?.trim() || `Variante ${letter}`,
      subject: body.subject ?? source.subject ?? "",
      body_html: body.body_html ?? source.body_html ?? "",
      email_tagline: body.email_tagline ?? source.email_tagline ?? null,
      product: body.product ?? source.product ?? null,
      weight: explicitWeight ?? 0,
      sort_order: existing.length,
    })
    .select("*")
    .single();
  if (error) return fail(error.message, 500);

  let variants = [...existing, created as CampaignVariant];
  if (explicitWeight === null) {
    // Répartition équitable sur l'ensemble (y compris la nouvelle).
    const weights = evenWeights(variants.length);
    for (let i = 0; i < variants.length; i++) {
      if (variants[i].weight === weights[i]) continue;
      const { error: wErr } = await db
        .from("campaign_variants")
        .update({ weight: weights[i] })
        .eq("id", variants[i].id);
      if (wErr) return fail(wErr.message, 500);
      variants[i] = { ...variants[i], weight: weights[i] };
    }
  }

  await syncCampaignTemplate(db, id, variants);
  try {
    await assignVariants(db, id, variants);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
  return ok(
    {
      variant: created,
      variants,
      total_weight: totalWeight(variants),
      valid: weightsAreValid(variants),
      distribution: await distribution(db, id),
    },
    201
  );
}

/**
 * Enregistre les variantes en bloc (textes + poids), comme le bouton
 * « Enregistrer » de l'éditeur. Un total ≠ 100 est ACCEPTÉ en base (état
 * transitoire d'édition) mais renvoyé dans `valid: false` ; c'est l'envoi qui
 * refuse de partir sur une répartition fausse.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { variants: input } = await readJson<{
    variants: (Partial<CampaignVariant> & { id: string })[];
  }>(req);
  if (!Array.isArray(input) || input.length === 0)
    return fail("variants requis.");

  const { db, campaign } = await requireCampaign(req, id);
  if (!campaign) return fail("Campagne introuvable.", 404);

  const existing = await loadVariants(db, id);
  const known = new Set(existing.map((v) => v.id));
  for (const v of input)
    if (!known.has(v.id))
      return fail("Variante hors de cette campagne.", 400);

  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    const fields: Record<string, unknown> = { sort_order: i };
    if (v.name !== undefined) fields.name = v.name?.trim() || "Variante";
    if (v.subject !== undefined) fields.subject = v.subject ?? "";
    if (v.body_html !== undefined) fields.body_html = v.body_html ?? "";
    if (v.email_tagline !== undefined) fields.email_tagline = v.email_tagline;
    if (v.product !== undefined) fields.product = v.product || null;
    if (v.weight !== undefined)
      fields.weight = Math.max(
        0,
        Math.min(TOTAL_WEIGHT, Math.round(Number(v.weight) || 0))
      );
    const { error } = await db
      .from("campaign_variants")
      .update(fields)
      .eq("id", v.id)
      .eq("campaign_id", id);
    if (error) return fail(error.message, 500);
  }

  const variants = await loadVariants(db, id);
  await syncCampaignTemplate(db, id, variants);
  try {
    await assignVariants(db, id, variants);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
  return ok({
    variants,
    total_weight: totalWeight(variants),
    valid: weightsAreValid(variants),
    distribution: await distribution(db, id),
  });
}

/**
 * Supprime une variante. Les destinataires qui la portaient repassent à null
 * (FK « on delete set null ») puis sont redistribués. Le journal d'envois
 * conserve le nom de la variante (email_log.variant_name) : l'historique d'un
 * A/B survit à la suppression du texte perdant.
 * La dernière variante ne peut pas être supprimée si elle est la seule à
 * porter le texte de la campagne : on retomberait sur un template vide.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { variantId } = await readJson<{ variantId: string }>(req);
  if (!variantId) return fail("variantId requis.");

  const { db, campaign } = await requireCampaign(req, id);
  if (!campaign) return fail("Campagne introuvable.", 404);

  const existing = await loadVariants(db, id);
  const target = existing.find((v) => v.id === variantId);
  if (!target) return fail("Variante introuvable.", 404);
  if (existing.length <= 1)
    return fail(
      "Une campagne doit garder au moins une variante d'email.",
      400
    );

  const { error } = await db
    .from("campaign_variants")
    .delete()
    .eq("id", variantId)
    .eq("campaign_id", id);
  if (error) return fail(error.message, 500);

  // Les poids restants ne font plus 100 : on redonne la part libérée à
  // proportion de ce que chacun pesait déjà, pour rester envoyable.
  const rest = await loadVariants(db, id);
  const sum = totalWeight(rest);
  if (sum !== TOTAL_WEIGHT && rest.length > 0) {
    const weights =
      sum > 0
        ? largestRemainder(rest.map((v) => v.weight), sum)
        : evenWeights(rest.length);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].weight === weights[i]) continue;
      const { error: wErr } = await db
        .from("campaign_variants")
        .update({ weight: weights[i], sort_order: i })
        .eq("id", rest[i].id);
      if (wErr) return fail(wErr.message, 500);
      rest[i] = { ...rest[i], weight: weights[i] };
    }
  }

  await syncCampaignTemplate(db, id, rest);
  try {
    await assignVariants(db, id, rest);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
  return ok({
    deleted: variantId,
    variants: rest,
    total_weight: totalWeight(rest),
    valid: weightsAreValid(rest),
    distribution: await distribution(db, id),
  });
}

/**
 * Remet des parts à l'échelle de 100 en conservant leurs proportions
 * (plus fort reste pour l'arrondi). Sert quand une variante disparaît.
 */
function largestRemainder(weights: number[], sum: number): number[] {
  const exact = weights.map((w) => (w * TOTAL_WEIGHT) / sum);
  const floors = exact.map((e) => Math.floor(e));
  let left = TOTAL_WEIGHT - floors.reduce((s, f) => s + f, 0);
  const order = [...exact.keys()].sort(
    (a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a]))
  );
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k]] += 1;
  return floors;
}

/**
 * Recopie la 1re variante dans campaigns.subject / body_html.
 *
 * La campagne reste la source de repli (campagne sans variante) et, surtout,
 * plusieurs lectures historiques passent encore par ces colonnes. On garde
 * donc ce miroir plutôt que de laisser un texte périmé y traîner. La synchro
 * des destinataires, elle, lit désormais TOUTES les variantes (route sync).
 */
async function syncCampaignTemplate(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string,
  variants: CampaignVariant[]
) {
  const first = variants[0];
  if (!first) return;
  const { error } = await db
    .from("campaigns")
    .update({
      subject: first.subject,
      body_html: first.body_html,
      email_tagline: first.email_tagline,
    })
    .eq("id", campaignId);
  if (error) console.error("miroir campaigns.subject/body_html:", error.message);
}
