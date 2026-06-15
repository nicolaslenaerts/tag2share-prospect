import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

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

  return ok({ campaign, recipients });
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
