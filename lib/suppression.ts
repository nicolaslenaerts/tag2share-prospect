/**
 * Liste de suppression : emails à ne jamais (re)contacter.
 * Alimentée par les désinscriptions, les bounces durs et les plaintes spam.
 *
 * MULTI-MARQUE : chaque ligne porte un périmètre (colonne `brand`)
 *   - GLOBAL_SCOPE ('*') → l'adresse est exclue pour TOUTES les marques
 *   - un slug de marque   → l'adresse est exclue pour cette marque uniquement
 * Toutes les lectures d'exclusion prennent donc la marque en argument et
 * considèrent « exclu » ce qui vaut pour cette marque OU globalement.
 */
import { supabaseAdmin } from "./supabase";

/** Périmètre « toutes marques ». */
export const GLOBAL_SCOPE = "*";

export function normEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export type SuppressionReason = "unsubscribe" | "bounce" | "complaint" | "manual";

/**
 * Périmètre d'une suppression selon sa raison.
 * "*" = toutes les marques · brandSlug = cette marque uniquement
 *
 * ⚠️ DÉCISION MÉTIER — les quatre valeurs par défaut ci-dessous reproduisent le
 * comportement mono-marque historique (tout est global), qui est le choix
 * prudent. Ajuste chaque branche selon l'arbitrage voulu :
 *
 *  - bounce     : l'adresse n'existe pas / rejette durablement. Techniquement
 *                 invalide pour tout le monde → argument fort pour '*'.
 *  - complaint  : plainte spam. Aucune interdiction légale au-delà de la marque
 *                 concernée, mais signal de réputation très négatif.
 *  - unsubscribe: le contact a refusé CETTE marque. Rien ne l'empêche
 *                 juridiquement de recevoir une autre marque (B2B, RGPD
 *                 art. 6.1.f), mais il peut le vivre comme un contournement.
 *  - manual     : geste explicite de l'opérateur.
 */
export function suppressionScope(
  reason: SuppressionReason,
  brandSlug: string
): string {
  switch (reason) {
    case "bounce":
      return GLOBAL_SCOPE;
    case "complaint":
      return GLOBAL_SCOPE;
    case "unsubscribe":
      return GLOBAL_SCOPE;
    case "manual":
      return GLOBAL_SCOPE;
    default:
      return GLOBAL_SCOPE;
  }
}

/** Périmètres à interroger pour une marque : le sien + le périmètre global. */
function scopesFor(brandSlug: string): string[] {
  return brandSlug === GLOBAL_SCOPE
    ? [GLOBAL_SCOPE]
    : [brandSlug, GLOBAL_SCOPE];
}

/**
 * Ajoute (ou met à jour) un email dans la liste de suppression.
 * Le périmètre est déduit de la raison par suppressionScope().
 */
export async function addSuppression(
  email: string,
  brandSlug: string,
  reason: SuppressionReason = "unsubscribe",
  detail?: string
) {
  const e = normEmail(email);
  if (!e) return;
  const brand = suppressionScope(reason, brandSlug);
  const db = supabaseAdmin();
  await db
    .from("suppressions")
    .upsert(
      { email: e, brand, reason, detail: detail ?? null },
      { onConflict: "email,brand" }
    );
}

/** Retire un email de la liste, pour la marque donnée et pour le global. */
export async function removeSuppression(email: string, brandSlug: string) {
  const e = normEmail(email);
  if (!e) return;
  const db = supabaseAdmin();
  await db
    .from("suppressions")
    .delete()
    .eq("email", e)
    .in("brand", scopesFor(brandSlug));
}

/** Sous-ensemble des emails fournis exclus POUR CETTE MARQUE (ou globalement). */
export async function suppressedSet(
  emails: string[],
  brandSlug: string
): Promise<Set<string>> {
  const list = Array.from(new Set(emails.map(normEmail).filter(Boolean)));
  if (list.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data } = await db
    .from("suppressions")
    .select("email")
    .in("email", list)
    .in("brand", scopesFor(brandSlug));
  return new Set((data ?? []).map((r) => r.email));
}

/**
 * Map email -> raison de suppression, pour cette marque (ou globale).
 * Une exclusion globale prime sur une exclusion propre à la marque : c'est
 * l'information la plus forte à afficher.
 */
export async function suppressionMap(
  emails: string[],
  brandSlug: string
): Promise<Map<string, SuppressionReason>> {
  const list = Array.from(new Set(emails.map(normEmail).filter(Boolean)));
  if (list.length === 0) return new Map();
  const db = supabaseAdmin();
  const { data } = await db
    .from("suppressions")
    .select("email, reason, brand")
    .in("email", list)
    .in("brand", scopesFor(brandSlug));
  const map = new Map<string, SuppressionReason>();
  for (const r of data ?? []) {
    if (!map.has(r.email) || r.brand === GLOBAL_SCOPE) {
      map.set(r.email, r.reason as SuppressionReason);
    }
  }
  return map;
}

/** True si l'email est exclu pour cette marque (ou globalement). */
export async function isSuppressed(
  email: string,
  brandSlug: string
): Promise<boolean> {
  const set = await suppressedSet([email], brandSlug);
  return set.has(normEmail(email));
}
