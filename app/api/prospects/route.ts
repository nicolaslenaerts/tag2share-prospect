import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";
import { contactHistory } from "@/lib/email-log";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

// Liste des prospects (filtre optionnel par segment, via l'appartenance multi-segment).
//
// Le vivier est CLOISONNÉ par marque (migration 0015) : la liste ne montre que
// les prospects de la marque active, comme tout le reste - segments rattachés,
// exclusions, historique de contact.
//
// Chaque prospect est enrichi de :
//  - segments[] : ses segments DANS la marque active
//  - emailed / emailed_at / emailed_campaigns : déjà contacté par CETTE marque
//  - other_brands : autres marques l'ayant déjà contacté (information)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const segmentId = searchParams.get("segmentId");
  const brand = await activeBrand(req);
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

  let q = db
    .from("prospects")
    .select("*")
    .eq("brand", brand.slug)
    .order("created_at", { ascending: false });
  if (allowedIds) q = q.in("id", allowedIds);
  const { data: prospects, error } = await q;
  if (error) return fail(error.message, 500);

  const ids = (prospects ?? []).map((p) => p.id);
  if (ids.length === 0) return ok({ prospects: [] });

  // Appartenances (tous segments) pour chaque prospect.
  // On découpe en lots : un .in() avec des centaines d'ids produit une URL
  // trop longue (Bad Request) et ferait silencieusement perdre les segments.
  const segByProspect = new Map<string, any[]>();
  const CHUNK = 150;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: memberships, error: mErr } = await db
      .from("segment_prospects")
      .select("prospect_id, segment:segments(id, label, product, brand)")
      .in("prospect_id", slice);
    if (mErr) return fail(mErr.message, 500);
    for (const m of memberships ?? []) {
      if (!m.segment) continue;
      // Redondant depuis le cloisonnement du vivier (0015 supprime les
      // rattachements inter-marques), gardé comme filet : un lien créé avant
      // la migration ne doit pas ressurgir dans la vue d'une autre marque.
      if ((m.segment as any).brand !== brand.slug) continue;
      const arr = segByProspect.get(m.prospect_id) ?? [];
      arr.push(m.segment);
      segByProspect.set(m.prospect_id, arr);
    }
  }

  // Désinscriptions / bounces / plaintes (liste de suppression).
  const suppressed = await suppressionMap(
    (prospects ?? []).map((p) => p.email).filter(Boolean),
    brand.slug
  );

  // "Déjà contacté" : lu depuis le journal des emails envoyés (source de vérité,
  // matché par prospect_id OU email, toutes campagnes confondues).
  const history = await contactHistory(
    (prospects ?? []).map((p) => ({ id: p.id, email: p.email })),
    brand.slug
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
      other_brands: contact?.otherBrands ?? [],
      suppressed: !!reason,
      suppression_reason: reason,
    };
  });

  return ok({ prospects: enriched });
}

// Mise à jour manuelle d'un prospect (édition email/contact, rejet, etc.).
// `brand` n'est pas modifiable : déplacer un prospect d'une marque à l'autre
// emporterait ses rattachements de segments et son historique dans une marque
// où ils n'ont pas de sens. Pour le confier à une autre marque, on l'y
// redécouvre (la reprise d'enrichissement évite de repayer les appels API).
export async function PATCH(req: Request) {
  const { id, brand: _ignored, ...fields } = await readJson<any>(req);
  if (!id) return fail("id requis.");
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("prospects")
    .update(fields)
    .eq("id", id)
    .eq("brand", brand.slug)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ prospect: data });
}

export async function DELETE(req: Request) {
  const { id } = await readJson<{ id: string }>(req);
  if (!id) return fail("id requis.");
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { error } = await db
    .from("prospects")
    .delete()
    .eq("id", id)
    .eq("brand", brand.slug);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
