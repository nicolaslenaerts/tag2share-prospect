import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Ajoute un segment à la campagne.
export async function POST(req: Request, { params }: Ctx) {
  const { id: campaignId } = await params;
  const { segmentId } = await readJson<{ segmentId: string }>(req);
  if (!segmentId) return fail("segmentId requis.");
  const db = supabaseAdmin();
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
  const db = supabaseAdmin();
  const { error } = await db
    .from("campaign_segments")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("segment_id", segmentId);
  if (error) return fail(error.message, 500);
  return ok({ removed: segmentId });
}
