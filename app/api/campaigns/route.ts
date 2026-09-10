import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("brand", brand.slug)
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);

  const campaigns = await attachVariants(db, await attachSegments(db, data ?? []));
  return ok({ campaigns });
}

export async function POST(req: Request) {
  const body = await readJson<{
    name: string;
    subject?: string;
    body_html?: string;
    segment_ids?: string[];
    segment_id?: string; // compat
  }>(req);
  const name = body.name;
  // Accepte un tableau (multi-segment) ou un id unique (compat).
  const segmentIds = (body.segment_ids ?? (body.segment_id ? [body.segment_id] : []))
    .filter(Boolean);
  if (!name) return fail("name requis.");
  if (segmentIds.length === 0)
    return fail("Au moins un segment requis (segment_ids).");
  const brand = await activeBrand(req);
  const db = supabaseAdmin();

  // Un segment d'une autre marque ne peut pas être ciblé : l'email serait
  // rédigé avec le catalogue d'une marque et envoyé sous l'identité d'une autre.
  const { data: segs, error: segErr } = await db
    .from("segments")
    .select("id")
    .eq("brand", brand.slug)
    .in("id", segmentIds);
  if (segErr) return fail(segErr.message, 500);
  if ((segs ?? []).length !== segmentIds.length)
    return fail(`Segment(s) hors de la marque « ${brand.name} ».`, 400);

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      brand: brand.slug,
      segment_id: segmentIds[0], // 1er segment, pour compat
      name,
      subject: body.subject || brand.defaults.subject,
      body_html: body.body_html || brand.defaults.body,
      email_tagline: brand.defaults.tagline,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) return fail(error.message, 500);

  // Première variante d'email, à 100 %. Une campagne a normalement TOUJOURS au
  // moins une variante : l'éditeur, la répartition et l'envoi travaillent
  // dessus, le template de campagne ne restant qu'un miroir de repli.
  //
  // Non bloquant : tant que la migration 0016 n'est pas appliquée, la table
  // n'existe pas et la campagne doit rester créable - l'éditeur retombe alors
  // sur le template unique (voir isLegacyTemplate côté interface).
  const { error: varErr } = await db.from("campaign_variants").insert({
    campaign_id: campaign.id,
    name: "Variante A",
    subject: campaign.subject,
    body_html: campaign.body_html,
    email_tagline: campaign.email_tagline,
    weight: 100,
    sort_order: 0,
  });
  if (varErr)
    console.error("création de la variante initiale:", varErr.message);

  const { error: linkErr } = await db
    .from("campaign_segments")
    .upsert(
      segmentIds.map((segment_id) => ({ campaign_id: campaign.id, segment_id })),
      { onConflict: "campaign_id,segment_id", ignoreDuplicates: true }
    );
  if (linkErr) return fail(linkErr.message, 500);

  const [withSeg] = await attachVariants(db, await attachSegments(db, [campaign]));
  return ok({ campaign: withSeg }, 201);
}

/**
 * Attache à chaque campagne ses variantes d'email + la validité de leur
 * répartition, pour que la liste signale d'un coup d'oeil une campagne dont les
 * parts ne font pas 100 % (envoi bloqué) sans avoir à l'ouvrir.
 */
async function attachVariants(
  db: ReturnType<typeof supabaseAdmin>,
  campaigns: any[]
) {
  if (campaigns.length === 0) return campaigns;
  const ids = campaigns.map((c) => c.id);
  const { data: rows } = await db
    .from("campaign_variants")
    .select("id, campaign_id, name, weight, sort_order")
    .in("campaign_id", ids)
    .order("sort_order", { ascending: true });
  const byCampaign = new Map<string, any[]>();
  for (const v of rows ?? []) {
    const arr = byCampaign.get(v.campaign_id) ?? [];
    arr.push(v);
    byCampaign.set(v.campaign_id, arr);
  }
  return campaigns.map((c) => {
    const variants = byCampaign.get(c.id) ?? [];
    const total = variants.reduce((n, v) => n + (v.weight || 0), 0);
    return {
      ...c,
      variants,
      variants_total_weight: total,
      variants_valid: variants.length === 0 || total === 100,
    };
  });
}

/** Attache à chaque campagne son tableau `segments` (via campaign_segments). */
async function attachSegments(db: ReturnType<typeof supabaseAdmin>, campaigns: any[]) {
  if (campaigns.length === 0) return campaigns;
  const ids = campaigns.map((c) => c.id);
  const { data: links } = await db
    .from("campaign_segments")
    .select("campaign_id, segment:segments(id, label, product)")
    .in("campaign_id", ids);
  const byCampaign = new Map<string, any[]>();
  for (const l of links ?? []) {
    if (!l.segment) continue;
    const arr = byCampaign.get(l.campaign_id) ?? [];
    arr.push(l.segment);
    byCampaign.set(l.campaign_id, arr);
  }
  return campaigns.map((c) => ({ ...c, segments: byCampaign.get(c.id) ?? [] }));
}
