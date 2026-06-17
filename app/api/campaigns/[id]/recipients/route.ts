import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Ajoute des prospects à la campagne (étape 4 - sélection des cibles)
export async function POST(req: Request, { params }: Ctx) {
  const { id: campaignId } = await params;
  const { prospectIds } = await readJson<{ prospectIds: string[] }>(req);
  if (!Array.isArray(prospectIds) || prospectIds.length === 0)
    return fail("prospectIds requis.");

  const db = supabaseAdmin();
  const { data: prospects, error } = await db
    .from("prospects")
    .select("id, email")
    .in("id", prospectIds);
  if (error) return fail(error.message, 500);

  const rows = (prospects || []).map((p) => ({
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
  return ok({ recipients: data }, 201);
}

// Met à jour un destinataire (contenu adapté, email, statut approuvé...).
// `recipientIds` (tableau) = mise à jour groupée, ex. tout approuver en une fois.
export async function PATCH(req: Request) {
  const { recipientId, recipientIds, ...fields } = await readJson<any>(req);
  const db = supabaseAdmin();

  if (Array.isArray(recipientIds)) {
    if (recipientIds.length === 0) return fail("recipientIds vide.");
    const { data, error } = await db
      .from("campaign_recipients")
      .update(fields)
      .in("id", recipientIds)
      .select("*, prospect:prospects(*)");
    if (error) return fail(error.message, 500);
    return ok({ recipients: data });
  }

  if (!recipientId) return fail("recipientId requis.");
  const { data, error } = await db
    .from("campaign_recipients")
    .update(fields)
    .eq("id", recipientId)
    .select("*, prospect:prospects(*)")
    .single();
  if (error) return fail(error.message, 500);
  return ok({ recipient: data });
}

export async function DELETE(req: Request) {
  const { recipientId } = await readJson<{ recipientId: string }>(req);
  if (!recipientId) return fail("recipientId requis.");
  const db = supabaseAdmin();
  const { error } = await db
    .from("campaign_recipients")
    .delete()
    .eq("id", recipientId);
  if (error) return fail(error.message, 500);
  return ok({ deleted: recipientId });
}
