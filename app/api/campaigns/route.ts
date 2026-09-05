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

  const campaigns = await attachSegments(db, data ?? []);
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

  const { error: linkErr } = await db
    .from("campaign_segments")
    .upsert(
      segmentIds.map((segment_id) => ({ campaign_id: campaign.id, segment_id })),
      { onConflict: "campaign_id,segment_id", ignoreDuplicates: true }
    );
  if (linkErr) return fail(linkErr.message, 500);

  const [withSeg] = await attachSegments(db, [campaign]);
  return ok({ campaign: withSeg }, 201);
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
