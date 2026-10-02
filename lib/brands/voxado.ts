/**
 * Marque Voxado - devis dictés sur chantier pour artisans et PME (Belgique et
 * France francophone). Configuration dérivée des fichiers qui font autorité
 * dans le dépôt ~/Sites/voxado :
 *   - design/tokens/voxado.tokens.css              → couleurs et rôles
 *   - design/Voxado - Identité visuelle.dc.html §06 → ton de voix, interdits
 *   - docs/spec-voxado.md §1, §2, §4.4             → produit, cible, grille
 *   - .env.example                                 → domaine d'envoi vérifié
 *
 * ⚠️ CE FICHIER N'EST PAS LE REGISTRE. Depuis la migration 0013, les marques
 * vivent en base et s'éditent dans /marques ; l'inscrire dans BRANDS
 * (lib/brands/index.ts) masquerait la ligne de base et rendrait toute
 * modification faite dans l'interface sans effet. Il est ici pour deux
 * raisons : c'est la SOURCE relue et typée de la migration 0017, et c'est la
 * seule forme où la charte Voxado reste lisible à côté de ses justifications.
 * Après une modification dans /marques, la base fait foi et ce fichier
 * décrit l'état initial, pas l'état courant.
 *
 * ⚠️ Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
 * d'environnement à lire côté serveur (voir l'en-tête de 0013). Les valeurs
 * ci-dessous sont donc des littéraux, et l'identité d'envoi se corrige dans
 * /reglages, qui reste prioritaire.
 *
 * Trois règles de la charte pilotent le thème ci-dessous :
 *   - ambre-500 (#E08300) est la couleur d'APLAT, avec l'encre par-dessus ;
 *   - ambre-700 (#B05F00) est la seule variante lisible en TEXTE sur blanc :
 *     c'est la valeur que la charte donne aux liens et au logo sur fond clair ;
 *   - le rouge appartient à l'état « enregistrement en cours » (#E30031) et
 *     ne sort jamais du produit : rien ici ne doit s'en approcher.
 */
import { ctaButton } from "../email-html";
import type { BrandConfig } from "./types";

const AMBER = "rgb(224,131,0)"; // ambre-500, aplats
const INK_ON_AMBER = "#1F2726"; // --vx-on-accent, encre posée sur l'ambre

export const voxado: BrandConfig = {
  slug: "voxado",
  name: "Voxado",
  tagline:
    "Trouver les artisans qui rédigent encore leurs devis le soir, au bureau",
  // voxado.be est le domaine principal, voxado.eu le secours (spec §1).
  // Le .com est un parking : l'inscrire ferait poser des UTM sur un domaine
  // qui ne nous appartient pas.
  domains: ["voxado.be", "voxado.eu"],
  // Les liens de désinscription des emails Voxado doivent sortir sur un
  // domaine Voxado. Ce nom doit pointer sur le MÊME déploiement que cet outil :
  // la signature du lien est vérifiée par le serveur qui le reçoit.
  appUrl: "https://marketing.voxado.be",

  theme: {
    rgb: [224, 131, 0], // ambre-500 : bouton, filets
    textRgb: [176, 95, 0], // ambre-700 : liens et texte sur fond clair
    onBrandHex: INK_ON_AMBER, // encre sur ambre, seule combinaison de la charte
    // Le site ne publie pas de logotype horizontal ; l'icône d'application est
    // le symbole sur aplat ambre, opaque et donc visible sur le fond blanc du
    // gabarit. Largeur réduite en conséquence : le gabarit « minimal » rend
    // 80 % de logoWidth, soit 58 px pour un carré.
    logoUrl: "https://www.voxado.be/icone-192.png",
    logoAlt: "Voxado",
    logoWidth: 72,
    monogram: "Vx",
  },

  // Pas de page de tarifs publique : le site est une page unique dont le point
  // de conversion est la demande d'accès (#demande).
  shopUrl: "https://www.voxado.be/",

  email: {
    // La cible est un chauffagiste de 35 à 60 ans, pas un early adopter : un
    // email qui ressemble à un message écrit passe mieux qu'une newsletter.
    layout: "minimal",
    // La grille tarifaire n'est pas publiée et les accès s'ouvrent par petits
    // groupes : lister les paliers sous un email de prospection vendrait un
    // abonnement qu'on ne peut pas encore souscrire.
    showProductsMore: false,
    // Les visuels sociaux existent (design/social) mais aucune URL de page
    // publique ne figure dans le dépôt : à compléter plutôt qu'à deviner.
    socials: [],
  },

  sender: {
    // send.voxado.be est le sous-domaine d'envoi déjà vérifié chez Resend.
    // devis@send.voxado.be sert les emails du produit (envoi d'un devis au
    // client de l'artisan) : la prospection prend une adresse distincte, pour
    // qu'une plainte sur la prospection n'entache pas les emails attendus.
    fromName: "Nicolas de Voxado",
    from: "nicolas@send.voxado.be",
    replyTo: "bonjour@voxado.be",
    identity: { name: "Voxado", contact: "voxado.be" },
    // Sous-domaine neuf en prospection : montée en charge lente.
    dailyCap: 20,
    delayMs: 1500,
    testEmail: "nicolas.lenaerts@gmail.com",
  },

  // Présélection : l'offre globale. En prospection à froid on parle du geste
  // et du problème, pas du palier tarifaire.
  defaultProductKey: "general",

  // Grille v4.5 (spec §4.4), prix mensuels HTVA. Les trois forfaits ne sont
  // que trois points sur la droite « 19 € d'accès + 0,040 € par crédit » : un
  // quatrième palier se calcule, il ne se négocie pas.
  products: [
    {
      key: "general",
      // « Voxado » se lit dans une phrase (« Voxado retrouve vos références »),
      // « Général » se lit dans un menu déroulant.
      name: "Voxado",
      uiLabel: "Général (offre complète)",
      // Pas de prix : cette entrée présente le produit, pas un palier.
      shopUrl: "https://www.voxado.be/",
      configUrl: "https://www.voxado.be/#demande",
      description:
        "Le devis dicté sur place. L'artisan dicte ce qu'il faut faire, Voxado transcrit, retrouve les produits dans son propre catalogue avec ses prix, calcule les totaux et la TVA, génère le PDF et l'envoie au client. Catalogue importé depuis un fichier fournisseur. Fichier clients de l'entreprise, partagé entre les utilisateurs du compte. Question posée quand une ligne est ambiguë, plutôt qu'un devis faux. Consommation en crédits, proportionnelle à la longueur du devis. Taux de TVA belges et français, numéro d'entreprise et mentions légales sur le document. Hébergement européen, support en français. Ce que Voxado ne fait pas, et ne fera pas : ni facturation, ni paiement, ni planning, ni gestion de chantier.",
      pitch:
        "le devis parti avant de quitter le chantier, avec les références et les prix du catalogue de l'artisan.",
      aliases: ["general", "général", "global", "offre complète", "complet"],
    },
    {
      key: "starter",
      name: "Starter",
      price: "39 € / mois HTVA",
      shopUrl: "https://www.voxado.be/",
      configUrl: "https://www.voxado.be/#demande",
      description:
        "Un utilisateur, 500 crédits par mois. Le devis vocal complet : catalogue, fichier clients, PDF et envoi. Pour l'artisan qui travaille seul.",
      pitch: "le devis vocal complet, pour un artisan qui travaille seul.",
      aliases: ["starter", "39"],
    },
    {
      key: "pro",
      name: "Pro",
      price: "59 € / mois HTVA",
      shopUrl: "https://www.voxado.be/",
      configUrl: "https://www.voxado.be/#demande",
      description:
        "Un utilisateur, 1 000 crédits par mois. Mêmes fonctions que Starter, avec deux fois la capacité : pour une entreprise qui sort plusieurs devis par jour. Un utilisateur supplémentaire coûte 19 € par mois et apporte 300 crédits ; il travaille dans le catalogue et le fichier clients de l'entreprise, pas dans les siens.",
      pitch:
        "deux fois la capacité, et un second ouvrier à 19 € plutôt qu'un second abonnement.",
      aliases: ["pro", "59"],
    },
    {
      key: "premium",
      name: "Premium",
      price: "99 € / mois HTVA",
      shopUrl: "https://www.voxado.be/",
      configUrl: "https://www.voxado.be/#demande",
      description:
        "Un utilisateur, 2 000 crédits par mois. Mêmes fonctions, pour une entreprise dont le devis est quotidien. Utilisateurs supplémentaires à 19 € par mois, 300 crédits chacun.",
      pitch: "la capacité d'une entreprise qui devise tous les jours.",
      aliases: ["premium", "99"],
    },
  ],

  ai: {
    positioning:
      "Voxado est une plateforme belge où le devis se dicte. L'artisan est chez son client, il dicte ce qu'il faut faire, et le devis part en PDF avant qu'il ait quitté le chantier : Voxado transcrit, retrouve les produits dans SON catalogue avec SES prix, calcule les totaux et la TVA. La cible est l'artisan de Belgique et de France francophone (plomberie, électricité, chauffage, menuiserie, installation), structure de 1 à 5 personnes, 35 à 60 ans, peu d'appétence pour les logiciels et aucune minute à perdre. L'argument n'est ni la technologie ni le prix, c'est l'heure du soir : le devis se rédige aujourd'hui au bureau, de mémoire, plusieurs jours après la visite, et le client a parfois déjà signé ailleurs. Trois faits concrets portent le discours : la dictée tombe sur les références réelles du catalogue de l'artisan et non sur des lignes libres, un devis de trois lignes ne coûte pas le même prix qu'un devis de trente, et un second ouvrier est un siège à 19 € et non un second abonnement. Le périmètre est volontairement étroit, et c'est un argument : un seul métier, le devis, bien fait. Les accès s'ouvrent par petits groupes : l'action proposée est de demander un accès, jamais de souscrire.",
    signature: "L'équipe Voxado",
    // Les huit premiers points sont les règles d'écriture de la charte (§06 de
    // l'identité visuelle), retournées en interdits. Les deux derniers tiennent
    // à l'état réel du produit : promettre une fonction absente ou un
    // abonnement ouvert engage l'entreprise sur ce qu'elle ne livre pas.
    forbidden: [
      "« IA », « intelligence artificielle », « algorithme », « magie », « automatique » : dire ce qui se passe, « Voxado retrouve vos références »",
      "le tutoiement, sous toutes ses formes : le vouvoiement s'applique partout, y compris dans les messages d'erreur",
      "le vocabulaire du logiciel à la place de celui du métier : « item », « workflow », « dashboard », « lead », « template ». On dit devis, ligne, référence, main d'œuvre",
      "les superlatifs et les points d'exclamation : « incroyable », « révolutionnaire », « la solution ultime »",
      "les étoiles, émojis et autres signes de « magie » dans le sujet comme dans le corps",
      "écrire un montant à l'anglaise : c'est 1 519,90 € (virgule décimale, espace pour les milliers, euro après le nombre), et les prix s'annoncent HTVA",
      "promettre une fonction qui n'existe pas : facturation, paiement, planning, gestion ou suivi de chantier, signature électronique, comptabilité",
      "laisser croire que l'abonnement est ouvert à tous immédiatement : les accès s'ouvrent par petits groupes, on demande un accès",
      "annoncer un tarif, une remise, une promotion ou une durée d'essai qui ne figure pas dans la grille : elle n'est pas publiée, un prix lâché en prospection devient une promesse",
      "toute garantie de conformité fiscale ou comptable, et toute formule laissant entendre que Voxado remplace le comptable",
    ],
  },

  defaults: {
    subject: "{{name}} : le devis part-il encore le soir, au bureau ?",
    tagline: "Le devis se dicte, sur le chantier",
    body: `<p>Bonjour {{contact_name}},</p>

<p>Une visite chez un client, trois radiateurs à remplacer, et le devis qui attend le soir. Le temps de retrouver les références et les prix, il part deux ou trois jours plus tard. Parfois, le client a déjà signé ailleurs.</p>

<p>Avec <strong>{{product_name}}</strong>, le devis se dicte sur place : « deux radiateurs Radson 600 par 1200 et trois vannes thermostatiques ». Il part en PDF avant que vous ayez quitté le chantier.</p>

<ul style="padding-left:18px;">
  <li>Les lignes tombent sur les références de votre catalogue, avec vos prix.</li>
  <li>Les totaux et la TVA sont calculés, le document porte vos mentions.</li>
  <li>Quand une ligne est ambiguë, la question vous est posée plutôt qu'un devis faux.</li>
</ul>

<p>Ni facturation, ni paiement, ni planning : un seul métier, le devis.</p>

${ctaButton("Voir comment ça marche", "{{product_url}}", AMBER, INK_ON_AMBER)}

<p style="text-align:center;margin:-8px 0 8px;">
  <a href="{{config_url}}">Demander un accès</a>
</p>

<p>Nous ouvrons les accès par petits groupes, pour suivre chaque entreprise au départ. Si le sujet vous parle, répondez à cet email : je vous montre le parcours en quelques minutes.</p>

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>L'équipe Voxado</strong><br/>
<span style="color:#888;">Le devis se dicte · voxado.be</span></p>`,
  },
};
