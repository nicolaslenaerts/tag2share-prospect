/**
 * Résolution de la marque ACTIVE d'une requête.
 *
 * Chaîne de résolution :
 *   1. en-tête `x-brand` (posé par le middleware d'après le cookie)
 *   2. cookie `brand`            → préférence explicite de la session
 *   3. DOMAINE de la requête      → marque dont c'est l'URL publique
 *   4. marque par défaut
 *
 * Le domaine passe APRÈS le cookie parce que les cookies sont déjà cloisonnés
 * par domaine dans le navigateur : arriver sur marketing.horodo.be donne
 * Horodo, et y basculer manuellement sur une autre marque reste possible sans
 * que le domaine ne l'écrase à chaque navigation.
 *
 * ⚠️ Ces fonctions sont ASYNCHRONES : le registre inclut désormais les marques
 * créées dans l'interface, qui vivent en base (voir lib/brands/store.ts).
 *
 * ⚠️ Le cloisonnement entre marques est APPLICATIF (la RLS Supabase est
 * désactivée au profit de la clé service_role) : toute requête qui lit ou écrit
 * des données de marque doit filtrer explicitement sur la colonne `brand`.
 */
import {
  defaultBrand,
  findBrandRecord,
  loadBrandRecords,
  resolveBrandOrDefault,
  resolveSendableBrand,
} from "./brands/store";
import { normalizeDomain, SLUG_RE } from "./brands/schema";
import type { BrandConfig } from "./brands/types";
import { BRAND_COOKIE, BRAND_HEADER } from "./brand-cookie";

export { BRAND_COOKIE, BRAND_HEADER };

/** Forme admise d'un slug. Le middleware s'en sert sans accès à la base. */
export const BRAND_SLUG_RE = SLUG_RE;

/** Lit un cookie dans l'en-tête Cookie brut (utilisable partout, edge inclus). */
function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Slug de marque demandé par la requête, sans validation contre le registre. */
export function requestedBrandSlug(req: Request): string | undefined {
  return (
    req.headers.get(BRAND_HEADER) ??
    cookieValue(req.headers.get("cookie"), BRAND_COOKIE) ??
    undefined
  );
}

/** Hôte de la requête, tel que vu par le proxy. */
function requestHost(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-host");
  const host = forwarded || req.headers.get("host") || "";
  return normalizeDomain(host.split(",")[0]);
}

/**
 * Marque dont l'URL publique correspond au domaine de la requête.
 * Comparaison EXACTE sur l'hôte : deux marques peuvent partager un domaine
 * racine (exemple.com) tout en ayant des sous-domaines d'outil distincts, et
 * une correspondance par suffixe attribuerait la requête à la mauvaise.
 */
async function brandForHost(req: Request): Promise<BrandConfig | undefined> {
  const host = requestHost(req);
  if (!host) return undefined;
  const records = await loadBrandRecords();
  return records.find((r) => r.brand.appUrl && normalizeDomain(r.brand.appUrl) === host)?.brand;
}

/**
 * Marque active de la requête. Repli silencieux sur la marque par défaut :
 * une session sans cookie (ou avec un slug retiré du registre) continue de
 * fonctionner sur la marque historique.
 */
export async function activeBrand(req: Request): Promise<BrandConfig> {
  const slug = requestedBrandSlug(req);
  if (slug) {
    const found = await findBrandRecord(slug);
    if (found) return found.brand;
  }
  return (await brandForHost(req)) ?? (await defaultBrand());
}

/**
 * Variante stricte, pour les écritures : refuse un slug inconnu au lieu de
 * basculer silencieusement sur une autre marque.
 */
export async function requireBrand(req: Request): Promise<BrandConfig> {
  const slug = requestedBrandSlug(req);
  if (!slug) return (await brandForHost(req)) ?? (await defaultBrand());
  const brand = await resolveBrandOrDefault(slug);
  if (brand.slug !== slug) throw new Error(`Marque inconnue : "${slug}".`);
  return brand;
}

/**
 * Marque autorisée à ENVOYER DE VRAIS EMAILS. Lève si elle est inconnue ou
 * encore en brouillon. À utiliser avec le slug de la CAMPAGNE, pas celui de la
 * session : l'identité d'envoi appartient à la campagne.
 */
export async function requireSendableBrand(slug: string): Promise<BrandConfig> {
  return resolveSendableBrand(slug);
}
