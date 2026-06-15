/**
 * Catalogue des 3 produits Tag2Share (objets connectés NFC/QR).
 * Source : https://www.tag2share.com/shop/category/objets-connectes-9
 * Sert de contexte à l'IA et alimente les liens (page produit + configurateur) des emails.
 */
export type ProductKey = "card" | "keyring" | "stand";

export type Product = {
  key: ProductKey;
  name: string;
  price: string;
  shopUrl: string;
  configUrl: string;
  description: string;
  pitch: string; // angle marketing principal
};

export const PRODUCTS: Record<ProductKey, Product> = {
  keyring: {
    key: "keyring",
    name: "Porte-clé connecté",
    price: "14,90 €",
    shopUrl: "https://www.tag2share.com/shop/objets-connectes-9/porte-cle-connecte-5",
    configUrl: "https://app.tag2share.com/customize/keyring/",
    description:
      "Porte-clé NFC + QR code. Au contact d'un smartphone, il ouvre instantanément une page (profil, menu, avis Google, réseaux sociaux, site web…).",
    pitch:
      "votre vitrine toujours sur vous : partagez profil, avis et réseaux en un geste, partout.",
  },
  card: {
    key: "card",
    name: "Carte de visite connectée",
    price: "24,90 €",
    shopUrl:
      "https://www.tag2share.com/shop/objets-connectes-9/carte-de-visite-connectee-6",
    configUrl: "https://app.tag2share.com/customize/card/",
    description:
      "Carte de visite NFC + QR code. Remplace la carte papier : un tap partage coordonnées, réseaux sociaux et liens. Réutilisable, modifiable à distance.",
    pitch:
      "votre réseau en un tap : coordonnées, réseaux et liens partagés instantanément, sans papier.",
  },
  stand: {
    key: "stand",
    name: "Présentoir connecté",
    price: "34,90 €",
    shopUrl: "https://www.tag2share.com/shop/objets-connectes-9/presentoir-connecte-7",
    configUrl: "https://app.tag2share.com/customize/stand/",
    description:
      "Présentoir de comptoir NFC + QR code. Posé en boutique/accueil, il invite les clients à scanner pour laisser un avis Google, suivre les réseaux ou consulter le menu.",
    pitch:
      "posé sur le comptoir, irrésistible à scanner : un flux régulier d'avis Google 5★ et d'abonnés.",
  },
};

export const PRODUCT_LIST = Object.values(PRODUCTS);

/** Normalise un label/clé libre vers une clé produit. */
export function normalizeProductKey(input?: string | null): ProductKey {
  const s = (input || "").toLowerCase();
  if (s.includes("card") || s.includes("carte") || s.includes("visite")) return "card";
  if (s.includes("stand") || s.includes("présentoir") || s.includes("presentoir"))
    return "stand";
  return "keyring";
}

export function getProduct(input?: string | null): Product {
  return PRODUCTS[normalizeProductKey(input)];
}

/** Les 2 autres produits (hors produit mis en avant). */
export function otherProducts(input?: string | null): Product[] {
  const key = normalizeProductKey(input);
  return PRODUCT_LIST.filter((p) => p.key !== key);
}

export const PRODUCTS_PROMPT = PRODUCT_LIST.map(
  (p) => `- [${p.key}] ${p.name} (${p.price}) : ${p.description}`
).join("\n");
