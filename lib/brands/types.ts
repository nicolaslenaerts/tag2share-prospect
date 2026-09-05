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
  /**
   * Nom employé DANS L'EMAIL, donc dans une phrase : « Découvrir {{product_name}} ».
   * Il doit se lire naturellement à cet endroit.
   */
  name: string;
  /**
   * Libellé employé DANS L'INTERFACE (menus, badges). Par défaut `name`.
   * Utile quand les deux divergent : une offre globale s'annonce « Général »
   * dans un menu déroulant, mais « Horodo » dans une phrase.
   */
  uiLabel?: string;
  /**
   * Prix affichable. Optionnel : un produit « offre globale », qui présente les
   * fonctionnalités plutôt qu'une formule, n'en a pas. {{product_price}} rend
   * alors une chaîne vide.
   */
  price?: string;
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
  /**
   * Couleur de SIGNATURE, en composantes RVB : fonds de bouton, bandeau,
   * filets. C'est la couleur que la marque revendique.
   */
  rgb: [number, number, number];
  /**
   * Variante lisible EN TEXTE sur fond clair (liens, accents typographiques).
   * Par défaut, la couleur de signature - ce qui convient aux marques sombres.
   * Une marque claire (ambre, jaune, cyan) DOIT en fournir une : sa couleur de
   * signature en texte sur blanc tombe sous le seuil de contraste lisible.
   */
  textRgb?: [number, number, number];
  /**
   * Couleur du texte POSÉ SUR la couleur de signature (libellé de bouton,
   * bandeau). Par défaut blanc ; une marque claire y met son encre foncée.
   */
  onBrandHex?: string;
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
  /**
   * Formulations INTERDITES, reprises telles quelles dans les prompts.
   * Indispensable pour une marque en secteur réglementé : une allégation de
   * conformité ou de certification inventée par l'IA dans un email de
   * prospection engage la responsabilité de l'entreprise.
   */
  forbidden?: string[];
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
  /**
   * URL PUBLIQUE de cet outil pour cette marque, ex.
   * `https://marketing.horodo.be`. C'est elle qui préfixe tous les liens
   * hébergés par l'app et visibles par un prospect : aujourd'hui le lien de
   * désinscription du pied d'email.
   *
   * Ce n'est pas un détail cosmétique. Un email signé Horodo dont le lien de
   * désinscription pointe vers marketing.tag2share.com révèle une marque que
   * le destinataire ne connaît pas, et les filtres anti-spam pénalisent un
   * domaine de lien étranger au domaine d'envoi.
   *
   * Le domaine doit servir la MÊME instance (même déploiement, même base) :
   * la vérification du lien signé se fait sur le serveur qui le reçoit.
   * Absent → repli sur la variable d'environnement APP_URL.
   */
  appUrl?: string;
  theme: BrandTheme;
  /** Page boutique générique (CTA de repli). */
  shopUrl: string;
  email: {
    layout: EmailLayoutKey;
    socials: SocialLink[];
    /**
     * Proposer l'encart {{products_more}} (« À découvrir aussi ») dans les
     * emails rédigés par l'IA. À laisser à false pour une marque dont le
     * catalogue est une grille de formules : lister les paliers tarifaires sous
     * un email de prospection déplace la conversation sur le prix trop tôt.
     * Par défaut true (comportement historique).
     */
    showProductsMore?: boolean;
  };
  sender: BrandSender;
  /** Contenu par défaut d'une nouvelle campagne. */
  defaults: { subject: string; body: string; tagline: string };
  /** Catalogue. Le PREMIER produit sert de repli quand aucun n'est résolu. */
  products: Product[];
  /**
   * Produit présélectionné dans l'interface (étape 1). Par défaut, le premier
   * du catalogue. Ne change PAS la résolution de repli de normalizeProductKey,
   * qui reste le premier produit : ce sont deux questions différentes, « que
   * proposer à l'utilisateur » et « que faire d'une valeur inconnue ».
   */
  defaultProductKey?: string;
  ai: BrandAi;
};

/**
 * Bloc d'interdits à insérer dans un prompt. Chaîne vide si la marque n'en
 * déclare aucun, pour ne pas polluer le prompt.
 */
export function brandForbiddenBlock(brand: BrandConfig): string {
  const list = brand.ai.forbidden ?? [];
  if (list.length === 0) return "";
  return `\nINTERDITS DE COMMUNICATION - ne jamais employer, sous aucune forme, même reformulée :\n${list
    .map((f) => `- ${f}`)
    .join("\n")}\n`;
}

/** Couleur de signature au format CSS `rgb(r,g,b)` (emails : pas de variable CSS possible). */
export function brandColor(brand: BrandConfig): string {
  const [r, g, b] = brand.theme.rgb;
  return `rgb(${r},${g},${b})`;
}

/** Couleur de marque utilisable en TEXTE sur fond clair (liens, accents). */
export function brandTextColor(brand: BrandConfig): string {
  const [r, g, b] = brand.theme.textRgb ?? brand.theme.rgb;
  return `rgb(${r},${g},${b})`;
}

/** Couleur du texte posé SUR la couleur de signature. */
export function brandOnColor(brand: BrandConfig): string {
  return brand.theme.onBrandHex ?? "#ffffff";
}

/** Triplet `"r g b"` pour la variable CSS --brand consommée par Tailwind. */
export function brandCssTriplet(brand: BrandConfig): string {
  return brand.theme.rgb.join(" ");
}
