import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

// Liste des segments de la marque active, avec le nombre total de prospects
// rattachés (prospect_count).
export async function GET(req: Request) {
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  // Le comptage se fait côté base (agrégat embarqué) : lire la table de
  // liaison puis compter en JS plafonne à 1000 lignes (max-rows PostgREST),
  // et les segments au-delà tombaient silencieusement à 0.
  const { data, error } = await db
    .from("segments")
    .select("*, segment_prospects(count)")
    .eq("brand", brand.slug)
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);

  const segments = (data ?? []).map(({ segment_prospects, ...s }) => ({
    ...s,
    prospect_count: segment_prospects?.[0]?.count ?? 0,
  }));

  return ok({ segments });
}

// Enregistre les segments validés par l'utilisateur (étape 1 confirmée)
export async function POST(req: Request) {
  const { segments } = await readJson<{ segments: any[] }>(req);
  if (!Array.isArray(segments) || segments.length === 0)
    return fail("Aucun segment fourni.");

  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const rows = segments.map((s) => ({
    brand: brand.slug,
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
  // `brand` n'est pas modifiable : le produit du segment appartient au
  // catalogue de sa marque, le déplacer rendrait la valeur orpheline.
  const { id, brand: _ignored, ...fields } = await readJson<any>(req);
  if (!id) return fail("id requis.");
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("segments")
    .update(fields)
    .eq("id", id)
    .eq("brand", brand.slug)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ segment: data });
}

// Suppression d'un segment
export async function DELETE(req: Request) {
  const { id } = await readJson<{ id: string }>(req);
  if (!id) return fail("id requis.");
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { error } = await db
    .from("segments")
    .delete()
    .eq("id", id)
    .eq("brand", brand.slug);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
