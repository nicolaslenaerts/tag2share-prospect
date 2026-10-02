/**
 * Outils MCP exposés à Claude Code.
 *
 * Chaque outil est un appel à l'API interne, plus deux choses que l'API ne
 * fait pas et que l'agent, lui, exige :
 *
 *  1. VALIDATION DE LA MARQUE avant toute écriture (voir brand.mjs) ;
 *  2. RÉDUCTION DE LA RÉPONSE. Une campagne renvoie tous ses destinataires
 *     avec le prospect joint : plusieurs milliers de lignes qu'un agent paierait
 *     en contexte sans jamais les lire. On renvoie des compteurs par statut, et
 *     l'agent va chercher le détail dans l'interface s'il en a besoin.
 */
import { request } from "./client.mjs";
import { BRAND_ARG, loadBrands, resolveBrandSlug, summarizeBrands } from "./brand.mjs";
import { SOCIAL_TOOLS } from "./social.mjs";

/* ------------------------------------------------------------------ */
/* Lectures                                                            */
/* ------------------------------------------------------------------ */

const listBrands = {
  name: "list_brands",
  description:
    "Liste les marques de l'outil (slug, nom, si l'envoi réel est autorisé). " +
    "Point d'entrée : toutes les autres opérations sont cloisonnées par marque.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    return { brands: summarizeBrands(await loadBrands({ refresh: true })) };
  },
};

const listSegments = {
  name: "list_segments",
  description:
    "Liste les segments d'une marque, avec le nombre de prospects rattachés. " +
    "Un segment est la cible d'une campagne.",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG },
    required: ["brand"],
    additionalProperties: false,
  },
  async run({ brand }) {
    const slug = await resolveBrandSlug(brand);
    const { segments } = await request("/api/segments", { brand: slug });
    return {
      brand: slug,
      segments: (segments ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        product: s.product,
        prospect_count: s.prospect_count,
        approved: s.approved,
        search_terms: s.search_terms,
      })),
    };
  },
};

const listCampaigns = {
  name: "list_campaigns",
  description:
    "Liste les campagnes d'une marque : statut, segments ciblés, variantes " +
    "d'email et validité de leur répartition (la somme des poids doit faire 100).",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG },
    required: ["brand"],
    additionalProperties: false,
  },
  async run({ brand }) {
    const slug = await resolveBrandSlug(brand);
    const { campaigns } = await request("/api/campaigns", { brand: slug });
    return { brand: slug, campaigns: (campaigns ?? []).map(summarizeCampaign) };
  },
};

const getCampaign = {
  name: "get_campaign",
  description:
    "Détail d'une campagne : segments, variantes (sujet + corps complets) et " +
    "répartition des destinataires par statut.",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG, campaign_id: { type: "string" } },
    required: ["brand", "campaign_id"],
    additionalProperties: false,
  },
  async run({ brand, campaign_id }) {
    const slug = await resolveBrandSlug(brand);
    const { campaign, recipients } = await request(
      `/api/campaigns/${encodeURIComponent(campaign_id)}`,
      { brand: slug }
    );
    return {
      brand: slug,
      campaign: {
        ...summarizeCampaign(campaign),
        product: campaign.product,
        email_tagline: campaign.email_tagline,
        variants: (campaign.variants ?? []).map(fullVariant),
        recipients_by_status: countBy(recipients ?? [], "status"),
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Écritures                                                           */
/* ------------------------------------------------------------------ */

const createCampaign = {
  name: "create_campaign",
  description:
    "Crée une campagne sur un ou plusieurs segments de la marque. La campagne " +
    "naît en brouillon avec une première variante d'email à 100 %. Les segments " +
    "doivent appartenir à la marque, sinon l'appel est refusé.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      name: { type: "string", description: "Nom interne de la campagne." },
      segment_ids: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Identifiants des segments ciblés (voir list_segments).",
      },
      subject: {
        type: "string",
        description: "Sujet de l'email. Par défaut : le sujet type de la marque.",
      },
      body_html: {
        type: "string",
        description: "Corps HTML de l'email. Par défaut : le corps type de la marque.",
      },
    },
    required: ["brand", "name", "segment_ids"],
    additionalProperties: false,
  },
  async run({ brand, name, segment_ids, subject, body_html }) {
    const slug = await resolveBrandSlug(brand);
    const { campaign } = await request("/api/campaigns", {
      method: "POST",
      brand: slug,
      body: { name, segment_ids, subject, body_html },
    });
    return { brand: slug, campaign: summarizeCampaign(campaign) };
  },
};

const addCampaignVariant = {
  name: "add_campaign_variant",
  description:
    "Ajoute une variante d'email (un template) à une campagne, pour tester " +
    "plusieurs textes. Sans « weight », les parts de TOUTES les variantes sont " +
    "réparties équitablement (100/n) ; sans « subject »/« body_html », la " +
    "nouvelle variante part d'une copie du texte existant. Les destinataires " +
    "encore en jeu sont redistribués immédiatement.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      campaign_id: { type: "string" },
      name: { type: "string", description: "Nom de la variante. Défaut : « Variante B », « C »..." },
      subject: { type: "string" },
      body_html: { type: "string" },
      email_tagline: {
        type: "string",
        description: "Accroche sous le logo. Chaîne vide = masquée.",
      },
      product: {
        type: "string",
        description:
          "Clé du produit mis en avant (override). Par défaut celui de la campagne.",
      },
      weight: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description:
          "Part d'envoi en %. Si omis, toutes les variantes sont ré-équilibrées.",
      },
      copy_from: {
        type: "string",
        description: "Id de la variante dont copier le texte.",
      },
    },
    required: ["brand", "campaign_id"],
    additionalProperties: false,
  },
  async run({ brand, campaign_id, ...body }) {
    const slug = await resolveBrandSlug(brand);
    const res = await request(
      `/api/campaigns/${encodeURIComponent(campaign_id)}/variants`,
      { method: "POST", brand: slug, body }
    );
    return variantsResult(slug, campaign_id, res, res.variant?.id);
  },
};

const setCampaignVariants = {
  name: "set_campaign_variants",
  description:
    "Met à jour les variantes d'une campagne en bloc : textes, noms et surtout " +
    "POIDS. Indispensable après avoir ajouté des variantes, car l'envoi refuse " +
    "de partir si la somme des parts ne fait pas exactement 100. L'ordre du " +
    "tableau devient l'ordre d'affichage.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      campaign_id: { type: "string" },
      variants: {
        type: "array",
        minItems: 1,
        description:
          "Variantes à mettre à jour. Seuls les champs fournis sont modifiés.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Id de la variante (obligatoire)." },
            name: { type: "string" },
            subject: { type: "string" },
            body_html: { type: "string" },
            email_tagline: { type: "string" },
            product: { type: "string" },
            weight: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
    },
    required: ["brand", "campaign_id", "variants"],
    additionalProperties: false,
  },
  async run({ brand, campaign_id, variants }) {
    const slug = await resolveBrandSlug(brand);
    const res = await request(
      `/api/campaigns/${encodeURIComponent(campaign_id)}/variants`,
      { method: "PATCH", brand: slug, body: { variants } }
    );
    return variantsResult(slug, campaign_id, res);
  },
};

export const TOOLS = [
  listBrands,
  listSegments,
  listCampaigns,
  getCampaign,
  createCampaign,
  addCampaignVariant,
  setCampaignVariants,
  ...SOCIAL_TOOLS,
];

/* ------------------------------------------------------------------ */
/* Mise en forme                                                       */
/* ------------------------------------------------------------------ */

function summarizeCampaign(c) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    created_at: c.created_at,
    segments: (c.segments ?? []).map((s) => ({ id: s.id, label: s.label })),
    variants: (c.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      weight: v.weight,
    })),
    variants_total_weight: c.variants_total_weight,
    variants_valid: c.variants_valid,
  };
}

function fullVariant(v) {
  return {
    id: v.id,
    name: v.name,
    weight: v.weight,
    subject: v.subject,
    body_html: v.body_html,
    email_tagline: v.email_tagline,
    product: v.product,
  };
}

/**
 * Réponse commune aux mutations de variantes. `valid` est ce que l'agent doit
 * regarder : false signifie que la campagne n'est PAS envoyable en l'état.
 */
function variantsResult(brand, campaignId, res, createdId) {
  return {
    brand,
    campaign_id: campaignId,
    created_variant_id: createdId,
    variants: (res.variants ?? []).map(fullVariant),
    total_weight: res.total_weight,
    valid: res.valid,
    ...(res.valid === false
      ? {
          warning:
            "La somme des parts ne fait pas 100 : l'envoi sera refusé. " +
            "Corriger avec set_campaign_variants.",
        }
      : null),
    distribution: res.distribution,
  };
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) out[r[key] ?? "null"] = (out[r[key] ?? "null"] ?? 0) + 1;
  return out;
}
