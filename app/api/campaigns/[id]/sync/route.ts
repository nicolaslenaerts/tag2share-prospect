import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";
import { requiredProspectFields } from "@/lib/email";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Synchronise les destinataires : ajoute (en brouillon) les prospects des segments
// ciblés qui sont éligibles — email présent, non supprimé, tous les champs requis du
// template — et pas déjà destinataires (quel que soit leur statut, y compris exclus).
// Idempotent : peut être appelé à chaque ouverture de campagne.
export async function POST(_req: Request, { params }: Ctx) {
  const { id: campaignId } = await params;
  const db = supabaseAdmin();

  const { data: campaign, error: cErr } = await db
    .from("campaigns")
    .select("id, subject, body_html")
    .eq("id", campaignId)
    .single();
  if (cErr || !campaign) return fail("Campagne introuvable.", 404);

  // Segments ciblés.
  const { data: segLinks } = await db
    .from("campaign_segments")
    .select("segment_id")
    .eq("campaign_id", campaignId);
  const segmentIds = (segLinks ?? []).map((l) => l.segment_id);
  if (segmentIds.length === 0) return ok({ added: 0 });

  // Prospects rattachés à au moins un de ces segments.
  const { data: memberships } = await db
    .from("segment_prospects")
    .select("prospect_id")
    .in("segment_id", segmentIds);
  const prospectIds = [...new Set((memberships ?? []).map((m) => m.prospect_id))];
  if (prospectIds.length === 0) return ok({ added: 0 });

  // Déjà destinataires (tous statuts, y compris « excluded ») → jamais ré-ajoutés.
  const { data: existing } = await db
    .from("campaign_recipients")
    .select("prospect_id")
    .eq("campaign_id", campaignId);
  const already = new Set((existing ?? []).map((r) => r.prospect_id));

  const candidateIds = prospectIds.filter((pid) => !already.has(pid));
  if (candidateIds.length === 0) return ok({ added: 0 });

  const { data: prospects, error: pErr } = await db
    .from("prospects")
    .select("*")
    .in("id", candidateIds);
  if (pErr) return fail(pErr.message, 500);

  const suppressed = await suppressionMap(
    (prospects ?? []).map((p) => p.email).filter(Boolean)
  );

  // Mêmes critères d'éligibilité que la liste « Ajouter des destinataires » côté UI.
  const reqFields = requiredProspectFields(campaign.subject, campaign.body_html);
  const eligible = (prospects ?? []).filter((p) => {
    if (!p.email || !String(p.email).trim()) return false;
    if (suppressed.get(normEmail(p.email))) return false;
    return reqFields.every((f) => {
      const v = (p as any)[f];
      return v != null && String(v).trim() !== "";
    });
  });
  if (eligible.length === 0) return ok({ added: 0 });

  const rows = eligible.map((p) => ({
    campaign_id: campaignId,
    prospect_id: p.id,
    to_email: p.email,
    status: "draft",
  }));
  const { data, error: insErr } = await db
    .from("campaign_recipients")
    .upsert(rows, { onConflict: "campaign_id,prospect_id", ignoreDuplicates: true })
    .select();
  if (insErr) return fail(insErr.message, 500);
  return ok({ added: data?.length ?? 0 });
}
