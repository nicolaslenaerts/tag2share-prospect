/**
 * Résolution de la marque ACTIVE d'une requête.
 *
 * Chaîne de résolution : en-tête `x-brand` (posé par le middleware) → cookie
 * `brand` → marque par défaut. Le middleware valide déjà le slug ; on revalide
 * ici car les routes publiques (webhooks, désinscription) ne passent pas par
 * lui.
 *
 * ⚠️ Le cloisonnement entre marques est APPLICATIF (la RLS Supabase est
 * désactivée au profit de la clé service_role) : toute requête qui lit ou écrit
 * des données de marque doit filtrer explicitement sur la colonne `brand`.
 */
import { DEFAULT_BRAND, findBrand, getBrandOrDefault } from "./brands";
import type { BrandConfig } from "./brands/types";

export const BRAND_HEADER = "x-brand";
export const BRAND_COOKIE = "brand";

/** Lit un cookie dans l'en-tête Cookie brut (utilisable partout, edge inclus). */
function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Slug de marque demandé par la requête, sans validation. */
export function requestedBrandSlug(req: Request): string | undefined {
  return (
    req.headers.get(BRAND_HEADER) ??
    cookieValue(req.headers.get("cookie"), BRAND_COOKIE) ??
    undefined
  );
}

/**
 * Marque active de la requête. Repli silencieux sur la marque par défaut :
 * une session sans cookie (ou avec un slug retiré du registre) continue de
 * fonctionner sur la marque historique.
 */
export function activeBrand(req: Request): BrandConfig {
  return getBrandOrDefault(requestedBrandSlug(req));
}

/**
 * Variante stricte, pour les écritures : refuse un slug inconnu au lieu de
 * basculer silencieusement sur une autre marque.
 */
export function requireBrand(req: Request): BrandConfig {
  const slug = requestedBrandSlug(req);
  if (!slug) return DEFAULT_BRAND;
  const brand = findBrand(slug);
  if (!brand) throw new Error(`Marque inconnue : "${slug}".`);
  return brand;
}
