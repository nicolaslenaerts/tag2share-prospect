/**
 * GABARIT de marque, conservé comme RÉFÉRENCE DE FORME.
 *
 * ⚠️ Ce n'est plus le chemin normal. Depuis la migration 0013, une marque se
 * crée dans l'interface : /marques → « Nouvelle marque ». Elle est validée,
 * stockée en base et modifiable sans redéploiement, et elle naît en brouillon
 * (aucun envoi réel avant activation explicite).
 *
 * Ce fichier reste utile pour deux choses :
 *   - lire, avec l'aide de TypeScript, ce que contient un BrandConfig ;
 *   - déclarer une marque que l'on veut délibérément soustraire à l'interface,
 *     en l'ajoutant au tableau BRANDS de lib/brands/index.ts. Elle prendra
 *     alors le pas sur toute ligne de base du même slug.
 *
 * Restent à faire à la main, dans les deux cas : vérifier le domaine d'envoi
 * chez Resend, et y enregistrer le webhook <URL publique>/api/webhooks/resend.
 *
 * Rappel : ce fichier est importé côté navigateur (aperçu d'email). Aucun
 * secret, aucune lecture de process.env - seulement des NOMS de variables,
 * lesquels ne sont d'ailleurs PAS repris pour une marque stockée en base.
 */
import { ctaButton } from "../email-html";
import type { BrandConfig } from "./types";

const COLOR = "rgb(124,45,18)";

export const exemple: BrandConfig = {
  slug: "exemple",
  name: "Ma Seconde Marque",
  tagline: "Trouver des business pour la gamme Exemple",
  // Seuls les liens vers ces domaines reçoivent les paramètres UTM.
  domains: ["exemple.com"],
  theme: {
    rgb: [124, 45, 18],
    logoUrl: "https://exemple.com/logo-email.png",
    logoAlt: "Ma Seconde Marque",
    logoWidth: 140,
    monogram: "MS",
  },
  shopUrl: "https://exemple.com/boutique",

  email: {
    // Gabarit distinct de Tag2Share : voir lib/email-layouts/.
    layout: "minimal",
    // Mettre false si le catalogue est une grille de formules : l'encart
    // « À découvrir aussi » listerait alors les paliers tarifaires.
    // showProductsMore: false,
    socials: [{ label: "LinkedIn", url: "https://www.linkedin.com/company/exemple" }],
  },

  sender: {
    // Défauts seulement : l'adresse d'envoi réelle se saisit dans /reglages et
    // est stockée en base. La clé API Resend est commune (RESEND_API_KEY).
    // Le domaine d'envoi doit être vérifié chez Resend.
    fromName: "Prénom de Ma Seconde Marque",
    from: "contact@reach.exemple.com",
    replyTo: "contact@exemple.com",
    testEmailEnv: "TEST_EMAIL_EXEMPLE",
    // Affiché dans le pied de l'email (RGPD : être identifiable + contact).
    identity: { name: "Ma Seconde Marque", contact: "exemple.com" },
    // Plafond et cadence PROPRES à cette marque : la réputation d'envoi se
    // joue par domaine, un domaine neuf doit monter en charge lentement.
    dailyCap: 20,
    dailyCapEnv: "DAILY_SEND_CAP_EXEMPLE",
    delayMs: 1500,
  },

  // Produit présélectionné à l'étape 1 (défaut : le premier du catalogue).
  // defaultProductKey: "produit-a",

  products: [
    // Pour une offre vendue globalement plutôt que par palier, ajouter en TÊTE
    // une entrée sans `price`, avec un `uiLabel` distinct :
    //   { key: "general", name: "Ma Marque", uiLabel: "Général (offre complète)", ... }
    // Placée en premier, elle sert aussi de repli aux valeurs inconnues.
    {
      key: "produit-a",
      name: "Produit A",
      price: "19,90 €",
      shopUrl: "https://exemple.com/boutique/produit-a",
      configUrl: "https://exemple.com/configurer/produit-a",
      description: "Description du produit A, telle qu'utilisée par l'IA.",
      pitch: "le bénéfice principal du produit A, en une demi-phrase.",
      aliases: ["a", "produit a"],
    },
    {
      key: "produit-b",
      name: "Produit B",
      price: "29,90 €",
      shopUrl: "https://exemple.com/boutique/produit-b",
      configUrl: "https://exemple.com/configurer/produit-b",
      description: "Description du produit B.",
      pitch: "le bénéfice principal du produit B.",
      aliases: ["b", "produit b"],
    },
  ],

  ai: {
    positioning:
      "Ma Seconde Marque vend « ce que vend la marque » à « sa cible », avec pour bénéfice clé « le bénéfice ».",
    signature: "L'équipe Ma Seconde Marque",
  },

  defaults: {
    subject: "{{name}} : « accroche courte, max ~60 caractères »",
    // Accroche sous le logo ; chaîne vide = masquée.
    tagline: "« accroche affichée sous le logo »",
    body: `<p>Bonjour {{contact_name}},</p>

<p>Une phrase qui montre que vous connaissez {{name}} et son contexte à {{city}}.</p>

<p>Pour {{name}}, je recommande le <strong>{{product_name}}</strong>.</p>

${ctaButton("Découvrir le {{product_name}}", "{{product_url}}", COLOR)}

<p style="text-align:center;margin:-8px 0 8px;">
  <a href="{{config_url}}">Personnaliser votre {{product_name}}</a>
</p>

{{products_more}}

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>L'équipe Ma Seconde Marque</strong></p>`,
  },
};
