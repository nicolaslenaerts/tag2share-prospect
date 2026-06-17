import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";
import { contactHistory } from "@/lib/email-log";

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

  // Désinscriptions / bounces / plaintes (liste de suppression).
  const suppressed = await suppressionMap(
    (prospects ?? []).map((p) => p.email).filter(Boolean)
  );

  // "Déjà contacté" : lu depuis le journal des emails envoyés (source de vérité,
  // matché par prospect_id OU email, toutes campagnes confondues).
  const history = await contactHistory(
    (prospects ?? []).map((p) => ({ id: p.id, email: p.email }))
  );

  const enriched = (prospects ?? []).map((p) => {
    const contact = history.get(p.id);
    const reason = p.email ? suppressed.get(normEmail(p.email)) ?? null : null;
    return {
      ...p,
      segments: segByProspect.get(p.id) ?? [],
      emailed: contact?.emailed ?? false,
      emailed_at: contact?.emailedAt ?? null,
      emailed_campaigns: contact?.campaigns ?? [],
      emailed_products: contact?.products ?? [],
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
