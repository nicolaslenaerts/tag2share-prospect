import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Détail d'une campagne + destinataires (avec le prospect joint)
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: campaign, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return fail(error.message, 404);

  // Segments ciblés (multi-segment).
  const { data: links } = await db
    .from("campaign_segments")
    .select("segment:segments(id, label, product)")
    .eq("campaign_id", id);
  (campaign as any).segments = (links ?? [])
    .map((l) => l.segment)
    .filter(Boolean);

  const { data: recipients, error: rErr } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*, segment:segments!prospects_segment_id_fkey(*))")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  if (rErr) return fail(rErr.message, 500);

  // Marque les destinataires désinscrits / bouncés / plaints.
  const suppressed = await suppressionMap(
    (recipients ?? []).map((r) => r.to_email || r.prospect?.email).filter(Boolean)
  );
  const recipientsMarked = (recipients ?? []).map((r) => {
    const email = r.to_email || r.prospect?.email;
    const reason = email ? suppressed.get(normEmail(email)) ?? null : null;
    return { ...r, suppressed: !!reason, suppression_reason: reason };
  });

  return ok({ campaign, recipients: recipientsMarked });
}

// Mise à jour du template (sujet/corps/nom/statut)
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const fields = await readJson<any>(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("campaigns")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ campaign: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { error } = await db.from("campaigns").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
