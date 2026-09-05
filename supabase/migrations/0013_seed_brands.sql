-- ============================================================
-- 0013 : les deux marques historiques passent du code à la base.
--
-- Déclarées jusqu'ici dans lib/brands/tag2share.ts et lib/brands/horodo.ts,
-- elles deviennent modifiables depuis /marques. Le tableau BRANDS du code est
-- vidé en même temps (lib/brands/index.ts) : sans cela ces lignes seraient
-- ignorées, le registre écartant toute ligne dont le slug appartient à une
-- marque déclarée en code.
--
-- `active = true` : ce sont des marques qui envoient déjà. Les créer en
-- brouillon interromprait les campagnes en cours.
--
-- ⚠️ CE QUE CETTE MIGRATION CHANGE : les champs `*Env` du code ne sont PAS
-- repris. Une marque de base ne peut pas nommer une variable d'environnement à
-- lire côté serveur - laisser une valeur stockée en base désigner n'importe
-- quelle variable ferait ressortir un secret dans l'en-tête From d'un vrai
-- email. Concrètement, cessent d'être consultées :
--   tag2share : RESEND_FROM, RESEND_REPLY_TO, TEST_EMAIL,
--               DAILY_SEND_CAP, SEND_DELAY_MS
--   horodo    : TEST_EMAIL_HORODO, DAILY_SEND_CAP_HORODO
--
-- AVANT DE JOUER CECI EN PRODUCTION : ouvrir /reglages pour chaque marque et
-- vérifier la source de l'en-tête From. Si elle indique « variable
-- d'environnement », enregistrer la valeur affichée dans le formulaire : elle
-- est alors figée dans brand_settings, qui reste prioritaire et que cette
-- migration ne touche pas. Sinon l'adresse d'envoi retombera silencieusement
-- sur le littéral ci-dessous.
--
-- Le plafond quotidien et le délai deviennent des champs de la marque,
-- éditables dans /marques. Les valeurs ci-dessous sont celles du code : si une
-- variable d'environnement en imposait une autre, elle change ici.
--
-- Rappel de l'ordre de résolution de l'identité d'expédition, inchangé :
--   brand_settings (saisi dans /reglages)  →  littéral de la config  →
-- la couche « variable d'environnement » disparaît simplement du milieu.
--
-- Idempotent : `on conflict do nothing`, une marque déjà présente en base
-- n'est pas écrasée.
-- ============================================================

-- ------------------------------------------------------------
-- DIFFÉRENCES MESURÉES sur l'environnement de génération.
-- Comparer avec la production : si les mêmes variables d'environnement y
-- portent d'autres valeurs, l'écart y sera différent.
--
-- tag2share : 2 valeur(s) changent
--   adresse de test  : nicolas.lenaerts@gmail.com  ->  (AUCUNE)
--   plafond/jour     : 10  ->  50
--
-- Pour conserver les valeurs actuelles, décommenter :
-- update public.brands set config = jsonb_set(jsonb_set(config,
--     '{sender,dailyCap}', to_jsonb(10::int)),
--     '{sender,testEmail}', to_jsonb('nicolas.lenaerts@gmail.com'::text))
--   where slug = 'tag2share';
--
-- horodo : aucune valeur d'expédition ne change.
-- ------------------------------------------------------------

-- Tag2Share
insert into public.brands (slug, config, active)
values ('tag2share', $config${
  "slug": "tag2share",
  "name": "Tag2Share",
  "tagline": "Trouver des business pour vos objets connectés (porte-clé, carte, présentoir)",
  "domains": [
    "tag2share.com"
  ],
  "appUrl": "https://marketing.tag2share.com",
  "theme": {
    "rgb": [
      20,
      74,
      102
    ],
    "logoUrl": "https://rfvjlmojryoovnpyotgf.supabase.co/storage/v1/object/public/mail/tag2share-logo.png",
    "logoAlt": "Tag2Share",
    "logoWidth": 150,
    "monogram": "T2"
  },
  "shopUrl": "https://www.tag2share.com/shop/category/objets-connectes-9",
  "email": {
    "layout": "classic",
    "socials": [
      {
        "label": "Instagram",
        "url": "https://www.instagram.com/tag_2_share/"
      },
      {
        "label": "Facebook",
        "url": "https://www.facebook.com/Tag2Share"
      },
      {
        "label": "LinkedIn",
        "url": "https://www.linkedin.com/company/tag2share"
      }
    ],
    "showProductsMore": true
  },
  "sender": {
    "fromName": "Nicolas de Tag2Share",
    "from": "nicolas@reach.tag2share.com",
    "replyTo": "nicolas@tag2share.com",
    "identity": {
      "name": "Tag2Share",
      "contact": "tag2share.com"
    },
    "dailyCap": 50,
    "delayMs": 1200
  },
  "defaults": {
    "subject": "{{name}} : et si chaque client laissait un avis 5★ en 1 geste ?",
    "body": "<p style=\"font-size:20px;font-weight:700;color:rgb(20,74,102);margin:0 0 16px;\">\n  Transformez chaque client de {{name}} en ambassadeur. 🚀\n</p>\n\n<p>Bonjour {{contact_name}},</p>\n\n<p>Vos clients sont satisfaits… mais combien laissent vraiment un <strong>avis Google</strong> ou vous suivent sur les <strong>réseaux sociaux</strong>&nbsp;? Le plus souvent, il manque juste le bon déclic, au bon moment.</p>\n\n<p><strong>Tag2Share</strong> crée des <strong>objets connectés (NFC + QR code)</strong> qui transforment ce moment en un simple geste&nbsp;:</p>\n\n<ul style=\"padding-left:18px;\">\n  <li>⭐ <strong>Plus d'avis 5 étoiles</strong> - le client scanne, il note. En 5 secondes.</li>\n  <li>📈 <strong>Plus d'abonnés</strong> sur Instagram, Facebook &amp; TikTok, sans rien expliquer.</li>\n  <li>💳 <strong>Zéro papier</strong> - coordonnées, menu et liens partagés d'un seul tap.</li>\n</ul>\n\n<p>Pour {{name}}, je recommande tout particulièrement le <strong>{{product_name}}</strong>.</p>\n\n<table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px auto;\"><tr><td style=\"border-radius:8px;background:rgb(20,74,102);\">\n  <a href=\"{{product_url}}\" style=\"display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;\">Voir le {{product_name}}</a>\n</td></tr></table>\n\n<p style=\"text-align:center;margin:-8px 0 8px;\">\n  <a href=\"{{config_url}}\" style=\"color:rgb(20,74,102);font-weight:600;\">🎨 Personnaliser votre {{product_name}} dans le configurateur →</a>\n</p>\n\n<p>Je serais ravi de vous préparer un exemple personnalisé pour <strong>{{name}}</strong>. Quelques minutes cette semaine&nbsp;?</p>\n\n{{products_more}}\n\n<p style=\"margin-top:24px;\">Bien à vous,<br/>\n<strong>L'équipe Tag2Share</strong><br/>\n<span style=\"color:#888;\">Objets connectés NFC &amp; QR · tag2share.com</span></p>",
    "tagline": "Plus d'avis ⭐  ·  Plus d'abonnés 📈  ·  Zéro contact 💳"
  },
  "products": [
    {
      "key": "keyring",
      "name": "Porte-clé connecté",
      "price": "14,90 €",
      "shopUrl": "https://www.tag2share.com/shop/objets-connectes-9/porte-cle-connecte-5",
      "configUrl": "https://app.tag2share.com/customize/keyring/",
      "description": "Porte-clé NFC + QR code. Au contact d'un smartphone, il ouvre instantanément une page (profil, menu, avis Google, réseaux sociaux, site web…).",
      "pitch": "votre vitrine toujours sur vous : partagez profil, avis et réseaux en un geste, partout.",
      "aliases": [
        "porte-clé",
        "porte-cle",
        "porte cle",
        "keyring"
      ]
    },
    {
      "key": "card",
      "name": "Carte de visite connectée",
      "price": "24,90 €",
      "shopUrl": "https://www.tag2share.com/shop/objets-connectes-9/carte-de-visite-connectee-6",
      "configUrl": "https://app.tag2share.com/customize/card/",
      "description": "Carte de visite NFC + QR code. Remplace la carte papier : un tap partage coordonnées, réseaux sociaux et liens. Réutilisable, modifiable à distance.",
      "pitch": "votre réseau en un tap : coordonnées, réseaux et liens partagés instantanément, sans papier.",
      "aliases": [
        "card",
        "carte",
        "visite"
      ]
    },
    {
      "key": "stand",
      "name": "Présentoir connecté",
      "price": "34,90 €",
      "shopUrl": "https://www.tag2share.com/shop/objets-connectes-9/presentoir-connecte-7",
      "configUrl": "https://app.tag2share.com/customize/stand/",
      "description": "Présentoir de comptoir NFC + QR code. Posé en boutique/accueil, il invite les clients à scanner pour laisser un avis Google, suivre les réseaux ou consulter le menu.",
      "pitch": "posé sur le comptoir, irrésistible à scanner : un flux régulier d'avis Google 5★ et d'abonnés.",
      "aliases": [
        "stand",
        "présentoir",
        "presentoir"
      ]
    }
  ],
  "defaultProductKey": "stand",
  "ai": {
    "positioning": "Tag2Share vend des objets connectés (NFC + QR code) qui transforment un client satisfait en ambassadeur : plus d'avis Google, plus d'abonnés sur les réseaux, partage de coordonnées sans contact.",
    "signature": "L'équipe Tag2Share"
  }
}$config$::jsonb, true)
on conflict (slug) do nothing;

-- Horodo
insert into public.brands (slug, config, active)
values ('horodo', $config${
  "slug": "horodo",
  "name": "Horodo",
  "tagline": "Trouver les employeurs à main-d'œuvre de terrain qui doivent enregistrer le temps de travail",
  "domains": [
    "horodo.be",
    "horodo.eu"
  ],
  "appUrl": "https://marketing.horodo.be",
  "theme": {
    "rgb": [
      255,
      176,
      32
    ],
    "textRgb": [
      154,
      91,
      0
    ],
    "onBrandHex": "#0B1520",
    "logoUrl": "https://www.horodo.be/logotype.png",
    "logoAlt": "Horodo",
    "logoWidth": 160,
    "monogram": "HO"
  },
  "shopUrl": "https://www.horodo.be/tarifs",
  "email": {
    "layout": "minimal",
    "socials": [],
    "showProductsMore": false
  },
  "sender": {
    "fromName": "Nicolas de Horodo",
    "from": "nicolas@send.horodo.be",
    "replyTo": "hello@horodo.be",
    "identity": {
      "name": "Horodo",
      "contact": "horodo.be"
    },
    "dailyCap": 20,
    "delayMs": 1500
  },
  "defaults": {
    "subject": "{{name}} : comment prouvez-vous les heures de mardi dernier ?",
    "body": "<p>Bonjour {{contact_name}},</p>\n\n<p>Une question simple, posée telle quelle à un employeur de {{city}} la semaine dernière : « montrez-moi comment votre ouvrier a pointé mardi. » La réponse est presque toujours un tableur, un carnet, ou le chef d'équipe qui encode le vendredi de mémoire.</p>\n\n<p>Noter des heures n'est pourtant pas pouvoir les prouver. Un fichier se réécrit. Un encodage du vendredi n'est pas un enregistrement. Une saisie par le chef d'équipe n'est pas un pointage.</p>\n\n<p>Avec <strong>{{product_name}}</strong>, le geste est capté au moment où il a lieu, même sans réseau, et il en reste une trace vérifiable :</p>\n\n<ul style=\"padding-left:18px;\">\n  <li>L'heure vient du serveur, pas du téléphone.</li>\n  <li>Une correction s'ajoute au journal, elle n'écrase jamais la ligne d'origine.</li>\n  <li>Le travailleur voit son solde, et l'export s'ouvre sans compte ni outil propriétaire.</li>\n</ul>\n\n<table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px auto;\"><tr><td style=\"border-radius:8px;background:rgb(255,176,32);\">\n  <a href=\"{{product_url}}\" style=\"display:inline-block;padding:14px 30px;color:#0B1520;text-decoration:none;font-weight:700;font-size:15px;\">Découvrir {{product_name}}</a>\n</td></tr></table>\n\n<p style=\"text-align:center;margin:-8px 0 8px;\">\n  <a href=\"{{config_url}}\">Faire le point en 3 minutes sur vos obligations actuelles</a>\n</p>\n\n<p>Si le sujet vous concerne, je peux vous montrer le parcours en quelques minutes cette semaine.</p>\n\n<p style=\"margin-top:24px;\">Bien à vous,<br/>\n<strong>L'équipe Horodo</strong><br/>\n<span style=\"color:#888;\">Enregistrement du temps de travail · horodo.be</span></p>",
    "tagline": "Le temps de travail capté sur le terrain, et sa preuve"
  },
  "products": [
    {
      "key": "general",
      "name": "Horodo",
      "uiLabel": "Général (offre complète)",
      "shopUrl": "https://www.horodo.be/produit",
      "configUrl": "https://www.horodo.be/diagnostic",
      "description": "L'offre Horodo dans son ensemble, sans entrer dans les formules. Pointage par gsm, badge ou kiosque sur tablette. Journal en ajout seul : une correction s'ajoute, elle n'écrase jamais. Mode CIaO, entrée et sortie en temps réel par la personne elle-même. Fonctionnement hors réseau avec synchronisation au retour et origine de l'heure indiquée. Solde consultable par le travailleur à tout moment. Équipes, validation des heures, clôture de période. Feuille de temps par chantier ou par tâche. Règles par lieu et multi-sites. Compteurs par travailleur (flexi-job, temps partiel, travail de nuit). Accès en lecture seule pour le comptable ou le secrétariat social. Tableau de bord, rapports, et export destiné à l'inspection sociale.",
      "pitch": "le temps de travail capté sur le terrain, hors réseau, et une trace que l'on peut produire devant un inspecteur.",
      "aliases": [
        "general",
        "général",
        "global",
        "offre complète",
        "complet"
      ]
    },
    {
      "key": "starter",
      "name": "Starter",
      "price": "19 EUR / mois",
      "shopUrl": "https://www.horodo.be/tarifs",
      "configUrl": "https://www.horodo.be/diagnostic",
      "description": "Jusqu'à 5 utilisateurs. Le pointage et sa preuve pour un employeur d'un seul lieu : pointage par gsm, badge ou kiosque sur tablette, journal en ajout seul, mode CIaO, fonctionnement hors réseau, solde consultable par le travailleur, export destiné à l'inspection sociale.",
      "pitch": "le pointage et sa preuve, pour un employeur d'un seul lieu qui ne suit pas de chantiers.",
      "aliases": [
        "starter",
        "micro",
        "19"
      ]
    },
    {
      "key": "pro",
      "name": "Pro",
      "price": "49 EUR / mois",
      "shopUrl": "https://www.horodo.be/tarifs",
      "configUrl": "https://www.horodo.be/diagnostic",
      "description": "Jusqu'à 15 utilisateurs, toutes les fonctions, accessible dès un utilisateur. Tout le Starter, plus la feuille de temps par chantier, les accès en lecture seule illimités pour le comptable ou le secrétariat social, les règles par lieu et le multi-sites, et les compteurs par travailleur (flexi-job, temps partiel, travail de nuit).",
      "pitch": "toutes les fonctions, dont la feuille de temps par chantier et l'accès comptable illimité.",
      "aliases": [
        "pro",
        "49"
      ]
    },
    {
      "key": "entreprise",
      "name": "Entreprise",
      "price": "99 EUR / mois",
      "shopUrl": "https://www.horodo.be/tarifs",
      "configUrl": "https://www.horodo.be/diagnostic",
      "description": "Jusqu'à 50 utilisateurs. Exactement les mêmes fonctions que Pro : la seule différence est le nombre d'utilisateurs. Au-delà de 50 travailleurs, l'offre se fait sur devis.",
      "pitch": "les mêmes fonctions que Pro, pour les organisations jusqu'à 50 utilisateurs.",
      "aliases": [
        "entreprise",
        "growth",
        "99"
      ]
    }
  ],
  "defaultProductKey": "general",
  "ai": {
    "positioning": "Horodo enregistre le temps de travail là où les outils de paie ne vont pas : sur le terrain, hors réseau, sans smartphone personnel, et il en produit une preuve opposable. La cible est l'employeur belge à main-d'œuvre de terrain (construction, horeca, nettoyage et titres-services). L'argument n'est pas le prix ni la simplicité d'installation, c'est la distinction entre noter des heures et pouvoir les prouver : un fichier se réécrit, un encodage du vendredi n'est pas un enregistrement, une saisie par le chef d'équipe n'est pas un pointage. Trois faits techniques démontrables portent le discours : horodatage serveur, journal des corrections en ajout seul, export lisible sans installer quoi que ce soit. Les obligations à citer sont celles EN VIGUEUR aujourd'hui (enregistrement électronique des flexi-jobs depuis juillet 2026, avis d'horaire des temps partiels, horaires flottants, quotas d'heures supplémentaires volontaires et de travail étudiant, CIaO dans le nettoyage), jamais une obligation future présentée comme acquise.",
    "signature": "L'équipe Horodo",
    "forbidden": [
      "« certifié conforme », « certifié Belgique 2027 », « homologué », « agréé » : rien de tout cela n'existe",
      "« conforme INS » : cet organisme n'existe pas dans ce contexte",
      "toute affirmation que la loi entrera en vigueur à une date précise : l'obligation générale annoncée pour le 1er janvier 2027 n'est PAS votée et l'arrêté royal n'est pas publié",
      "toute affirmation qu'une catégorie d'employeurs « doit » enregistrer ou en est « dispensée » au titre de l'avant-projet : les deux sont faux en l'état",
      "tout score ou pourcentage de « probabilité d'audit » ou de « risque de contrôle » : c'est de la conformité fictive",
      "« conçu selon les critères de la jurisprudence européenne » et toute formule d'auto-déclaration de conformité",
      "toute promesse de mise en conformité (« vous serez en règle », « conformité garantie »)"
    ]
  }
}$config$::jsonb, true)
on conflict (slug) do nothing;
