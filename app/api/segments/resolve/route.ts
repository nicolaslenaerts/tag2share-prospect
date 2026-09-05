import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import { defaultProduct } from "@/lib/products";
import {
  labelKey,
  matchSegment,
  segmentLabelFromCategory,
} from "@/lib/segment-matching";

export const runtime = "nodejs";

export type SegmentResolution = {
  /** Valeur telle qu'écrite dans le fichier. */
  label: string;
  /** Clé de rapprochement (voir lib/segment-matching). */
  key: string;
  segmentId: string | null;
  segmentLabel: string | null;
  status: "existing" | "created" | "missing";
};

/**
 * Rapproche des libellés libres (colonne « catégorie » d'un import) des
 * segments de la marque active, et crée au besoin ceux qui manquent.
 *
 * Appelée UNE FOIS avant la boucle de lots de l'import : le client découpe les
 * gros fichiers, et une création faite lot par lot produirait autant de
 * segments jumeaux que de lots.
 *
 * `create: false` (défaut) sert à l'aperçu : rien n'est écrit, l'interface
 * montre ce qui serait rattaché et ce qui serait créé.
 */
export async function POST(req: Request) {
  const { labels, create = false, product } = await readJson<{
    labels: string[];
    create?: boolean;
    product?: string;
  }>(req);

  if (!Array.isArray(labels)) return fail("labels requis.");

  const brand = await activeBrand(req);
  const db = supabaseAdmin();

  const { data: existing, error } = await db
    .from("segments")
    .select("id, label")
    .eq("brand", brand.slug);
  if (error) return fail(error.message, 500);

  // Déduplication des libellés d'entrée : « Coiffeur » et « coiffeurs »
  // partagent une clé, et ne doivent donner qu'UN segment.
  const wanted = new Map<string, string>();
  for (const raw of labels) {
    const key = labelKey(raw);
    if (!key || wanted.has(key)) continue;
    wanted.set(key, segmentLabelFromCategory(raw));
  }

  const pool = [...(existing ?? [])];
  const resolutions: SegmentResolution[] = [];
  const toCreate: { key: string; label: string }[] = [];

  for (const [key, label] of wanted) {
    const match = matchSegment(label, pool);
    if (match) {
      resolutions.push({
        label,
        key,
        segmentId: match.id,
        segmentLabel: match.label,
        status: "existing",
      });
    } else if (create) {
      toCreate.push({ key, label });
    } else {
      resolutions.push({ label, key, segmentId: null, segmentLabel: null, status: "missing" });
    }
  }

  if (toCreate.length) {
    // Un segment créé à l'import est immédiatement utilisable (approved), mais
    // reste à compléter : l'email et le produit se règlent à l'étape 1.
    const rows = toCreate.map(({ label }) => ({
      brand: brand.slug,
      label,
      rationale: "Segment créé automatiquement depuis la colonne catégorie d'un import.",
      product: product ?? defaultProduct(brand)?.key ?? null,
      search_terms: [label],
      approved: true,
    }));
    const { data: inserted, error: insErr } = await db
      .from("segments")
      .insert(rows)
      .select("id, label");
    if (insErr) return fail(insErr.message, 500);

    // On rapproche par libellé plutôt que par position : rien ne garantit que
    // PostgREST renvoie les lignes insérées dans l'ordre envoyé.
    const byLabel = new Map((inserted ?? []).map((s) => [s.label, s]));
    for (const { key, label } of toCreate) {
      const seg = byLabel.get(label);
      if (!seg) continue;
      resolutions.push({
        label,
        key,
        segmentId: seg.id,
        segmentLabel: seg.label,
        status: "created",
      });
    }
  }

  return ok({ resolutions });
}
