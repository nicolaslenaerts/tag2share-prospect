/**
 * Marque Horodo - enregistrement du temps de travail et preuve opposable
 * (Belgique). Configuration dérivée des fichiers qui font autorité dans le
 * dépôt ~/Sites/horodo :
 *   - brand/charte-graphique.md et brand/tokens.css   → couleurs
 *   - doc-ia/horodo_recap_pricing.md (v4, 30/08/2026) → formules et prix
 *   - doc-ia/timesheet-solution-belgique-2027.md §5   → positionnement, interdits
 *   - web/.env.example                                → domaine d'envoi vérifié
 *
 * ⚠️ Deux règles de la charte pilotent le thème ci-dessous :
 *   - l'ambre est la couleur de MARQUE, jamais un état ni un avertissement ;
 *   - « Encre #0B1520 sur ambre-500 » est la SEULE combinaison autorisée pour
 *     un bouton ambre. D'où `onBrandHex` : un libellé blanc sur ambre tomberait
 *     à ~1,9:1 de contraste, illisible et contraire à la charte.
 *   - ambre-500 n'est pas lisible en texte sur fond clair ; ambre-700 (#9A5B00,
 *     5,43:1) est la seule variante de texte autorisée. D'où `textRgb`.
 */
import { ctaButton } from "../email-html";
import type { BrandConfig } from "./types";

const AMBER = "rgb(255,176,32)"; // amber-500, signature
const AMBER_TEXT = "rgb(154,91,0)"; // amber-700, seule variante lisible en texte
const INK = "#0B1520"; // ink-950, seule encre autorisée sur l'ambre

export const horodo: BrandConfig = {
  slug: "horodo",
  name: "Horodo",
  tagline:
    "Trouver les employeurs à main-d'œuvre de terrain qui doivent enregistrer le temps de travail",
  // Les deux domaines de la marque : seuls leurs liens reçoivent les UTM.
  domains: ["horodo.be", "horodo.eu"],
  theme: {
    rgb: [255, 176, 32], // amber-500 : fonds, bandeau, bouton
    textRgb: [154, 91, 0], // amber-700 : liens et texte sur fond clair
    onBrandHex: INK, // encre sur ambre, 10,05:1
    logoUrl: "https://www.horodo.be/logotype.png",
    logoAlt: "Horodo",
    logoWidth: 160,
    monogram: "Ho",
  },
  shopUrl: "https://www.horodo.be/tarifs",

  email: {
    // Gabarit sobre : la charte proscrit le décoratif, et la cible (patrons de
    // PME, comptables) répond mieux à un email qui ressemble à un message écrit
    // qu'à une newsletter.
    layout: "minimal",
    // Les quatre comptes existent (plan de publication organique) mais leurs
    // URL publiques ne figurent nulle part dans le dépôt : à compléter plutôt
    // qu'à deviner. Un tableau vide masque proprement la ligne dans l'email.
    socials: [],
  },

  sender: {
    // send.horodo.be est le domaine d'envoi déjà vérifié côté application
    // Horodo (diagnostic@, notifications@). L'adresse exacte se règle dans
    // /reglages ; celle-ci n'est qu'un défaut.
    fromName: "Nicolas de Horodo",
    from: "nicolas@send.horodo.be",
    replyTo: "hello@horodo.be",
    identity: { name: "Horodo", contact: "horodo.be" },
    // Domaine d'envoi neuf en prospection : on monte lentement en charge.
    dailyCap: 20,
    dailyCapEnv: "DAILY_SEND_CAP_HORODO",
    delayMs: 1500,
    testEmailEnv: "TEST_EMAIL_HORODO",
  },

  // Le « catalogue » d'Horodo, ce sont les trois formules d'abonnement.
  // Prix mensuels hors TVA, par entreprise (pricing v4 du 30/08/2026).
  // configUrl pointe vers le diagnostic de conformité : en prospection à froid,
  // un diagnostic gratuit convertit mieux qu'une page de tarifs.
  products: [
    {
      key: "starter",
      name: "Starter",
      price: "19 EUR / mois",
      shopUrl: "https://www.horodo.be/tarifs",
      configUrl: "https://www.horodo.be/diagnostic",
      description:
        "Jusqu'à 5 utilisateurs. Le pointage et sa preuve pour un employeur d'un seul lieu : pointage par gsm, badge ou kiosque sur tablette, journal en ajout seul, mode CIaO, fonctionnement hors réseau, solde consultable par le travailleur, export destiné à l'inspection sociale.",
      pitch:
        "le pointage et sa preuve, pour un employeur d'un seul lieu qui ne suit pas de chantiers.",
      aliases: ["starter", "micro", "19"],
    },
    {
      key: "pro",
      name: "Pro",
      price: "49 EUR / mois",
      shopUrl: "https://www.horodo.be/tarifs",
      configUrl: "https://www.horodo.be/diagnostic",
      description:
        "Jusqu'à 15 utilisateurs, toutes les fonctions, accessible dès un utilisateur. Tout le Starter, plus la feuille de temps par chantier, les accès en lecture seule illimités pour le comptable ou le secrétariat social, les règles par lieu et le multi-sites, et les compteurs par travailleur (flexi-job, temps partiel, travail de nuit).",
      pitch:
        "toutes les fonctions, dont la feuille de temps par chantier et l'accès comptable illimité.",
      aliases: ["pro", "49"],
    },
    {
      key: "entreprise",
      name: "Entreprise",
      price: "99 EUR / mois",
      shopUrl: "https://www.horodo.be/tarifs",
      configUrl: "https://www.horodo.be/diagnostic",
      description:
        "Jusqu'à 50 utilisateurs. Exactement les mêmes fonctions que Pro : la seule différence est le nombre d'utilisateurs. Au-delà de 50 travailleurs, l'offre se fait sur devis.",
      pitch:
        "les mêmes fonctions que Pro, pour les organisations jusqu'à 50 utilisateurs.",
      aliases: ["entreprise", "growth", "99"],
    },
  ],

  ai: {
    positioning:
      "Horodo enregistre le temps de travail là où les outils de paie ne vont pas : sur le terrain, hors réseau, sans smartphone personnel, et il en produit une preuve opposable. La cible est l'employeur belge à main-d'œuvre de terrain (construction, horeca, nettoyage et titres-services). L'argument n'est pas le prix ni la simplicité d'installation, c'est la distinction entre noter des heures et pouvoir les prouver : un fichier se réécrit, un encodage du vendredi n'est pas un enregistrement, une saisie par le chef d'équipe n'est pas un pointage. Trois faits techniques démontrables portent le discours : horodatage serveur, journal des corrections en ajout seul, export lisible sans installer quoi que ce soit. Les obligations à citer sont celles EN VIGUEUR aujourd'hui (enregistrement électronique des flexi-jobs depuis juillet 2026, avis d'horaire des temps partiels, horaires flottants, quotas d'heures supplémentaires volontaires et de travail étudiant, CIaO dans le nettoyage), jamais une obligation future présentée comme acquise.",
    signature: "L'équipe Horodo",
    // Repris mot pour mot de timesheet-solution-belgique-2027.md §5.1.
    // Ces formulations exposent juridiquement : aucune ne doit sortir de l'IA.
    forbidden: [
      "« certifié conforme », « certifié Belgique 2027 », « homologué », « agréé » : rien de tout cela n'existe",
      "« conforme INS » : cet organisme n'existe pas dans ce contexte",
      "toute affirmation que la loi entrera en vigueur à une date précise : l'obligation générale annoncée pour le 1er janvier 2027 n'est PAS votée et l'arrêté royal n'est pas publié",
      "toute affirmation qu'une catégorie d'employeurs « doit » enregistrer ou en est « dispensée » au titre de l'avant-projet : les deux sont faux en l'état",
      "tout score ou pourcentage de « probabilité d'audit » ou de « risque de contrôle » : c'est de la conformité fictive",
      "« conçu selon les critères de la jurisprudence européenne » et toute formule d'auto-déclaration de conformité",
      "toute promesse de mise en conformité (« vous serez en règle », « conformité garantie »)",
    ],
  },

  defaults: {
    subject: "{{name}} : comment prouvez-vous les heures de mardi dernier ?",
    tagline: "Le temps de travail capté sur le terrain, et sa preuve",
    body: `<p>Bonjour {{contact_name}},</p>

<p>Une question simple, posée telle quelle à un employeur de {{city}} la semaine dernière : « montrez-moi comment votre ouvrier a pointé mardi. » La réponse est presque toujours un tableur, un carnet, ou le chef d'équipe qui encode le vendredi de mémoire.</p>

<p>Noter des heures n'est pourtant pas pouvoir les prouver. Un fichier se réécrit. Un encodage du vendredi n'est pas un enregistrement. Une saisie par le chef d'équipe n'est pas un pointage.</p>

<p><strong>Horodo</strong> capte le geste au moment où il a lieu, même sans réseau, et en produit une trace vérifiable :</p>

<ul style="padding-left:18px;">
  <li>L'heure vient du serveur, pas du téléphone.</li>
  <li>Une correction s'ajoute au journal, elle n'écrase jamais la ligne d'origine.</li>
  <li>L'export s'ouvre sans compte et sans outil propriétaire.</li>
</ul>

<p>Pour une structure comme {{name}}, la formule <strong>{{product_name}}</strong> est en général le bon point de départ.</p>

${ctaButton("Voir les formules", "{{product_url}}", AMBER, INK)}

<p style="text-align:center;margin:-8px 0 8px;">
  <a href="{{config_url}}">Faire le point en 3 minutes sur vos obligations actuelles</a>
</p>

<p>Si le sujet vous concerne, je peux vous montrer le parcours en quelques minutes cette semaine.</p>

{{products_more}}

<p style="margin-top:24px;">Bien à vous,<br/>
<strong>L'équipe Horodo</strong><br/>
<span style="color:#888;">Enregistrement du temps de travail · horodo.be</span></p>`,
  },
};
