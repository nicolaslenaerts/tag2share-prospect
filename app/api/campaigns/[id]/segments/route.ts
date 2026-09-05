import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Ajoute un segment à la campagne.
export async function POST(req: Request, { params }: Ctx) {
  const { id: campaignId } = await params;
  const { segmentId } = await readJson<{ segmentId: string }>(req);
  if (!segmentId) return fail("segmentId requis.");
  const brand = activeBrand(req);
  const db = supabaseAdmin();

  // La campagne ET le segment doivent appartenir à la marque active : sinon
  // l'email serait rédigé avec le catalogue d'une marque et envoyé sous
  // l'identité d'une autre.
  const { data: campaign } = await db
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("brand", brand.slug)
    .maybeSingle();
  if (!campaign) return fail("Campagne introuvable pour cette marque.", 404);
  const { data: segment } = await db
    .from("segments")
    .select("id")
    .eq("id", segmentId)
    .eq("brand", brand.slug)
    .maybeSingle();
  if (!segment) return fail(`Segment hors de la marque « ${brand.name} ».`, 400);

  const { error } = await db
    .from("campaign_segments")
    .upsert(
      { campaign_id: campaignId, segment_id: segmentId },
      { onConflict: "campaign_id,segment_id", ignoreDuplicates: true }
    );
  if (error) return fail(error.message, 500);
  return ok({ added: segmentId }, 201);
}

// Retire un segment de la campagne.
export async function DELETE(req: Request, { params }: Ctx) {
  const { id: campaignId } = await params;
  const { segmentId } = await readJson<{ segmentId: string }>(req);
  if (!segmentId) return fail("segmentId requis.");
  const brand = activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign } = await db
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("brand", brand.slug)
    .maybeSingle();
  if (!campaign) return fail("Campagne introuvable pour cette marque.", 404);
  const { error } = await db
    .from("campaign_segments")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("segment_id", segmentId);
  if (error) return fail(error.message, 500);
  return ok({ removed: segmentId });
}
