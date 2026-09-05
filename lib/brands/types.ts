/**
 * Contrat d'une MARQUE (produit/enseigne) prospectée par l'outil.
 *
 * Une marque = une identité visuelle, un catalogue de produits, un layout
 * d'email, une adresse d'expédition et un positionnement injecté dans les
 * prompts IA. Tout est stocké en clair ici : ce module est importé AUSSI côté
 * navigateur (aperçu d'email dans l'UI), donc il ne doit contenir AUCUN secret
 * et AUCUNE lecture de process.env.
 *
 * Les secrets (clé Resend, secret de webhook) sont communs à toutes les
 * marques et lus côté serveur uniquement (voir lib/brand-sender.ts), qui
 * résout aussi l'adresse d'envoi : base de données → env → défaut ci-dessous.
 */

/** Un produit du catalogue d'une marque (alimente les tokens {{product_*}}). */
export type Product = {
  /** Clé stable stockée en base (segments.product, campaigns.product, email_log.product_key). */
  key: string;
  name: string;
  price: string;
  shopUrl: string;
  configUrl: string;
  description: string;
  /** Angle marketing principal (utilisé dans l'encart "autres produits" et les prompts IA). */
  pitch: string;
  /**
   * Libellés libres qui doivent être reconnus comme désignant ce produit
   * (normalisation d'une valeur venue de l'IA ou d'une saisie historique).
   * La comparaison est insensible à la casse et aux accents.
   */
  aliases?: string[];
};

/** Gabarit d'email disponible (voir lib/email-layouts/). */
export type EmailLayoutKey = "classic" | "minimal";

/** Lien réseau social affiché dans le pied de l'email. */
export type SocialLink = { label: string; url: string };

export type BrandTheme = {
  /** Couleur de marque en composantes RVB : sert à la fois aux emails et à l'UI. */
  rgb: [number, number, number];
  logoUrl: string;
  /** Texte alternatif du logo dans l'email. */
  logoAlt: string;
  logoWidth: number;
  /** Monogramme affiché dans le header de l'app (2-3 caractères). */
  monogram: string;
};

/**
 * Configuration d'expédition PAR DÉFAUT de la marque.
 *
 * La clé API Resend est unique pour toute l'app (RESEND_API_KEY) : un seul
 * compte, plusieurs domaines vérifiés. Ce qui varie par marque, c'est
 * l'adresse d'envoi - modifiable dans l'interface et stockée en base
 * (table brand_settings).
 *
 * Les valeurs ci-dessous ne sont donc que le DÉFAUT, utilisé tant que rien
 * n'a été enregistré. Ordre de résolution (voir lib/brand-sender.ts) :
 *   table brand_settings → variable d'env nommée par `*Env` → valeur littérale.
 */
export type BrandSender = {
  /** Nom affiché de l'expéditeur, ex. "Nicolas de Tag2Share". */
  fromName?: string;
  /** Adresse d'envoi (le domaine doit être vérifié chez Resend). */
  from: string;
  fromEnv?: string;
  replyTo: string;
  replyToEnv?: string;
  /** Adresse de réception des emails de test. */
  testEmail?: string;
  testEmailEnv?: string;
  /** Identité affichée dans le pied de l'email (exigence RGPD / anti-spam). */
  identity: { name: string; address?: string; contact: string };
  /** Plafond d'envois par jour POUR CETTE MARQUE (0 = illimité). */
  dailyCap: number;
  dailyCapEnv?: string;
  /** Délai entre deux envois, en ms. */
  delayMs: number;
  delayMsEnv?: string;
};

/** Contexte de marque injecté dans les prompts Gemini. */
export type BrandAi = {
  /** Une à deux phrases : qui est la marque, ce qu'elle vend, son bénéfice clé. */
  positioning: string;
  /** Signature imposée en fin d'email (ex. "L'équipe Tag2Share"). */
  signature: string;
};

export type BrandConfig = {
  /** Identifiant stable stocké en base (colonne `brand`). Minuscules, sans espace. */
  slug: string;
  /** Nom affiché (UI + prompts IA + pied d'email). */
  name: string;
  /** Sous-titre affiché sous le titre de l'app. */
  tagline: string;
  /**
   * Domaines appartenant à la marque. Seuls les liens pointant vers ces
   * domaines (ou leurs sous-domaines) reçoivent les paramètres UTM.
   */
  domains: string[];
  theme: BrandTheme;
  /** Page boutique générique (CTA de repli). */
  shopUrl: string;
  email: {
    layout: EmailLayoutKey;
    socials: SocialLink[];
  };
  sender: BrandSender;
  /** Contenu par défaut d'une nouvelle campagne. */
  defaults: { subject: string; body: string; tagline: string };
  /** Catalogue. Le PREMIER produit sert de repli quand aucun n'est résolu. */
  products: Product[];
  ai: BrandAi;
};

/** Couleur de marque au format CSS `rgb(r,g,b)` (emails : pas de variable CSS possible). */
export function brandColor(brand: BrandConfig): string {
  const [r, g, b] = brand.theme.rgb;
  return `rgb(${r},${g},${b})`;
}

/** Triplet `"r g b"` pour la variable CSS --brand consommée par Tailwind. */
export function brandCssTriplet(brand: BrandConfig): string {
  return brand.theme.rgb.join(" ");
}
