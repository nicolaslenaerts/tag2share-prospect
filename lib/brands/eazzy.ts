/**
 * Marque Eazzy - accompagnement individuel pour construire soi-même son projet
 * web avec l'IA, sans savoir coder (Belgique francophone). Configuration
 * dérivée des fichiers qui font autorité dans le dépôt ~/Sites/eazzy :
 *   - eazzy-brief.md §1, §2, §4, §7                    → offre, cible, ton, prix
 *   - branding/logo-system/CHARTE-GRAPHIQUE.md §3       → couleurs et contrastes
 *   - marketing/kit-contenu/03-regles-ecriture.md §1-§3 → registre, interdits
 *   - web/public/llms.txt, web/src/app/mentions-legales → version publique, éditeur
 *
 * ⚠️ CE FICHIER N'EST PAS LE REGISTRE. Depuis la migration 0013, les marques
 * vivent en base et s'éditent dans /marques ; l'inscrire dans BRANDS
 * (lib/brands/index.ts) masquerait la ligne de base et rendrait toute
 * modification faite dans l'interface sans effet. Il est ici pour deux
 * raisons : c'est la SOURCE relue et typée de la migration 0020, et c'est la
 * seule forme où la charte Eazzy reste lisible à côté de ses justifications.
 * Après une modification dans /marques, la base fait foi et ce fichier
 * décrit l'état initial, pas l'état courant.
 *
 * ⚠️ Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
 * d'environnement à lire côté serveur (voir l'en-tête de 0013).
 *
 * Trois règles de la charte (§3) pilotent le thème ci-dessous :
 *   - l'orange Eazzy (#FF7A1A) est réservé aux grandes formes : bouton, filet ;
 *   - sur fond clair, le petit texte orange passe en orange profond (#C2410C),
 *     seule variante au-dessus du seuil de contraste (4,93:1) ;
 *   - un bouton orange reçoit du texte bleu encre (#142B3D), jamais blanc.
 *
 * Règles du brief qui pilotent les textes :
 *   - vouvoiement partout, « projet web » plutôt qu'« app » (décidé le
 *     02/10/2026), « accompagnement », « étape » et « premier appel » ;
 *   - c'est le client qui construit : on ne laisse jamais entendre l'inverse ;
 *   - aucune preuve n'existe encore (la bêta n'a rien produit) : aucun
 *     chiffre de résultat, aucun témoignage, aucun délai promis ;
 *   - un seul appel à l'action : le questionnaire, qui mène au premier appel.
 */
import { ctaButton } from "../email-html";
import type { BrandConfig } from "./types";

const ORANGE = "rgb(255,122,26)"; // Orange Eazzy, aplats
const INK = "#142B3D"; // Bleu encre, texte posé sur l'orange

export const eazzy: BrandConfig = {
  slug: "eazzy",
  name: "Eazzy",
  tagline:
    "Trouver les indépendants et PME dont l'idée de projet web attend dans un carnet",
  domains: ["eazzy.be"],
  // Même schéma que les autres marques (marketing.<domaine>). Ce nom ne
  // résout pas encore : il faut l'ajouter au projet Vercel de cet outil et
  // créer son CNAME AVANT d'activer la marque, sinon le lien de désinscription
  // des emails partis serait mort.
  appUrl: "https://marketing.eazzy.be",

  theme: {
    rgb: [255, 122, 26], // #FF7A1A : bouton, filet sous le logo
    textRgb: [194, 65, 12], // #C2410C : liens et texte sur fond clair
    onBrandHex: INK,
    // Mot-symbole complet sur fond blanc, publié par le site (499 × 164).
    // Le gabarit « minimal » le rend à 80 % de logoWidth, soit 120 × 39 px.
    logoUrl: "https://eazzy.be/brand/web/logo-email.png",
    logoAlt: "Eazzy",
    logoWidth: 150,
    monogram: "EZ",
  },

  shopUrl: "https://eazzy.be/",

  email: {
    // L'accompagnement est « seul à seul » : un email qui ressemble à un
    // message écrit par Nicolas sert mieux la promesse qu'une newsletter.
    layout: "minimal",
    // Une seule offre principale, au prix affiché : l'encart « À découvrir
    // aussi » n'aurait rien d'autre à proposer qu'elle-même.
    showProductsMore: false,
    // Les trois comptes de la marque, tels que le site les publie. Le profil
    // LinkedIn personnel de Nicolas n'y figure pas : c'est un canal à part.
    socials: [
      { label: "LinkedIn", url: "https://www.linkedin.com/company/eazzybe" },
      { label: "Instagram", url: "https://www.instagram.com/eazzy.be" },
      { label: "Facebook", url: "https://www.facebook.com/cree.avec.eazzy" },
    ],
  },

  sender: {
    // send.eazzy.be est vérifié chez Resend (même compte que les autres
    // marques). La prospection sort de ce sous-domaine et non de eazzy.be,
    // qui envoie les emails attendus du site (confirmations de rendez-vous) :
    // une plainte sur la prospection ne doit pas les entacher.
    // Nom affiché identique à celui des emails du site (web/src/lib/emails.ts).
    fromName: "Nicolas · Eazzy",
    from: "nicolas@send.eazzy.be",
    replyTo: "nicolas@eazzy.be",
    testEmail: "nicolas.lenaerts@gmail.com",
    // Éditeur tel que publié dans les mentions légales du site.
    identity: {
      name: "Eazzy, Nicolas Lenaerts (BCE 0809.247.541)",
      address: "Chemin de la Forêt 26, 6120 Ham-sur-Heure-Nalinnes, Belgique",
      contact: "eazzy.be",
    },
    // Sous-domaine neuf en prospection : montée en charge lente.
    dailyCap: 20,
    delayMs: 1500,
  },

  defaultProductKey: "general",

  products: [
    {
      key: "general",
      // « Avec Eazzy, vous construisez... » : le conducteur que le brief
      // impose aux réels (§4) se lit aussi naturellement dans un email.
      name: "Eazzy",
      uiLabel: "Général (offre complète)",
      shopUrl: "https://eazzy.be/",
      configUrl: "https://eazzy.be/questionnaire",
      description:
        "Un accompagnement individuel, en visio, pour construire soi-même son projet web (site, boutique en ligne, application, outil interne) avec l'IA, sans savoir coder. Ce n'est pas un cours tout fait : la méthode est toujours la même, en 4 étapes, mais chaque étape se construit autour du projet du client. Le client travaille sur son propre ordinateur et montre son écran ; Nicolas le guide, il ne fait jamais à sa place. Avant tout, un premier appel gratuit de 30 minutes, « Parlons de votre projet », dont l'idée reste confidentielle. Le client garde la propriété de son projet et de son idée.",
      pitch:
        "votre projet web, construit par vous, guidé pas à pas, pour que vous sachiez continuer seul.",
      aliases: ["general", "général", "global", "offre complète", "complet", "eazzy"],
    },
    {
      key: "pack-base",
      // Nom employé dans une phrase : « Avec l'accompagnement en 4 étapes, ».
      // « Pack Décollage » n'est qu'un nom provisoire (brief §7), absent du site.
      name: "l'accompagnement en 4 étapes",
      uiLabel: "Accompagnement en 4 étapes (500 €)",
      price: "500 € (TVA non applicable)",
      shopUrl: "https://eazzy.be/#prix",
      configUrl: "https://eazzy.be/questionnaire",
      description:
        "4 étapes d'une heure en visio, seul à seul, à un rythme fixé ensemble. Étape 1 : les outils et ce que le projet doit faire. Étape 2 : l'organisation du projet et son image de marque. Étape 3 : on installe tout et on commence à construire. Étape 4 : on termine et on prépare la suite. Inclus : des conseils pour choisir les outils et services, l'attention portée aux points à risque (sécurité, confidentialité, RGPD), des fiches pour avancer entre les étapes, l'enregistrement de chaque étape (vidéo, texte de ce qui a été dit, résumé) et un plan clair pour la suite. 500 €, TVA non applicable. Un abonnement à l'IA, autour de 25 € par mois pour commencer, reste à la charge du client.",
      pitch:
        "une première version qui fonctionne, construite par vous en 4 étapes, et la méthode pour la faire grandir.",
      aliases: ["pack de base", "pack décollage", "décollage", "4 étapes", "quatre étapes", "500"],
    },
  ],

  ai: {
    positioning:
      "Eazzy est un accompagnement individuel, en visio, créé en Belgique par Nicolas Lenaerts : il apprend à des personnes qui ne savent pas coder à construire elles-mêmes leur projet web (site, boutique en ligne, application, outil interne) avec l'IA. Le principe : ne jamais faire à la place du client. Il travaille sur son propre ordinateur et montre son écran, Nicolas le guide. Nicolas travaille depuis 20 ans dans le digital et la communication et pourrait construire le projet lui-même : il choisit d'apprendre au client à le faire. Ce n'est pas un cours tout fait : la méthode est toujours la même, en 4 étapes d'une heure, mais chaque étape se construit autour du projet du client. Ce n'est pas de la magie non plus : pas besoin de savoir coder, mais il faut être à l'aise avec un ordinateur et prêt à mettre les mains dedans, au moins une heure par semaine entre les étapes. Le prix est affiché : 500 € pour les 4 étapes, TVA non applicable ; un abonnement à l'IA, autour de 25 € par mois pour commencer, reste à la charge du client. Avant tout, un premier appel gratuit de 30 minutes, « Parlons de votre projet », vérifie que le projet convient à la méthode et que la méthode convient à la personne ; l'idée reste confidentielle, et Nicolas s'engage à ne jamais la reprendre pour la réaliser lui-même. Le résultat : une première version qui fonctionne, avec une fonctionnalité clé, et la méthode pour continuer seul. Jamais plus de 5 personnes par mois, pour garder le temps de suivre chaque projet. Les cibles : l'indépendant débrouillard (coach, photographe, artisan, consultant) qui paie un abonnement à un outil qui ne lui ressemble pas, ou qui a renoncé devant un devis d'agence ; le profil « digital » d'une PME, qui gère déjà le site ou les fichiers Excel et veut transformer un tableur en outil interne (c'est souvent l'entreprise qui paie) ; le porteur d'une idée à tester avant d'investir ; le créatif qui imagine déjà ses écrans. Les lieux qui conseillent des indépendants (coworkings, incubateurs, guichets d'entreprise, comptables) se démarchent comme relais : on leur propose de faire connaître Eazzy à leurs membres ou clients. Le message tient sur trois axes : l'autonomie (c'est vous qui construisez, et vous saurez continuer seul), l'accessibilité (pas besoin de savoir coder, prix affiché) et l'exigence (peu de places, un engagement demandé). Les mots restent ceux de tous les jours : on simplifie les mots, jamais le fond. L'action proposée est unique : répondre au questionnaire, qui prend environ une minute, pour réserver le premier appel gratuit, ou simplement répondre à l'email.",
    signature: "Nicolas · Eazzy",
    // Les règles de langage et de contenu du brief (§1, §4, §7, §10) et du
    // kit d'écriture (§2), retournées en interdits. Une seule entrée par
    // règle : le prompt les reprend telles quelles.
    forbidden: [
      "le tutoiement, sous toutes ses formes : le vouvoiement s'applique partout",
      "« app » ou « application » pour parler du projet du prospect en général : on dit « votre projet web », puis « votre projet ». « App » ne reste que dans un exemple concret (une app de réservation)",
      "« cours », « formation », « séance », « appel de sélection » : on dit accompagnement, étape, premier appel ou « Parlons de votre projet »",
      "laisser entendre que Nicolas construit le projet à la place du prospect : c'est le client qui construit, guidé. L'autre formule, où Nicolas construit, n'a ni prix ni conditions : ne pas la proposer, au plus dire qu'on peut en parler pendant le premier appel",
      "un chiffre, un délai ou un résultat qui n'a pas été mesuré (« en 4 heures », « deux fois plus vite », « des dizaines de clients »), et tout témoignage ou projet client présenté comme réel : aucune preuve n'est encore publiée",
      "l'IA en sujet de phrase (« l'IA crée votre site ») : c'est la personne qui construit, avec l'aide de l'IA",
      "les superlatifs, la « magie » et les points d'exclamation : révolutionnaire, incroyable, puissant, magique, ultime",
      "le jargon : optimiser, digitaliser, fluidifier, centraliser, clé en main, innovant, intuitif, performant, process, solution, plateforme, MVP, stack, no-code. Un terme technique inévitable se dit avec ce qu'il fait",
      "toute garantie de sécurité, de conformité RGPD ou de résultat : on parle de conseils et de points de vigilance, le projet reste celui du client",
      "une urgence ou une rareté inventée (« plus que 2 places », « offre limitée », « dernière chance ») : seul l'engagement permanent, jamais plus de 5 personnes par mois, peut être cité",
      "une remise, une promotion, un essai gratuit ou un autre prix que 500 € pour les 4 étapes ; écrire un montant à l'anglaise",
      "le détail du contenu des étapes, des devoirs ou des exercices : seul le résumé public des 4 étapes peut être cité",
      "une fonction, un titre ou un employeur de Nicolas",
      "un atelier, un webinaire ou une date qui n'a pas été annoncé",
    ],
  },

  defaults: {
    subject: "{{name}} : et si vous construisiez vous-même l'outil qui vous manque ?",
    // Baseline du site, au mot près (kit §6 : identique partout).
    tagline: "Votre idée de projet web. Construite par vous.",
    body: `<p>Bonjour {{contact_name}},</p>

<p>Un abonnement à un outil qui ne vous ressemble pas, ou un fichier Excel qui grossit chaque mois : l'idée d'un outil à vous est souvent là depuis longtemps. Puis arrive le devis d'une agence, et l'idée retourne dans un carnet.</p>

<p>Avec <strong>{{product_name}}</strong>, vous construisez vous-même la première version de votre projet web, en vous aidant de l'IA, sans savoir coder. Vous travaillez sur votre ordinateur et vous me montrez votre écran : c'est vous qui construisez, je vous guide.</p>

<ul style="padding-left:18px;">
  <li>4 étapes d'une heure en visio, seul à seul, à un rythme fixé ensemble.</li>
  <li>Chaque étape est enregistrée : la vidéo, le texte de ce qui a été dit et un résumé.</li>
  <li>À la fin, une première version qui fonctionne, et la méthode pour continuer seul.</li>
</ul>

<p>Le prix est affiché : 500 € pour les 4 étapes. Avant, un premier appel gratuit de 30 minutes pour parler de votre projet. Votre idée reste entre nous : je m'engage à ne jamais la reprendre pour la réaliser moi-même.</p>

${ctaButton("Parlons de votre projet", "{{config_url}}", ORANGE, INK)}

<p>Le questionnaire prend environ une minute. Vous pouvez aussi répondre directement à cet email.</p>

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>Nicolas · Eazzy</strong><br/>
<a href="{{product_url}}">eazzy.be</a></p>`,
  },
};
