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
 * Rend visibles les liens du corps : tout <a> SANS attribut style reçoit une
 * couleur de marque + soulignement + gras (les boutons, qui ont déjà un style, sont laissés tels quels).
 */
export function enhanceLinks(html: string): string {
  return html.replace(/<a\b(?![^>]*\bstyle=)([^>]*)>/gi, (_m, attrs) => {
    return `<a${attrs} style="color:${BRAND};font-weight:600;text-decoration:underline;">`;
  });
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
 * Les variables produit ({{product_*}}) sont résolues depuis le produit mis en
 * avant du segment d'ORIGINE du prospect (chaque destinataire voit son produit).
 */
export function buildRecipientEmail(args: {
  campaign: { subject: string; body_html: string; email_tagline?: string | null };
  recipient: { custom_subject?: string | null; custom_html?: string | null };
  prospect: Record<string, any>;
  segment?: {
    product?: string | null;
  } | null;
  overrideData?: Partial<MergeData>;
}): { subject: string; html: string } {
  const seg = args.segment;
  const data = mergeDataFromProspect(args.prospect, args.overrideData, seg?.product);
  const subjectTpl = args.recipient.custom_subject || args.campaign.subject;
  const bodyTpl = args.recipient.custom_html || args.campaign.body_html;
  const subject = noEmDash(renderMerge(subjectTpl, data));
  // Le header affiche TOUJOURS le logo Tag2Share (pas celui du prospect).
  // enhanceLinks garantit des liens visibles même si le template n'en stylise pas.
  // noEmDash : aucun email ne doit contenir le caractère "—".
  // L'accroche sous le logo est éditable par campagne (email_tagline).
  const html = noEmDash(
    wrapEmail(enhanceLinks(renderMerge(bodyTpl, data)), {
      tagline: args.campaign.email_tagline,
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
  opts?: { logoUrl?: string; tagline?: string | null }
): string {
  const logo = opts?.logoUrl || LOGO_URL;
  const tagline = opts?.tagline == null ? DEFAULT_TAGLINE : opts.tagline;
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
          <p style="margin:0;color:#999999;font-size:12px;">© ${new Date().getFullYear()} Tag2Share - Objets connectés NFC &amp; QR</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
