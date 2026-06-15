import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

// Liste des segments validés, avec le nombre total de prospects rattachés (prospect_count)
export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("segments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);

  // Comptage des rattachements (table de liaison) regroupé par segment.
  const { data: links } = await db.from("segment_prospects").select("segment_id");
  const counts = new Map<string, number>();
  for (const l of links ?? []) {
    counts.set(l.segment_id, (counts.get(l.segment_id) ?? 0) + 1);
  }
  const segments = (data ?? []).map((s) => ({
    ...s,
    prospect_count: counts.get(s.id) ?? 0,
  }));

  return ok({ segments });
}

// Enregistre les segments validés par l'utilisateur (étape 1 confirmée)
export async function POST(req: Request) {
  const { segments } = await readJson<{ segments: any[] }>(req);
  if (!Array.isArray(segments) || segments.length === 0)
    return fail("Aucun segment fourni.");

  const db = supabaseAdmin();
  const rows = segments.map((s) => ({
    label: s.label,
    rationale: s.rationale ?? null,
    product: s.product ?? null,
    search_terms: s.search_terms ?? [],
    email_subject: s.email_subject ?? null,
    email_body: s.email_body ?? null,
    approved: true,
  }));
  const { data, error } = await db.from("segments").insert(rows).select();
  if (error) return fail(error.message, 500);
  return ok({ segments: data }, 201);
}

// Mise à jour d'un segment (produit mis en avant, email rédigé...)
export async function PATCH(req: Request) {
  const { id, ...fields } = await readJson<any>(req);
  if (!id) return fail("id requis.");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("segments")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ segment: data });
}

// Suppression d'un segment
export async function DELETE(req: Request) {
  const { id } = await readJson<{ id: string }>(req);
  if (!id) return fail("id requis.");
  const db = supabaseAdmin();
  const { error } = await db.from("segments").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
