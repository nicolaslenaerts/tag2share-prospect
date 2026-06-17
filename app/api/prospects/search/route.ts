import { searchPlaces, COUNTRY_CODES } from "@/lib/places";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Journal des recherches (toutes, ou filtrées par segment via ?segmentId=). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const segmentId = searchParams.get("segmentId");
  const db = supabaseAdmin();
  let q = db
    .from("searches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (segmentId) q = q.eq("segment_id", segmentId);
  const { data, error } = await q;
  if (error) return fail(error.message, 500);
  return ok({ searches: data });
}

/**
 * Étape 2 - recherche Google Places pour un segment + zone, puis upsert des prospects.
 */
export async function POST(req: Request) {
  const { segmentId, country, city, maxResults } = await readJson<{
    segmentId: string;
    country?: string;
    city?: string;
    maxResults?: number;
  }>(req);

  if (!segmentId) return fail("segmentId requis.");
  const db = supabaseAdmin();

  const { data: segment, error: segErr } = await db
    .from("segments")
    .select("*")
    .eq("id", segmentId)
    .single();
  if (segErr || !segment) return fail("Segment introuvable.", 404);

  const regionCode = country ? COUNTRY_CODES[country] : undefined;
  const cap = Math.min(Math.max(maxResults || 20, 1), 60); // plafond total par segment
  const terms: string[] =
    segment.search_terms?.length ? segment.search_terms : [segment.label];

  // dédoublonnage par place_id, en s'arrêtant dès que le plafond du segment est atteint
  const byId = new Map<string, any>();
  try {
    for (const term of terms) {
      if (byId.size >= cap) break;
      const q = [term, city, country].filter(Boolean).join(" ");
      const places = await searchPlaces(q, regionCode, cap);
      for (const p of places) {
        if (!byId.has(p.id)) byId.set(p.id, p);
        if (byId.size >= cap) break;
      }
    }
  } catch (e) {
    return fail(`Erreur Places : ${(e as Error).message}`, 500);
  }

  // NB : on n'inclut PAS segment_id dans l'upsert pour ne pas écraser le segment
  // d'origine d'un business déjà capté ailleurs. L'origine est posée plus bas
  // uniquement pour les nouveaux prospects ; l'appartenance vit dans segment_prospects.
  const rows = [...byId.values()].map((p) => ({
    place_id: p.id,
    name: p.name,
    category: p.category ?? segment.label,
    address: p.address,
    city: p.city ?? city ?? null,
    country: p.country ?? country ?? null,
    phone: p.phone,
    website: p.website,
    rating: p.rating,
    reviews_count: p.reviewsCount,
    raw_place: p.raw,
    status: "found",
  }));

  const { data, error } = await db
    .from("prospects")
    .upsert(rows, { onConflict: "place_id", ignoreDuplicates: false })
    .select("id, segment_id");
  if (error) return fail(error.message, 500);

  const ids = (data ?? []).map((p) => p.id);

  // Segment d'origine : posé seulement si le prospect n'en a pas encore.
  const orphanIds = (data ?? []).filter((p) => !p.segment_id).map((p) => p.id);
  if (orphanIds.length) {
    await db.from("prospects").update({ segment_id: segmentId }).in("id", orphanIds);
  }

  // Appartenance multi-segment (idempotent grâce à la clé primaire composée).
  const { data: existingLinks } = await db
    .from("segment_prospects")
    .select("prospect_id")
    .eq("segment_id", segmentId)
    .in("prospect_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const alreadyLinked = new Set((existingLinks ?? []).map((l) => l.prospect_id));
  const newForSegment = ids.filter((id) => !alreadyLinked.has(id));

  if (ids.length) {
    await db
      .from("segment_prospects")
      .upsert(
        ids.map((prospect_id) => ({ segment_id: segmentId, prospect_id })),
        { onConflict: "segment_id,prospect_id", ignoreDuplicates: true }
      );
  }

  const zone = [city, country].filter(Boolean).join(", ") || "toutes zones";

  // Journal de la recherche.
  await db.from("searches").insert({
    segment_id: segmentId,
    country: country ?? null,
    city: city ?? null,
    zone,
    max_results: cap,
    found_count: ids.length,
    new_count: newForSegment.length,
  });

  // On ne renvoie comme "à enrichir" que les prospects nouveaux pour ce segment :
  // inutile de relancer l'enrichissement sur des contacts déjà captés.
  const newSet = new Set(newForSegment);

  return ok({
    count: ids.length,
    newCount: newForSegment.length,
    zone,
    prospects: data,
    newProspects: (data ?? []).filter((p) => newSet.has(p.id)),
  });
}
