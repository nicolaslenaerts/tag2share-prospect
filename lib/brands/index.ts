/**
 * Registre des marques. Ajouter une marque = créer lib/brands/<slug>.ts
 * (voir lib/brands/_example.ts) puis l'ajouter au tableau BRANDS ci-dessous.
 *
 * Client-safe : aucun secret, aucune lecture de process.env.
 */
import type { BrandConfig } from "./types";
import { tag2share } from "./tag2share";

export * from "./types";

/** Toutes les marques gérées par l'outil, dans l'ordre d'affichage. */
export const BRANDS: BrandConfig[] = [tag2share];

/** Marque utilisée quand la requête n'en précise aucune (rétro-compatibilité). */
export const DEFAULT_BRAND: BrandConfig = BRANDS[0];

/** Recherche stricte : undefined si le slug est inconnu. */
export function findBrand(slug?: string | null): BrandConfig | undefined {
  if (!slug) return undefined;
  const s = String(slug).trim().toLowerCase();
  return BRANDS.find((b) => b.slug === s);
}

/**
 * Résolution stricte, à utiliser partout où une erreur d'identité serait grave
 * (rendu et envoi d'email) : mieux vaut échouer que d'envoyer sous la mauvaise
 * marque.
 */
export function getBrand(slug?: string | null): BrandConfig {
  const b = findBrand(slug);
  if (!b) {
    throw new Error(
      `Marque inconnue : "${slug}". Marques disponibles : ${BRANDS.map((x) => x.slug).join(", ")}.`
    );
  }
  return b;
}

/** Résolution tolérante : repli sur la marque par défaut si slug absent/inconnu. */
export function getBrandOrDefault(slug?: string | null): BrandConfig {
  return findBrand(slug) ?? DEFAULT_BRAND;
}

/** Liste légère pour le sélecteur de marque de l'UI. */
export function brandOptions(): { slug: string; name: string; monogram: string }[] {
  return BRANDS.map((b) => ({
    slug: b.slug,
    name: b.name,
    monogram: b.theme.monogram,
  }));
}
