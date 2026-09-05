/**
 * Résolution du segment porteur du produit, par prospect.
 *
 * Le vivier de prospects est PARTAGÉ entre les marques (pas de colonne `brand`
 * sur `prospects`), donc `prospects.segment_id` - le segment d'ORIGINE, premier
 * segment où le business a été capté - peut pointer vers un segment d'une AUTRE
 * marque. S'y fier pour résoudre {{product_*}} afficherait le produit d'une
 * marque dans l'email d'une autre.
 *
 * On passe donc toujours par les segments DE LA CAMPAGNE, filtrés sur sa marque.
 */
import type { supabaseAdmin } from "./supabase";

export type ResolvedSegment = { id: string; product: string | null };

export async function resolveProspectSegments(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string,
  brandSlug: string,
  prospectIds: string[]
): Promise<Map<string, ResolvedSegment>> {
  const map = new Map<string, ResolvedSegment>();
  const ids = prospectIds.filter(Boolean);
  if (ids.length === 0) return map;

  const { data: links } = await db
    .from("campaign_segments")
    .select("segment:segments(id, product, brand)")
    .eq("campaign_id", campaignId);
  const segments = (links ?? [])
    .map((l: any) => l.segment)
    .filter((s: any) => s && s.brand === brandSlug);
  if (segments.length === 0) return map;

  const byId = new Map<string, ResolvedSegment>(
    segments.map((s: any) => [s.id as string, { id: s.id, product: s.product ?? null }])
  );
  const { data: memberships } = await db
    .from("segment_prospects")
    .select("prospect_id, segment_id")
    .in("segment_id", [...byId.keys()])
    .in("prospect_id", ids);
  // Premier segment rencontré : un prospect peut appartenir à plusieurs
  // segments de la campagne, un seul produit peut être mis en avant.
  for (const m of memberships ?? []) {
    if (map.has(m.prospect_id)) continue;
    const seg = byId.get(m.segment_id);
    if (seg) map.set(m.prospect_id, seg);
  }
  return map;
}
