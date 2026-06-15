import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { DEFAULT_SUBJECT, DEFAULT_BODY, DEFAULT_TAGLINE } from "@/lib/email";

export const runtime = "nodejs";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
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
  const db = supabaseAdmin();

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      segment_id: segmentIds[0], // 1er segment, pour compat
      name,
      subject: body.subject || DEFAULT_SUBJECT,
      body_html: body.body_html || DEFAULT_BODY,
      email_tagline: DEFAULT_TAGLINE,
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
