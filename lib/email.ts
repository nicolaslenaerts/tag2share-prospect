/**
 * Rendu des emails : fusion des variables {{...}} avec les données du prospect,
 * et template HTML de base aux couleurs Tag2Share.
 */

import { getProduct, otherProducts } from "./products";

/** Couleur de marque pour les liens. */
const BRAND = "rgb(20,74,102)";

/** Retire tout tiret cadratin "—" (interdit dans les emails). */
export function noEmDash(text: string): string {
  return text.replace(/—/g, "-");
}

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

/**
 * Rend visibles les liens du corps : tout <a> SANS attribut style reçoit une
 * couleur de marque + soulignement + gras (les boutons, qui ont déjà un style, sont laissés tels quels).
 */
export function enhanceLinks(html: string): string {
  return html.replace(/<a\b(?![^>]*\bstyle=)([^>]*)>/gi, (_m, attrs) => {
    return `<a${attrs} style="color:${BRAND};font-weight:600;text-decoration:underline;">`;
  });
}

/** Transforme un texte en slug utilisable dans une URL (utm_campaign). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
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

/** Vrai si l'URL pointe vers un domaine tag2share.com (ou sous-domaine). */
function isTag2ShareUrl(u: URL): boolean {
  return /(^|\.)tag2share\.com$/i.test(u.hostname);
}

/**
 * Ajoute les paramètres UTM à une URL http(s) absolue pointant vers tag2share.com.
 * Les liens externes, non-http (mailto:, tel:, #ancres) et les params utm_*
 * déjà présents sont laissés intacts.
 */
export function withUtm(url: string, utm: UtmParams): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!isTag2ShareUrl(u)) return url; // on ne tague que nos propres liens
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
 * Ajoute les paramètres UTM à tous les liens tag2share.com (<a href>) d'un
 * fragment HTML. Les liens externes / mailto / tel / ancres sont ignorés.
 */
export function addUtmToLinks(html: string, utm: UtmParams): string {
  return html.replace(
    /(<a\b[^>]*\bhref=)(["'])(.*?)\2/gi,
    (_m, prefix: string, quote: string, href: string) =>
      `${prefix}${quote}${withUtm(href, utm)}${quote}`
  );
}

/**
 * Mini-bloc "autres produits" (les 2 produits non mis en avant), avec liens visibles.
 */
export function productsMoreBlock(featuredKey?: string | null): string {
  const others = otherProducts(featuredKey);
  const items = others
    .map(
      (p) =>
        `<li style="margin-bottom:6px;"><a href="${p.shopUrl}" style="color:${BRAND};font-weight:600;text-decoration:underline;">${p.name}</a> - ${p.pitch}</li>`
    )
    .join("");
  return `<div style="margin-top:24px;padding:16px 18px;background:#f1f5f8;border-radius:8px;border-left:3px solid ${BRAND};">
  <p style="margin:0 0 8px;font-weight:700;color:${BRAND};">À découvrir aussi 👀</p>
  <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;">${items}</ul>
</div>`;
}

export const LOGO_URL =
  "https://rfvjlmojryoovnpyotgf.supabase.co/storage/v1/object/public/mail/tag2share-logo.png";

/** Identité expéditeur affichée dans le footer (exigence RGPD / anti-spam). */
export const SENDER_NAME = process.env.SENDER_NAME || "Tag2Share";
export const SENDER_ADDRESS = process.env.SENDER_ADDRESS || ""; // adresse postale, ex: "Rue X 1, 1000 Bruxelles, Belgique"
export const SENDER_CONTACT = process.env.SENDER_CONTACT || "tag2share.com";

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
 * @param productKey  clé du produit mis en avant (depuis le segment) → alimente {{product_*}}
 */
export function mergeDataFromProspect(
  prospect: Record<string, any>,
  override?: Partial<MergeData>,
  productKey?: string | null
): MergeData {
  const p = getProduct(productKey);
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
    products_more: productsMoreBlock(productKey),
    ...override,
  };
}

/**
 * Rend l'email final d'un destinataire. Priorité du template :
 *   1. override du destinataire (custom_subject / custom_html)
 *   2. template de la campagne (l'email est rédigé au niveau de la campagne)
 * Produit mis en avant ({{product_*}}) : le produit cible de la campagne
 * (campaign.product) prime s'il est défini ; sinon on retombe sur le produit
 * du segment d'ORIGINE du prospect (chaque destinataire voit son produit).
 */
export function buildRecipientEmail(args: {
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
  recipient: { custom_subject?: string | null; custom_html?: string | null };
  prospect: Record<string, any>;
  segment?: {
    product?: string | null;
  } | null;
  overrideData?: Partial<MergeData>;
  unsubscribeUrl?: string | null;
}): { subject: string; html: string } {
  const seg = args.segment;
  // Override campagne prioritaire, sinon produit du segment.
  const productKey = args.campaign.product || seg?.product;
  const data = mergeDataFromProspect(args.prospect, args.overrideData, productKey);
  const subjectTpl = args.recipient.custom_subject || args.campaign.subject;
  const bodyTpl = args.recipient.custom_html || args.campaign.body_html;
  const subject = noEmDash(renderMerge(subjectTpl, data));
  // Tag UTM : chaque lien tag2share du corps reçoit source/medium/campaign
  // (+ produit en avant). Les valeurs de la campagne priment sur les défauts.
  const utm: UtmParams = {
    source: args.campaign.utm_source?.trim() || DEFAULT_UTM_SOURCE,
    medium: args.campaign.utm_medium?.trim() || DEFAULT_UTM_MEDIUM,
    campaign:
      args.campaign.utm_campaign?.trim() ||
      (args.campaign.name ? slugify(args.campaign.name) : "prospection"),
    content: productKey || undefined,
  };
  // Le header affiche TOUJOURS le logo Tag2Share (pas celui du prospect).
  // enhanceLinks garantit des liens visibles même si le template n'en stylise pas.
  // addUtmToLinks ajoute le tracking UTM à tous les liens du corps (le lien de
  // désinscription, ajouté ensuite par wrapEmail, n'est pas concerné).
  // noEmDash : aucun email ne doit contenir le caractère "—".
  // L'accroche sous le logo est éditable par campagne (email_tagline).
  const html = noEmDash(
    wrapEmail(addUtmToLinks(enhanceLinks(renderMerge(bodyTpl, data)), utm), {
      tagline: args.campaign.email_tagline,
      unsubscribeUrl: args.unsubscribeUrl ?? null,
    })
  );
  return { subject, html };
}

/** URL du shop (CTA par défaut). */
export const SHOP_URL = "https://www.tag2share.com/shop/category/objets-connectes-9";

/** Sujet par défaut d'une campagne de prospection (orienté bénéfice). */
export const DEFAULT_SUBJECT =
  "{{name}} : et si chaque client laissait un avis 5★ en 1 geste ?";

/**
 * Bouton CTA réutilisable (inline-block, email-safe).
 */
export function ctaButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto;"><tr><td style="border-radius:8px;background:rgb(20,74,102);">
  <a href="${href}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">${label}</a>
</td></tr></table>`;
}

/**
 * Corps par défaut - version marketing. L'utilisateur le révise/édite.
 * Utilise les variables de fusion ; le contact_name a un fallback géré à l'envoi.
 */
export const DEFAULT_BODY = `<p style="font-size:20px;font-weight:700;color:rgb(20,74,102);margin:0 0 16px;">
  Transformez chaque client de {{name}} en ambassadeur. 🚀
</p>

<p>Bonjour {{contact_name}},</p>

<p>Vos clients sont satisfaits… mais combien laissent vraiment un <strong>avis Google</strong> ou vous suivent sur les <strong>réseaux sociaux</strong>&nbsp;? Le plus souvent, il manque juste le bon déclic, au bon moment.</p>

<p><strong>Tag2Share</strong> crée des <strong>objets connectés (NFC + QR code)</strong> qui transforment ce moment en un simple geste&nbsp;:</p>

<ul style="padding-left:18px;">
  <li>⭐ <strong>Plus d'avis 5 étoiles</strong> - le client scanne, il note. En 5 secondes.</li>
  <li>📈 <strong>Plus d'abonnés</strong> sur Instagram, Facebook &amp; TikTok, sans rien expliquer.</li>
  <li>💳 <strong>Zéro papier</strong> - coordonnées, menu et liens partagés d'un seul tap.</li>
</ul>

<p>Pour {{name}}, je recommande tout particulièrement le <strong>{{product_name}}</strong>.</p>

${ctaButton("Voir le {{product_name}}", "{{product_url}}")}

<p style="text-align:center;margin:-8px 0 8px;">
  <a href="{{config_url}}" style="color:rgb(20,74,102);font-weight:600;">🎨 Personnaliser votre {{product_name}} dans le configurateur →</a>
</p>

<p>Je serais ravi de vous préparer un exemple personnalisé pour <strong>{{name}}</strong>. Quelques minutes cette semaine&nbsp;?</p>

{{products_more}}

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>L'équipe Tag2Share</strong><br/>
<span style="color:#888;">Objets connectés NFC &amp; QR · tag2share.com</span></p>`;

/** Accroche par défaut affichée sous le logo (éditable par campagne). */
export const DEFAULT_TAGLINE =
  "Plus d'avis ⭐  ·  Plus d'abonnés 📈  ·  Zéro contact 💳";

/**
 * Enveloppe le corps HTML dans le gabarit email Tag2Share (table-based, inline styles).
 * tagline : accroche sous le logo. undefined/null → accroche par défaut ; "" → masquée.
 */
export function wrapEmail(
  bodyHtml: string,
  opts?: { logoUrl?: string; tagline?: string | null; unsubscribeUrl?: string | null }
): string {
  const logo = opts?.logoUrl || LOGO_URL;
  const tagline = opts?.tagline == null ? DEFAULT_TAGLINE : opts.tagline;
  const identityLine = [SENDER_NAME, SENDER_ADDRESS, SENDER_CONTACT]
    .filter(Boolean)
    .join(" · ");
  const unsubLine = opts?.unsubscribeUrl
    ? `<p style="margin:8px 0 0;color:#999999;font-size:12px;">
            Vous recevez cet email professionnel car vos coordonnées sont publiques.
            <a href="${opts.unsubscribeUrl}" style="color:#999999;text-decoration:underline;">Se désinscrire</a>
          </p>`
    : "";
  const taglineRow = tagline.trim()
    ? `<tr><td style="background:rgb(20,74,102);padding:14px 30px;text-align:center;">
          <p style="margin:0;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.3px;">
            ${tagline}
          </p>
        </td></tr>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="padding:28px 30px 20px;text-align:center;background:#ffffff;">
          <img src="${logo}" alt="Tag2Share" width="150" style="display:block;margin:0 auto;border:0;outline:none;">
        </td></tr>
        ${taglineRow}
        <tr><td style="padding:32px 30px;color:#1f2937;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:24px 30px;background-color:#f8f9fa;text-align:center;border-top:1px solid #e9ecef;">
          <p style="margin:0 0 12px;font-size:13px;">
            <a href="https://www.instagram.com/tag_2_share/" style="color:rgb(20,74,102);font-weight:600;text-decoration:none;">Instagram</a>
            <span style="color:#cccccc;">&nbsp;·&nbsp;</span>
            <a href="https://www.facebook.com/Tag2Share" style="color:rgb(20,74,102);font-weight:600;text-decoration:none;">Facebook</a>
            <span style="color:#cccccc;">&nbsp;·&nbsp;</span>
            <a href="https://www.linkedin.com/company/tag2share" style="color:rgb(20,74,102);font-weight:600;text-decoration:none;">LinkedIn</a>
          </p>
          <p style="margin:0;color:#999999;font-size:12px;">© ${new Date().getFullYear()} ${identityLine}</p>
          ${unsubLine}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
