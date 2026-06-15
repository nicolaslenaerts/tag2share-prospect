import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";

export const runtime = "nodejs";

// Liste des prospects (filtre optionnel par segment, via l'appartenance multi-segment).
// Chaque prospect est enrichi de :
//  - segments[] : tous les segments auxquels il est rattaché
//  - emailed / emailed_at / emailed_campaigns : un mail lui a-t-il déjà été envoyé (toutes campagnes)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const segmentId = searchParams.get("segmentId");
  const db = supabaseAdmin();

  // Restriction optionnelle aux membres d'un segment.
  let allowedIds: string[] | null = null;
  if (segmentId) {
    const { data: links, error: lErr } = await db
      .from("segment_prospects")
      .select("prospect_id")
      .eq("segment_id", segmentId);
    if (lErr) return fail(lErr.message, 500);
    allowedIds = (links ?? []).map((l) => l.prospect_id);
    if (allowedIds.length === 0) return ok({ prospects: [] });
  }

  let q = db.from("prospects").select("*").order("created_at", { ascending: false });
  if (allowedIds) q = q.in("id", allowedIds);
  const { data: prospects, error } = await q;
  if (error) return fail(error.message, 500);

  const ids = (prospects ?? []).map((p) => p.id);
  if (ids.length === 0) return ok({ prospects: [] });

  // Appartenances (tous segments) pour chaque prospect.
  const { data: memberships } = await db
    .from("segment_prospects")
    .select("prospect_id, segment:segments(id, label, product)")
    .in("prospect_id", ids);
  const segByProspect = new Map<string, any[]>();
  for (const m of memberships ?? []) {
    if (!m.segment) continue;
    const arr = segByProspect.get(m.prospect_id) ?? [];
    arr.push(m.segment);
    segByProspect.set(m.prospect_id, arr);
  }

  // Envois déjà effectués (status sent), toutes campagnes confondues.
  const { data: sent } = await db
    .from("campaign_recipients")
    .select("prospect_id, sent_at, campaign:campaigns(name)")
    .eq("status", "sent")
    .in("prospect_id", ids);
  const sentByProspect = new Map<string, { sent_at?: string; campaigns: string[] }>();
  for (const s of sent ?? []) {
    const cur = sentByProspect.get(s.prospect_id) ?? { campaigns: [] };
    if (s.sent_at && (!cur.sent_at || s.sent_at < cur.sent_at)) cur.sent_at = s.sent_at;
    const cname = (s.campaign as any)?.name;
    if (cname && !cur.campaigns.includes(cname)) cur.campaigns.push(cname);
    sentByProspect.set(s.prospect_id, cur);
  }

  // Désinscriptions / bounces / plaintes (liste de suppression).
  const suppressed = await suppressionMap(
    (prospects ?? []).map((p) => p.email).filter(Boolean)
  );

  const enriched = (prospects ?? []).map((p) => {
    const sentInfo = sentByProspect.get(p.id);
    const reason = p.email ? suppressed.get(normEmail(p.email)) ?? null : null;
    return {
      ...p,
      segments: segByProspect.get(p.id) ?? [],
      emailed: !!sentInfo,
      emailed_at: sentInfo?.sent_at ?? null,
      emailed_campaigns: sentInfo?.campaigns ?? [],
      suppressed: !!reason,
      suppression_reason: reason,
    };
  });

  return ok({ prospects: enriched });
}

// Mise à jour manuelle d'un prospect (édition email/contact, rejet, etc.)
export async function PATCH(req: Request) {
  const { id, ...fields } = await readJson<any>(req);
  if (!id) return fail("id requis.");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("prospects")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ prospect: data });
}

export async function DELETE(req: Request) {
  const { id } = await readJson<{ id: string }>(req);
  if (!id) return fail("id requis.");
  const db = supabaseAdmin();
  const { error } = await db.from("prospects").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
