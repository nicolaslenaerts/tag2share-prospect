/**
 * Résolution des produits d'une marque (objets vendus, alimentant les tokens
 * {{product_*}} des emails et le contexte des prompts IA).
 *
 * Le catalogue lui-même vit dans lib/brands/<slug>.ts : ce module ne contient
 * plus que la logique de résolution, désormais relative à une marque.
 */
import type { BrandConfig, Product } from "./brands/types";

export type { Product };

/**
 * Clé de produit telle que stockée en base (segments.product,
 * campaigns.product, email_log.product_key). Libre : chaque marque définit
 * ses propres clés.
 */
export type ProductKey = string;

function deaccent(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Catalogue de la marque. */
export function productList(brand: BrandConfig): Product[] {
  return brand.products;
}

/**
 * Normalise un libellé/clé libre vers une clé produit de CETTE marque.
 * Ordre de résolution : clé exacte, puis correspondance sur le nom ou un alias,
 * puis repli sur le premier produit du catalogue.
 */
export function normalizeProductKey(
  brand: BrandConfig,
  input?: string | null
): ProductKey {
  const list = brand.products;
  if (list.length === 0) {
    throw new Error(`La marque "${brand.slug}" n'a aucun produit configuré.`);
  }
  const raw = (input || "").trim();
  if (!raw) return list[0].key;

  const exact = list.find((p) => p.key.toLowerCase() === raw.toLowerCase());
  if (exact) return exact.key;

  const norm = deaccent(raw);
  for (const p of list) {
    const candidates = [p.key, p.name, ...(p.aliases ?? [])]
      .map(deaccent)
      .filter(Boolean);
    if (candidates.some((c) => norm.includes(c))) return p.key;
  }
  return list[0].key;
}

/** Produit mis en avant, résolu depuis un libellé/clé libre. */
export function getProduct(brand: BrandConfig, input?: string | null): Product {
  const key = normalizeProductKey(brand, input);
  return brand.products.find((p) => p.key === key) ?? brand.products[0];
}

/** Les autres produits du catalogue (hors produit mis en avant). */
export function otherProducts(
  brand: BrandConfig,
  input?: string | null
): Product[] {
  const key = normalizeProductKey(brand, input);
  return brand.products.filter((p) => p.key !== key);
}

/** Catalogue formaté pour un prompt IA. */
export function productsPrompt(brand: BrandConfig): string {
  return brand.products
    .map((p) => `- [${p.key}] ${p.name} (${p.price}) : ${p.description}`)
    .join("\n");
}
