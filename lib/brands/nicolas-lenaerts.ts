/**
 * Marque Nicolas Lenaerts - le profil personnel, majoritairement des posts et
 * des carrousels sur l'IA. Elle sert UNIQUEMENT à programmer des publications
 * (/social, Buffer) : aucune prospection par email n'est prévue pour l'instant.
 * Configuration dérivée des fichiers qui font autorité dans
 * ~/Desktop/posts-perso :
 *   - charte-perso.md §1, §3, §8, §10 → voix, couleurs et contrastes, interdits
 *   - playbook-posts.md               → angle personnel, une idée par post
 *
 * ⚠️ CE FICHIER N'EST PAS LE REGISTRE. Comme pour Eazzy (voir l'en-tête de
 * lib/brands/eazzy.ts), il est la SOURCE relue et typée de la migration 0023
 * et n'est inscrit ni dans BRANDS ni dans SEED_BRANDS. Après une modification
 * dans /marques, la base fait foi.
 *
 * ⚠️ Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
 * d'environnement à lire côté serveur (voir l'en-tête de 0013).
 *
 * « Posts uniquement » ne se déclare nulle part dans BrandConfig : le contrat
 * exige un catalogue, une identité d'expédition et un modèle d'email pour
 * toutes les marques. La garantie vient d'ailleurs : la marque naît INACTIVE
 * (0023), donc l'envoi réel est refusé, alors que /social ne regarde pas ce
 * drapeau. Les champs d'email ci-dessous sont des valeurs honnêtes de
 * remplissage, à reprendre avant d'activer un jour la prospection.
 *
 * Trois règles de la charte (§3) pilotent le thème :
 *   - la base est graphite + papier, l'orange reste minoritaire : la couleur
 *     de signature de l'interface est donc le graphite (#171412), ce qui
 *     distingue aussi la marque d'Eazzy (orange) dans le sélecteur ;
 *   - l'orange revient en texte sur fond clair sous sa forme lisible, l'orange
 *     encre (#B4460A, 4,9:1 sur papier, davantage sur blanc) ;
 *   - le texte posé sur le graphite est le papier (#F6F2EC, 16,4:1).
 */
import type { BrandConfig } from "./types";

const LINKEDIN = "https://www.linkedin.com/in/nicolaslenaerts";

export const nicolasLenaerts: BrandConfig = {
  slug: "nicolas-lenaerts",
  name: "Nicolas Lenaerts",
  tagline: "Publications du profil personnel : l'IA, racontée par quelqu'un",
  // Aucun domaine personnel : rien à suivre en UTM. Pas d'appUrl non plus, le
  // lien « Ouvrir le post » des notifications retombe sur APP_URL.
  domains: [],

  theme: {
    rgb: [23, 20, 18], // #171412 graphite : boutons, monogramme
    textRgb: [180, 70, 10], // #B4460A orange encre : liens et accents
    onBrandHex: "#F6F2EC", // papier
    // Mot-symbole « Nicolas Lenaerts » + curseur orange (charte §6), rendu en
    // Bricolage Grotesque sur fond transparent, 3x pour les écrans denses.
    // Hébergé dans le bucket public social-media, hors des dossiers de
    // marque : un slug ne peut pas commencer par « _ », l'onglet Fichiers ne
    // le liste donc jamais comme orphelin.
    logoUrl:
      "https://umabxfhfsacnxbbsxwat.supabase.co/storage/v1/object/public/social-media/_marques/nicolas-lenaerts/logo-email.png",
    logoAlt: "Nicolas Lenaerts",
    logoWidth: 200,
    monogram: "NL",
  },

  shopUrl: LINKEDIN,

  email: {
    layout: "minimal",
    // Un seul « produit », le profil lui-même : rien à proposer en encart.
    showProductsMore: false,
    socials: [{ label: "LinkedIn", url: LINKEDIN }],
  },

  sender: {
    // Seul usage réel aujourd'hui : l'email « post publié » que /social
    // s'envoie à lui-même. Il faut pour cela un domaine vérifié chez Resend ;
    // send.eazzy.be l'est, sur le compte commun. À remplacer par un domaine
    // personnel avant toute prospection sous ce nom.
    fromName: "Nicolas Lenaerts",
    from: "nicolas@send.eazzy.be",
    replyTo: "nicolas.lenaerts@gmail.com",
    // Destinataire par défaut des notifications de publication.
    testEmail: "nicolas.lenaerts@gmail.com",
    // Pas d'adresse postale : une personne n'a pas à publier la sienne tant
    // qu'aucun email de prospection ne part. À compléter avant d'activer.
    identity: { name: "Nicolas Lenaerts", contact: "linkedin.com/in/nicolaslenaerts" },
    dailyCap: 20,
    delayMs: 1500,
  },

  defaultProductKey: "general",

  products: [
    {
      key: "general",
      name: "Nicolas Lenaerts",
      uiLabel: "Général (profil personnel)",
      shopUrl: LINKEDIN,
      configUrl: LINKEDIN,
      description:
        "Le profil LinkedIn personnel de Nicolas Lenaerts : des posts et des carrousels sur l'IA, écrits à la première personne, à partir de ce qu'il a testé, changé ou constaté. Aucune offre commerciale n'est portée par cette marque.",
      pitch: "l'IA expliquée clairement, à partir de ce qui a été testé pour de vrai.",
      aliases: ["general", "général", "perso", "personnel", "profil", "nicolas"],
    },
  ],

  ai: {
    positioning:
      "Nicolas Lenaerts travaille depuis 20 ans dans le digital et la communication, en Belgique. Cette marque est son profil personnel : ce n'est ni une entreprise ni une offre, c'est une personne qui parle, majoritairement d'IA. Ses contenus partent de ce qu'il a testé, changé ou constaté (« l'erreur que je faisais », « ce que j'ai vu »), jamais d'une définition. Trois impressions à donner, dans l'ordre : c'est clair, c'est concret, c'est quelqu'un (pas une marque). Une idée par message, un avis tranché plutôt qu'une leçon neutre, et une vraie question ouverte pour finir. Il a aussi créé Eazzy, un accompagnement pour construire soi-même son projet web avec l'IA ; il en parle environ une fois sur trois ou quatre, comme d'un projet personnel, jamais comme d'une publicité. Aucune prospection par email n'est prévue sous ce nom.",
    signature: "Nicolas Lenaerts",
    // Charte §8 et §10, playbook-posts.md, retournés en interdits.
    forbidden: [
      "le tiret cadratin : utiliser une virgule, deux-points ou des parenthèses",
      "la voix d'une entreprise (« nous », « notre équipe ») : c'est une personne qui parle, à la première personne",
      "ouvrir sur une définition ou une leçon neutre : ouvrir sur un angle personnel, une erreur faite, un constat vécu",
      "un chiffre, une date ou un point légal qui n'a pas été vérifié, et tout chiffre sans sa source",
      "les buzzwords et superlatifs : révolutionnaire, game changer, incroyable, magique, ultime",
      "présenter Eazzy comme une publicité ou glisser son argumentaire commercial : on peut en parler, comme d'un projet personnel",
      "plusieurs idées dans un même message",
    ],
  },

  defaults: {
    // Valeurs de remplissage exigées par le contrat. Une campagne créée par
    // erreur les reprendrait : elles se signalent d'elles-mêmes à la relecture,
    // et la marque inactive ne peut de toute façon rien envoyer.
    subject: "[À rédiger] Aucune prospection prévue sous ce nom",
    tagline: "",
    body: `<p>Bonjour,</p>

<p>[Modèle à rédiger. La marque Nicolas Lenaerts sert uniquement à programmer des publications : aucune campagne email n'est prévue pour l'instant.]</p>

<p>Nicolas Lenaerts</p>`,
  },
};
