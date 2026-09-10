/**
 * Rendu des emails : fusion des variables {{...}} avec les données du prospect,
 * puis habillage dans le gabarit de la MARQUE.
 *
 * Toute fonction qui produit du HTML visible prend la marque en argument :
 * couleurs, logo, catalogue produit, réseaux sociaux et domaines à taguer en
 * UTM en dépendent. Voir lib/brands/ pour le registre et lib/email-layouts/
 * pour les gabarits.
 */

import { getProduct, otherProducts } from "./products";
import { brandColor, brandTextColor, type BrandConfig } from "./brands/types";
import { renderLayout } from "./email-layouts";
import { noEmDash, enhanceLinks, slugify, ctaButton } from "./email-html";
import { effectiveTemplate, type CampaignVariant } from "./campaign-variants";

export { noEmDash, enhanceLinks, slugify, ctaButton };

/**
 * Variables produit : résolues depuis le segment (pas depuis le prospect) →
 * elles ne comptent pas comme des champs prospect requis.
 */
export const PRODUCT_TOKENS = new Set([
  "product_name", "product_price", "product_url", "config_url", "products_more",
]);

/**
 * Champs prospect réellement requis par un template = ses variables {{...}},
 * hors variables produit. Utilisé pour décider qu'un prospect est « complet »
 * (côté UI comme côté synchro serveur — garder les deux alignés).
 */
export function requiredProspectFields(...templates: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi;
  for (const t of templates) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t || ""))) {
      const key = m[1].toLowerCase();
      if (!PRODUCT_TOKENS.has(key)) found.add(key);
    }
  }
  return [...found];
}

export type UtmParams = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
};

/** Valeurs UTM par défaut (si la campagne ne surcharge pas). */
export const DEFAULT_UTM_SOURCE = "email";
export const DEFAULT_UTM_MEDIUM = "prospection";

/** Vrai si l'URL pointe vers un domaine de la marque (ou un sous-domaine). */
function isOwnDomain(u: URL, domains: string[]): boolean {
  const host = u.hostname.toLowerCase();
  return domains.some((d) => {
    const dom = d.toLowerCase().replace(/^\.+/, "");
    return host === dom || host.endsWith("." + dom);
  });
}

/**
 * Ajoute les paramètres UTM à une URL http(s) absolue pointant vers un domaine
 * de la marque. Les liens externes, non-http (mailto:, tel:, #ancres) et les
 * params utm_* déjà présents sont laissés intacts.
 */
export function withUtm(url: string, utm: UtmParams, brand: BrandConfig): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!isOwnDomain(u, brand.domains)) return url; // on ne tague que nos propres liens
    const map: Record<string, string | undefined> = {
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      utm_content: utm.content,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Ajoute les paramètres UTM à tous les liens de la marque (<a href>) d'un
 * fragment HTML. Les liens externes / mailto / tel / ancres sont ignorés.
 */
export function addUtmToLinks(
  html: string,
  utm: UtmParams,
  brand: BrandConfig
): string {
  return html.replace(
    /(<a\b[^>]*\bhref=)(["'])(.*?)\2/gi,
    (_m, prefix: string, quote: string, href: string) =>
      `${prefix}${quote}${withUtm(href, utm, brand)}${quote}`
  );
}

/**
 * Mini-bloc "autres produits" (tous les produits non mis en avant), avec liens visibles.
 */
export function productsMoreBlock(
  brand: BrandConfig,
  featuredKey?: string | null
): string {
  // Liens et titre en couleur de TEXTE (lisible), filet en couleur de signature.
  const color = brandTextColor(brand);
  const accent = brandColor(brand);
  const others = otherProducts(brand, featuredKey);
  if (others.length === 0) return "";
  const items = others
    .map(
      (p) =>
        `<li style="margin-bottom:6px;"><a href="${p.shopUrl}" style="color:${color};font-weight:600;text-decoration:underline;">${p.name}</a> - ${p.pitch}</li>`
    )
    .join("");
  return `<div style="margin-top:24px;padding:16px 18px;background:#f1f5f8;border-radius:8px;border-left:3px solid ${accent};">
  <p style="margin:0 0 8px;font-weight:700;color:${color};">À découvrir aussi 👀</p>
  <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;">${items}</ul>
</div>`;
}

export type MergeData = {
  name?: string;
  contact_name?: string;
  category?: string;
  city?: string;
  country?: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string;
  logo_url?: string;
  // Champs produit (résolus depuis le produit mis en avant du segment)
  product_name?: string;
  product_price?: string;
  product_url?: string;
  config_url?: string;
  products_more?: string; // bloc HTML "autres produits"
};

/** Variables disponibles dans l'éditeur (affichées à l'utilisateur). */
export const MERGE_FIELDS: { token: string; label: string }[] = [
  { token: "{{name}}", label: "Nom du business" },
  { token: "{{contact_name}}", label: "Personne de contact" },
  { token: "{{category}}", label: "Catégorie / type" },
  { token: "{{city}}", label: "Ville" },
  { token: "{{country}}", label: "Pays" },
  { token: "{{address}}", label: "Adresse" },
  { token: "{{phone}}", label: "Téléphone" },
  { token: "{{website}}", label: "Site web" },
  { token: "{{logo_url}}", label: "URL du logo" },
  { token: "{{product_name}}", label: "Produit mis en avant" },
  { token: "{{product_url}}", label: "Lien page produit" },
  { token: "{{config_url}}", label: "Lien configurateur" },
  { token: "{{products_more}}", label: "Bloc autres produits" },
];

/** Remplace les {{tokens}} par les valeurs du prospect (vide si absent). */
export function renderMerge(template: string, data: MergeData): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => {
    const v = (data as Record<string, unknown>)[key];
    return v != null ? String(v) : "";
  });
}

/**
 * Construit les données de fusion à partir d'un prospect, avec fallbacks polis.
 * @param brand       marque dont on tire le catalogue produit
 * @param productKey  clé du produit mis en avant (depuis le segment) → alimente {{product_*}}
 */
export function mergeDataFromProspect(
  brand: BrandConfig,
  prospect: Record<string, any>,
  override?: Partial<MergeData>,
  productKey?: string | null
): MergeData {
  const p = getProduct(brand, productKey);
  return {
    name: prospect.name,
    contact_name: prospect.contact_name || "Madame, Monsieur",
    category: prospect.category,
    city: prospect.city,
    country: prospect.country,
    address: prospect.address,
    phone: prospect.phone,
    website: prospect.website,
    email: prospect.email,
    logo_url: prospect.logo_url,
    product_name: p.name,
    product_price: p.price,
    product_url: p.shopUrl,
    config_url: p.configUrl,
    products_more: productsMoreBlock(brand, productKey),
    ...override,
  };
}

/**
 * Rend l'email final d'un destinataire. Priorité du template, du plus
 * spécifique au plus général :
 *   1. override du destinataire (custom_subject / custom_html)
 *   2. variante d'email affectée au destinataire (campaign_variants)
 *   3. template de la campagne (repli quand la campagne n'a pas de variante)
 * Produit mis en avant ({{product_*}}) : variante, puis produit cible de la
 * campagne, puis produit du segment fourni (résolu, côté appelant, dans la
 * marque de la campagne).
 *
 * L'accroche et le produit suivent la même cascade, calculée une seule fois
 * dans effectiveTemplate (lib/campaign-variants.ts) pour que l'aperçu de
 * l'interface, l'envoi de test et l'envoi réel donnent tous le même résultat.
 */
export function buildRecipientEmail(args: {
  brand: BrandConfig;
  campaign: {
    subject: string;
    body_html: string;
    email_tagline?: string | null;
    product?: string | null;
    name?: string | null;
    // Surcharges UTM (null/vide → valeurs par défaut).
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
  };
  /** Variante affectée au destinataire (null = template de la campagne). */
  variant?: CampaignVariant | null;
  recipient: { custom_subject?: string | null; custom_html?: string | null };
  prospect: Record<string, any>;
  segment?: {
    product?: string | null;
  } | null;
  overrideData?: Partial<MergeData>;
  unsubscribeUrl?: string | null;
}): { subject: string; html: string } {
  const brand = args.brand;
  const seg = args.segment;
  // Variante par-dessus le template de la campagne.
  const tpl = effectiveTemplate(args.campaign, args.variant);
  // Override variante/campagne prioritaire, sinon produit du segment.
  const productKey = tpl.product || seg?.product;
  const data = mergeDataFromProspect(
    brand,
    args.prospect,
    args.overrideData,
    productKey
  );
  const subjectTpl = args.recipient.custom_subject || tpl.subject;
  const bodyTpl = args.recipient.custom_html || tpl.body_html;
  const subject = noEmDash(renderMerge(subjectTpl, data));
  // Tag UTM : chaque lien de la marque dans le corps reçoit source/medium/campaign
  // (+ produit en avant). Les valeurs de la campagne priment sur les défauts.
  const utm: UtmParams = {
    source: args.campaign.utm_source?.trim() || DEFAULT_UTM_SOURCE,
    medium: args.campaign.utm_medium?.trim() || DEFAULT_UTM_MEDIUM,
    campaign:
      args.campaign.utm_campaign?.trim() ||
      (args.campaign.name ? slugify(args.campaign.name) : "prospection"),
    // utm_content porte le produit ET la variante : c'est ce qui permet de
    // comparer les textes dans les stats de clics, en plus d'email_log.
    content:
      [productKey, args.variant ? slugify(args.variant.name) : null]
        .filter(Boolean)
        .join("-") || undefined,
  };
  // Le header affiche TOUJOURS le logo de la marque (pas celui du prospect).
  // enhanceLinks garantit des liens visibles même si le template n'en stylise pas.
  // addUtmToLinks ajoute le tracking UTM à tous les liens du corps (le lien de
  // désinscription, ajouté ensuite par le gabarit, n'est pas concerné).
  // noEmDash : aucun email ne doit contenir le caractère "—".
  // L'accroche sous le logo est éditable par campagne (email_tagline).
  const html = noEmDash(
    renderLayout(
      brand,
      addUtmToLinks(
        enhanceLinks(renderMerge(bodyTpl, data), brandTextColor(brand)),
        utm,
        brand
      ),
      {
        tagline: tpl.email_tagline,
        unsubscribeUrl: args.unsubscribeUrl ?? null,
      }
    )
  );
  return { subject, html };
}
