-- ============================================================
-- 0023 : la marque Nicolas Lenaerts entre en base.
--
-- Le profil personnel de Nicolas Lenaerts, majoritairement des posts et des
-- carrousels sur l'IA (charte : ~/Desktop/posts-perso/charte-perso.md). La
-- marque sert UNIQUEMENT à programmer des publications dans /social : aucune
-- prospection par email n'est prévue pour l'instant.
--
-- La configuration ci-dessous est la SORTIE de lib/brands/nicolas-lenaerts.ts,
-- passée par parseBrandConfig (lib/brands/schema.ts) : elle est donc déjà
-- normalisée et valide. Comme pour Eazzy (0020), ce fichier TypeScript n'est
-- enregistré ni dans BRANDS ni dans SEED_BRANDS ; passé la première
-- modification dans /marques, la base fait foi.
--
-- `active = false`, et cette fois c'est l'état VOULU, pas un brouillon en
-- attente : l'envoi réel d'emails reste refusé, alors que /social, Buffer et
-- les emails de notification de publication ne regardent pas ce drapeau. Le
-- modèle d'email et l'identité de pied de page sont des valeurs de
-- remplissage, à reprendre avant toute activation.
--
-- Le logo (mot-symbole + curseur orange) est dans le bucket public
-- social-media, sous _marques/nicolas-lenaerts/ : hors des dossiers de marque,
-- donc jamais listé ni supprimé comme orphelin par l'onglet Fichiers.
--
-- Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
-- d'environnement à lire côté serveur (voir l'en-tête de 0013).
--
-- Idempotent : `on conflict do nothing`.
-- ============================================================

insert into public.brands (slug, config, active)
values ('nicolas-lenaerts', $config$
{
  "slug": "nicolas-lenaerts",
  "name": "Nicolas Lenaerts",
  "tagline": "Publications du profil personnel : l'IA, racontée par quelqu'un",
  "domains": [],
  "theme": {
    "rgb": [
      23,
      20,
      18
    ],
    "textRgb": [
      180,
      70,
      10
    ],
    "onBrandHex": "#F6F2EC",
    "logoUrl": "https://umabxfhfsacnxbbsxwat.supabase.co/storage/v1/object/public/social-media/_marques/nicolas-lenaerts/logo-email.png",
    "logoAlt": "Nicolas Lenaerts",
    "logoWidth": 200,
    "monogram": "NL"
  },
  "shopUrl": "https://www.linkedin.com/in/nicolaslenaerts",
  "email": {
    "layout": "minimal",
    "socials": [
      {
        "label": "LinkedIn",
        "url": "https://www.linkedin.com/in/nicolaslenaerts"
      }
    ],
    "showProductsMore": false
  },
  "sender": {
    "fromName": "Nicolas Lenaerts",
    "from": "nicolas@send.eazzy.be",
    "replyTo": "nicolas.lenaerts@gmail.com",
    "testEmail": "nicolas.lenaerts@gmail.com",
    "identity": {
      "name": "Nicolas Lenaerts",
      "contact": "linkedin.com/in/nicolaslenaerts"
    },
    "dailyCap": 20,
    "delayMs": 1500
  },
  "defaults": {
    "subject": "[À rédiger] Aucune prospection prévue sous ce nom",
    "body": "<p>Bonjour,</p>\n\n<p>[Modèle à rédiger. La marque Nicolas Lenaerts sert uniquement à programmer des publications : aucune campagne email n'est prévue pour l'instant.]</p>\n\n<p>Nicolas Lenaerts</p>",
    "tagline": ""
  },
  "products": [
    {
      "key": "general",
      "name": "Nicolas Lenaerts",
      "uiLabel": "Général (profil personnel)",
      "shopUrl": "https://www.linkedin.com/in/nicolaslenaerts",
      "configUrl": "https://www.linkedin.com/in/nicolaslenaerts",
      "description": "Le profil LinkedIn personnel de Nicolas Lenaerts : des posts et des carrousels sur l'IA, écrits à la première personne, à partir de ce qu'il a testé, changé ou constaté. Aucune offre commerciale n'est portée par cette marque.",
      "pitch": "l'IA expliquée clairement, à partir de ce qui a été testé pour de vrai.",
      "aliases": [
        "general",
        "général",
        "perso",
        "personnel",
        "profil",
        "nicolas"
      ]
    }
  ],
  "defaultProductKey": "general",
  "ai": {
    "positioning": "Nicolas Lenaerts travaille depuis 20 ans dans le digital et la communication, en Belgique. Cette marque est son profil personnel : ce n'est ni une entreprise ni une offre, c'est une personne qui parle, majoritairement d'IA. Ses contenus partent de ce qu'il a testé, changé ou constaté (« l'erreur que je faisais », « ce que j'ai vu »), jamais d'une définition. Trois impressions à donner, dans l'ordre : c'est clair, c'est concret, c'est quelqu'un (pas une marque). Une idée par message, un avis tranché plutôt qu'une leçon neutre, et une vraie question ouverte pour finir. Il a aussi créé Eazzy, un accompagnement pour construire soi-même son projet web avec l'IA ; il en parle environ une fois sur trois ou quatre, comme d'un projet personnel, jamais comme d'une publicité. Aucune prospection par email n'est prévue sous ce nom.",
    "signature": "Nicolas Lenaerts",
    "forbidden": [
      "le tiret cadratin : utiliser une virgule, deux-points ou des parenthèses",
      "la voix d'une entreprise (« nous », « notre équipe ») : c'est une personne qui parle, à la première personne",
      "ouvrir sur une définition ou une leçon neutre : ouvrir sur un angle personnel, une erreur faite, un constat vécu",
      "un chiffre, une date ou un point légal qui n'a pas été vérifié, et tout chiffre sans sa source",
      "les buzzwords et superlatifs : révolutionnaire, game changer, incroyable, magique, ultime",
      "présenter Eazzy comme une publicité ou glisser son argumentaire commercial : on peut en parler, comme d'un projet personnel",
      "plusieurs idées dans un même message"
    ]
  }
}$config$::jsonb, false)
on conflict (slug) do nothing;
