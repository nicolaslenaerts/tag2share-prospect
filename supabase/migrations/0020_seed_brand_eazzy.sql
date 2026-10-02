-- ============================================================
-- 0020 : la marque Eazzy entre en base.
--
-- Eazzy : accompagnement individuel, en visio, pour construire soi-même son
-- projet web avec l'IA, sans savoir coder. Cible : indépendants, profils
-- « digital » en PME, porteurs d'idée et créatifs, en Belgique francophone.
--
-- La configuration ci-dessous est la SORTIE de lib/brands/eazzy.ts, passée
-- par parseBrandConfig (lib/brands/schema.ts) : elle est donc déjà normalisée
-- et valide. Ce fichier TypeScript n'est enregistré ni dans BRANDS ni dans
-- SEED_BRANDS - une entrée dans BRANDS masquerait cette ligne et rendrait
-- l'écran /marques sans effet sur la marque. Il documente l'état initial ;
-- passé la première modification dans /marques, la base fait foi.
--
-- `active = false` : la marque NAÎT EN BROUILLON. Segments, rédaction, aperçu
-- et emails de test fonctionnent déjà ; seul l'envoi réel reste bloqué. Trois
-- choses sont à vérifier avant de basculer l'interrupteur dans /marques :
--   1. marketing.eazzy.be résout et sert CETTE instance (à ajouter au projet
--      Vercel et en CNAME : il ne résout pas au 02/10/2026). Le lien de
--      désinscription est vérifié par le serveur qui le reçoit ;
--   2. nicolas@send.eazzy.be part bien du domaine vérifié chez Resend
--      (send.eazzy.be l'est, sur le compte commun) ;
--   3. un email de test est reçu et relu.
--
-- Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
-- d'environnement à lire côté serveur (voir l'en-tête de 0013).
--
-- Idempotent : `on conflict do nothing`.
-- ============================================================

insert into public.brands (slug, config, active)
values ('eazzy', $config$
{
  "slug": "eazzy",
  "name": "Eazzy",
  "tagline": "Trouver les indépendants et PME dont l'idée de projet web attend dans un carnet",
  "domains": [
    "eazzy.be"
  ],
  "appUrl": "https://marketing.eazzy.be",
  "theme": {
    "rgb": [
      255,
      122,
      26
    ],
    "textRgb": [
      194,
      65,
      12
    ],
    "onBrandHex": "#142B3D",
    "logoUrl": "https://eazzy.be/brand/web/logo-email.png",
    "logoAlt": "Eazzy",
    "logoWidth": 150,
    "monogram": "EZ"
  },
  "shopUrl": "https://eazzy.be/",
  "email": {
    "layout": "minimal",
    "socials": [
      {
        "label": "LinkedIn",
        "url": "https://www.linkedin.com/company/eazzybe"
      },
      {
        "label": "Instagram",
        "url": "https://www.instagram.com/eazzy.be"
      },
      {
        "label": "Facebook",
        "url": "https://www.facebook.com/cree.avec.eazzy"
      }
    ],
    "showProductsMore": false
  },
  "sender": {
    "fromName": "Nicolas · Eazzy",
    "from": "nicolas@send.eazzy.be",
    "replyTo": "nicolas@eazzy.be",
    "testEmail": "nicolas.lenaerts@gmail.com",
    "identity": {
      "name": "Eazzy, Nicolas Lenaerts (BCE 0809.247.541)",
      "address": "Chemin de la Forêt 26, 6120 Ham-sur-Heure-Nalinnes, Belgique",
      "contact": "eazzy.be"
    },
    "dailyCap": 20,
    "delayMs": 1500
  },
  "defaults": {
    "subject": "{{name}} : et si vous construisiez vous-même l'outil qui vous manque ?",
    "body": "<p>Bonjour {{contact_name}},</p>\n\n<p>Un abonnement à un outil qui ne vous ressemble pas, ou un fichier Excel qui grossit chaque mois : l'idée d'un outil à vous est souvent là depuis longtemps. Puis arrive le devis d'une agence, et l'idée retourne dans un carnet.</p>\n\n<p>Avec <strong>{{product_name}}</strong>, vous construisez vous-même la première version de votre projet web, en vous aidant de l'IA, sans savoir coder. Vous travaillez sur votre ordinateur et vous me montrez votre écran : c'est vous qui construisez, je vous guide.</p>\n\n<ul style=\"padding-left:18px;\">\n  <li>4 étapes d'une heure en visio, seul à seul, à un rythme fixé ensemble.</li>\n  <li>Chaque étape est enregistrée : la vidéo, le texte de ce qui a été dit et un résumé.</li>\n  <li>À la fin, une première version qui fonctionne, et la méthode pour continuer seul.</li>\n</ul>\n\n<p>Le prix est affiché : 500 € pour les 4 étapes. Avant, un premier appel gratuit de 30 minutes pour parler de votre projet. Votre idée reste entre nous : je m'engage à ne jamais la reprendre pour la réaliser moi-même.</p>\n\n<table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px auto;\"><tr><td style=\"border-radius:8px;background:rgb(255,122,26);\">\n  <a href=\"{{config_url}}\" style=\"display:inline-block;padding:14px 30px;color:#142B3D;text-decoration:none;font-weight:700;font-size:15px;\">Parlons de votre projet</a>\n</td></tr></table>\n\n<p>Le questionnaire prend environ une minute. Vous pouvez aussi répondre directement à cet email.</p>\n\n<p style=\"margin-top:24px;\">Bien à vous,<br/>\n<strong>Nicolas · Eazzy</strong><br/>\n<a href=\"{{product_url}}\">eazzy.be</a></p>",
    "tagline": "Votre idée de projet web. Construite par vous."
  },
  "products": [
    {
      "key": "general",
      "name": "Eazzy",
      "uiLabel": "Général (offre complète)",
      "shopUrl": "https://eazzy.be/",
      "configUrl": "https://eazzy.be/questionnaire",
      "description": "Un accompagnement individuel, en visio, pour construire soi-même son projet web (site, boutique en ligne, application, outil interne) avec l'IA, sans savoir coder. Ce n'est pas un cours tout fait : la méthode est toujours la même, en 4 étapes, mais chaque étape se construit autour du projet du client. Le client travaille sur son propre ordinateur et montre son écran ; Nicolas le guide, il ne fait jamais à sa place. Avant tout, un premier appel gratuit de 30 minutes, « Parlons de votre projet », dont l'idée reste confidentielle. Le client garde la propriété de son projet et de son idée.",
      "pitch": "votre projet web, construit par vous, guidé pas à pas, pour que vous sachiez continuer seul.",
      "aliases": [
        "general",
        "général",
        "global",
        "offre complète",
        "complet",
        "eazzy"
      ]
    },
    {
      "key": "pack-base",
      "name": "l'accompagnement en 4 étapes",
      "uiLabel": "Accompagnement en 4 étapes (500 €)",
      "price": "500 € (TVA non applicable)",
      "shopUrl": "https://eazzy.be/#prix",
      "configUrl": "https://eazzy.be/questionnaire",
      "description": "4 étapes d'une heure en visio, seul à seul, à un rythme fixé ensemble. Étape 1 : les outils et ce que le projet doit faire. Étape 2 : l'organisation du projet et son image de marque. Étape 3 : on installe tout et on commence à construire. Étape 4 : on termine et on prépare la suite. Inclus : des conseils pour choisir les outils et services, l'attention portée aux points à risque (sécurité, confidentialité, RGPD), des fiches pour avancer entre les étapes, l'enregistrement de chaque étape (vidéo, texte de ce qui a été dit, résumé) et un plan clair pour la suite. 500 €, TVA non applicable. Un abonnement à l'IA, autour de 25 € par mois pour commencer, reste à la charge du client.",
      "pitch": "une première version qui fonctionne, construite par vous en 4 étapes, et la méthode pour la faire grandir.",
      "aliases": [
        "pack de base",
        "pack décollage",
        "décollage",
        "4 étapes",
        "quatre étapes",
        "500"
      ]
    }
  ],
  "defaultProductKey": "general",
  "ai": {
    "positioning": "Eazzy est un accompagnement individuel, en visio, créé en Belgique par Nicolas Lenaerts : il apprend à des personnes qui ne savent pas coder à construire elles-mêmes leur projet web (site, boutique en ligne, application, outil interne) avec l'IA. Le principe : ne jamais faire à la place du client. Il travaille sur son propre ordinateur et montre son écran, Nicolas le guide. Nicolas travaille depuis 20 ans dans le digital et la communication et pourrait construire le projet lui-même : il choisit d'apprendre au client à le faire. Ce n'est pas un cours tout fait : la méthode est toujours la même, en 4 étapes d'une heure, mais chaque étape se construit autour du projet du client. Ce n'est pas de la magie non plus : pas besoin de savoir coder, mais il faut être à l'aise avec un ordinateur et prêt à mettre les mains dedans, au moins une heure par semaine entre les étapes. Le prix est affiché : 500 € pour les 4 étapes, TVA non applicable ; un abonnement à l'IA, autour de 25 € par mois pour commencer, reste à la charge du client. Avant tout, un premier appel gratuit de 30 minutes, « Parlons de votre projet », vérifie que le projet convient à la méthode et que la méthode convient à la personne ; l'idée reste confidentielle, et Nicolas s'engage à ne jamais la reprendre pour la réaliser lui-même. Le résultat : une première version qui fonctionne, avec une fonctionnalité clé, et la méthode pour continuer seul. Jamais plus de 5 personnes par mois, pour garder le temps de suivre chaque projet. Les cibles : l'indépendant débrouillard (coach, photographe, artisan, consultant) qui paie un abonnement à un outil qui ne lui ressemble pas, ou qui a renoncé devant un devis d'agence ; le profil « digital » d'une PME, qui gère déjà le site ou les fichiers Excel et veut transformer un tableur en outil interne (c'est souvent l'entreprise qui paie) ; le porteur d'une idée à tester avant d'investir ; le créatif qui imagine déjà ses écrans. Les lieux qui conseillent des indépendants (coworkings, incubateurs, guichets d'entreprise, comptables) se démarchent comme relais : on leur propose de faire connaître Eazzy à leurs membres ou clients. Le message tient sur trois axes : l'autonomie (c'est vous qui construisez, et vous saurez continuer seul), l'accessibilité (pas besoin de savoir coder, prix affiché) et l'exigence (peu de places, un engagement demandé). Les mots restent ceux de tous les jours : on simplifie les mots, jamais le fond. L'action proposée est unique : répondre au questionnaire, qui prend environ une minute, pour réserver le premier appel gratuit, ou simplement répondre à l'email.",
    "signature": "Nicolas · Eazzy",
    "forbidden": [
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
      "un atelier, un webinaire ou une date qui n'a pas été annoncé"
    ]
  }
}$config$::jsonb, false)
on conflict (slug) do nothing;
