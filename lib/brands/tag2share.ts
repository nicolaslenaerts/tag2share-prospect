/**
 * Marque Tag2Share - objets connectés NFC + QR code.
 * Extraction à l'identique de l'identité qui était câblée dans lib/email.ts,
 * lib/products.ts et lib/resend.ts avant le passage multi-marque.
 */
import { ctaButton } from "../email-html";
import type { BrandConfig } from "./types";

const COLOR = "rgb(20,74,102)";

export const tag2share: BrandConfig = {
  slug: "tag2share",
  name: "Tag2Share",
  tagline:
    "Trouver des business pour vos objets connectés (porte-clé, carte, présentoir)",
  domains: ["tag2share.com"],
  theme: {
    rgb: [20, 74, 102],
    logoUrl:
      "https://rfvjlmojryoovnpyotgf.supabase.co/storage/v1/object/public/mail/tag2share-logo.png",
    logoAlt: "Tag2Share",
    logoWidth: 150,
    monogram: "T2",
  },
  shopUrl: "https://www.tag2share.com/shop/category/objets-connectes-9",

  email: {
    layout: "classic",
    socials: [
      { label: "Instagram", url: "https://www.instagram.com/tag_2_share/" },
      { label: "Facebook", url: "https://www.facebook.com/Tag2Share" },
      { label: "LinkedIn", url: "https://www.linkedin.com/company/tag2share" },
    ],
  },

  // Défauts d'expédition : surchargeables dans /reglages (table brand_settings).
  sender: {
    fromName: "Nicolas de Tag2Share",
    from: "nicolas@reach.tag2share.com",
    fromEnv: "RESEND_FROM",
    replyTo: "nicolas@tag2share.com",
    replyToEnv: "RESEND_REPLY_TO",
    testEmailEnv: "TEST_EMAIL",
    identity: { name: "Tag2Share", contact: "tag2share.com" },
    dailyCap: 50,
    dailyCapEnv: "DAILY_SEND_CAP",
    delayMs: 1200,
    delayMsEnv: "SEND_DELAY_MS",
  },

  products: [
    {
      key: "keyring",
      name: "Porte-clé connecté",
      price: "14,90 €",
      shopUrl:
        "https://www.tag2share.com/shop/objets-connectes-9/porte-cle-connecte-5",
      configUrl: "https://app.tag2share.com/customize/keyring/",
      description:
        "Porte-clé NFC + QR code. Au contact d'un smartphone, il ouvre instantanément une page (profil, menu, avis Google, réseaux sociaux, site web…).",
      pitch:
        "votre vitrine toujours sur vous : partagez profil, avis et réseaux en un geste, partout.",
      aliases: ["porte-clé", "porte-cle", "porte cle", "keyring"],
    },
    {
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
      aliases: ["card", "carte", "visite"],
    },
    {
      key: "stand",
      name: "Présentoir connecté",
      price: "34,90 €",
      shopUrl:
        "https://www.tag2share.com/shop/objets-connectes-9/presentoir-connecte-7",
      configUrl: "https://app.tag2share.com/customize/stand/",
      description:
        "Présentoir de comptoir NFC + QR code. Posé en boutique/accueil, il invite les clients à scanner pour laisser un avis Google, suivre les réseaux ou consulter le menu.",
      pitch:
        "posé sur le comptoir, irrésistible à scanner : un flux régulier d'avis Google 5★ et d'abonnés.",
      aliases: ["stand", "présentoir", "presentoir"],
    },
  ],

  ai: {
    positioning:
      "Tag2Share vend des objets connectés (NFC + QR code) qui transforment un client satisfait en ambassadeur : plus d'avis Google, plus d'abonnés sur les réseaux, partage de coordonnées sans contact.",
    signature: "L'équipe Tag2Share",
  },

  defaults: {
    subject: "{{name}} : et si chaque client laissait un avis 5★ en 1 geste ?",
    tagline: "Plus d'avis ⭐  ·  Plus d'abonnés 📈  ·  Zéro contact 💳",
    body: `<p style="font-size:20px;font-weight:700;color:${COLOR};margin:0 0 16px;">
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

${ctaButton("Voir le {{product_name}}", "{{product_url}}", COLOR, "#ffffff")}

<p style="text-align:center;margin:-8px 0 8px;">
  <a href="{{config_url}}" style="color:${COLOR};font-weight:600;">🎨 Personnaliser votre {{product_name}} dans le configurateur →</a>
</p>

<p>Je serais ravi de vous préparer un exemple personnalisé pour <strong>{{name}}</strong>. Quelques minutes cette semaine&nbsp;?</p>

{{products_more}}

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>L'équipe Tag2Share</strong><br/>
<span style="color:#888;">Objets connectés NFC &amp; QR · tag2share.com</span></p>`,
  },
};
