-- ============================================================
-- 0017 : la marque Voxado entre en base.
--
-- Voxado : le devis se dicte sur le chantier, pour les artisans et PME de
-- Belgique et de France francophone (plomberie, électricité, chauffage,
-- menuiserie, installation).
--
-- La configuration ci-dessous est la SORTIE de lib/brands/voxado.ts, passée
-- par parseBrandConfig (lib/brands/schema.ts) : elle est donc déjà normalisée
-- et valide. Ce fichier TypeScript n'est enregistré ni dans BRANDS ni dans
-- SEED_BRANDS - une entrée dans BRANDS masquerait cette ligne et rendrait
-- l'écran /marques sans effet sur la marque. Il documente l'état initial ;
-- passé la première modification dans /marques, la base fait foi.
--
-- `active = false` : la marque NAÎT EN BROUILLON, comme toute marque créée
-- dans l'interface. Segments, rédaction, aperçu et emails de test fonctionnent
-- déjà ; seul l'envoi réel reste bloqué. Trois choses sont à vérifier avant de
-- basculer l'interrupteur dans /marques :
--   1. marketing.voxado.be résout et sert CETTE instance (le lien de
--      désinscription est vérifié par le serveur qui le reçoit : un domaine
--      pointant ailleurs rend tous les liens déjà partis invalides) ;
--   2. nicolas@send.voxado.be part bien du domaine vérifié chez Resend
--      (send.voxado.be l'est ; devis@ y sert déjà les emails du produit) ;
--   3. un email de test est reçu et relu.
--
-- Aucun champ `*Env` : une marque de base ne peut pas nommer une variable
-- d'environnement à lire côté serveur (voir l'en-tête de 0013). Le plafond
-- quotidien (20/jour, sous-domaine neuf en prospection) et l'adresse de test
-- sont donc des littéraux, corrigeables dans /marques et /reglages.
--
-- Idempotent : `on conflict do nothing`.
-- ============================================================

insert into public.brands (slug, config, active)
values ('voxado', $config$
{
  "slug": "voxado",
  "name": "Voxado",
  "tagline": "Trouver les artisans qui rédigent encore leurs devis le soir, au bureau",
  "domains": [
    "voxado.be",
    "voxado.eu"
  ],
  "appUrl": "https://marketing.voxado.be",
  "theme": {
    "rgb": [
      224,
      131,
      0
    ],
    "textRgb": [
      176,
      95,
      0
    ],
    "onBrandHex": "#1F2726",
    "logoUrl": "https://www.voxado.be/icone-192.png",
    "logoAlt": "Voxado",
    "logoWidth": 72,
    "monogram": "VX"
  },
  "shopUrl": "https://www.voxado.be/",
  "email": {
    "layout": "minimal",
    "socials": [],
    "showProductsMore": false
  },
  "sender": {
    "fromName": "Nicolas de Voxado",
    "from": "nicolas@send.voxado.be",
    "replyTo": "bonjour@voxado.be",
    "testEmail": "nicolas.lenaerts@gmail.com",
    "identity": {
      "name": "Voxado",
      "contact": "voxado.be"
    },
    "dailyCap": 20,
    "delayMs": 1500
  },
  "defaults": {
    "subject": "{{name}} : le devis part-il encore le soir, au bureau ?",
    "body": "<p>Bonjour {{contact_name}},</p>\n\n<p>Une visite chez un client, trois radiateurs à remplacer, et le devis qui attend le soir. Le temps de retrouver les références et les prix, il part deux ou trois jours plus tard. Parfois, le client a déjà signé ailleurs.</p>\n\n<p>Avec <strong>{{product_name}}</strong>, le devis se dicte sur place : « deux radiateurs Radson 600 par 1200 et trois vannes thermostatiques ». Il part en PDF avant que vous ayez quitté le chantier.</p>\n\n<ul style=\"padding-left:18px;\">\n  <li>Les lignes tombent sur les références de votre catalogue, avec vos prix.</li>\n  <li>Les totaux et la TVA sont calculés, le document porte vos mentions.</li>\n  <li>Quand une ligne est ambiguë, la question vous est posée plutôt qu'un devis faux.</li>\n</ul>\n\n<p>Ni facturation, ni paiement, ni planning : un seul métier, le devis.</p>\n\n<table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px auto;\"><tr><td style=\"border-radius:8px;background:rgb(224,131,0);\">\n  <a href=\"{{product_url}}\" style=\"display:inline-block;padding:14px 30px;color:#1F2726;text-decoration:none;font-weight:700;font-size:15px;\">Voir comment ça marche</a>\n</td></tr></table>\n\n<p style=\"text-align:center;margin:-8px 0 8px;\">\n  <a href=\"{{config_url}}\">Demander un accès</a>\n</p>\n\n<p>Nous ouvrons les accès par petits groupes, pour suivre chaque entreprise au départ. Si le sujet vous parle, répondez à cet email : je vous montre le parcours en quelques minutes.</p>\n\n<p style=\"margin-top:24px;\">Bien à vous,<br/>\n<strong>L'équipe Voxado</strong><br/>\n<span style=\"color:#888;\">Le devis se dicte · voxado.be</span></p>",
    "tagline": "Le devis se dicte, sur le chantier"
  },
  "products": [
    {
      "key": "general",
      "name": "Voxado",
      "uiLabel": "Général (offre complète)",
      "shopUrl": "https://www.voxado.be/",
      "configUrl": "https://www.voxado.be/#demande",
      "description": "Le devis dicté sur place. L'artisan dicte ce qu'il faut faire, Voxado transcrit, retrouve les produits dans son propre catalogue avec ses prix, calcule les totaux et la TVA, génère le PDF et l'envoie au client. Catalogue importé depuis un fichier fournisseur. Fichier clients de l'entreprise, partagé entre les utilisateurs du compte. Question posée quand une ligne est ambiguë, plutôt qu'un devis faux. Consommation en crédits, proportionnelle à la longueur du devis. Taux de TVA belges et français, numéro d'entreprise et mentions légales sur le document. Hébergement européen, support en français. Ce que Voxado ne fait pas, et ne fera pas : ni facturation, ni paiement, ni planning, ni gestion de chantier.",
      "pitch": "le devis parti avant de quitter le chantier, avec les références et les prix du catalogue de l'artisan.",
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
      "price": "39 € / mois HTVA",
      "shopUrl": "https://www.voxado.be/",
      "configUrl": "https://www.voxado.be/#demande",
      "description": "Un utilisateur, 500 crédits par mois. Le devis vocal complet : catalogue, fichier clients, PDF et envoi. Pour l'artisan qui travaille seul.",
      "pitch": "le devis vocal complet, pour un artisan qui travaille seul.",
      "aliases": [
        "starter",
        "39"
      ]
    },
    {
      "key": "pro",
      "name": "Pro",
      "price": "59 € / mois HTVA",
      "shopUrl": "https://www.voxado.be/",
      "configUrl": "https://www.voxado.be/#demande",
      "description": "Un utilisateur, 1 000 crédits par mois. Mêmes fonctions que Starter, avec deux fois la capacité : pour une entreprise qui sort plusieurs devis par jour. Un utilisateur supplémentaire coûte 19 € par mois et apporte 300 crédits ; il travaille dans le catalogue et le fichier clients de l'entreprise, pas dans les siens.",
      "pitch": "deux fois la capacité, et un second ouvrier à 19 € plutôt qu'un second abonnement.",
      "aliases": [
        "pro",
        "59"
      ]
    },
    {
      "key": "premium",
      "name": "Premium",
      "price": "99 € / mois HTVA",
      "shopUrl": "https://www.voxado.be/",
      "configUrl": "https://www.voxado.be/#demande",
      "description": "Un utilisateur, 2 000 crédits par mois. Mêmes fonctions, pour une entreprise dont le devis est quotidien. Utilisateurs supplémentaires à 19 € par mois, 300 crédits chacun.",
      "pitch": "la capacité d'une entreprise qui devise tous les jours.",
      "aliases": [
        "premium",
        "99"
      ]
    }
  ],
  "defaultProductKey": "general",
  "ai": {
    "positioning": "Voxado est une plateforme belge où le devis se dicte. L'artisan est chez son client, il dicte ce qu'il faut faire, et le devis part en PDF avant qu'il ait quitté le chantier : Voxado transcrit, retrouve les produits dans SON catalogue avec SES prix, calcule les totaux et la TVA. La cible est l'artisan de Belgique et de France francophone (plomberie, électricité, chauffage, menuiserie, installation), structure de 1 à 5 personnes, 35 à 60 ans, peu d'appétence pour les logiciels et aucune minute à perdre. L'argument n'est ni la technologie ni le prix, c'est l'heure du soir : le devis se rédige aujourd'hui au bureau, de mémoire, plusieurs jours après la visite, et le client a parfois déjà signé ailleurs. Trois faits concrets portent le discours : la dictée tombe sur les références réelles du catalogue de l'artisan et non sur des lignes libres, un devis de trois lignes ne coûte pas le même prix qu'un devis de trente, et un second ouvrier est un siège à 19 € et non un second abonnement. Le périmètre est volontairement étroit, et c'est un argument : un seul métier, le devis, bien fait. Les accès s'ouvrent par petits groupes : l'action proposée est de demander un accès, jamais de souscrire.",
    "signature": "L'équipe Voxado",
    "forbidden": [
      "« IA », « intelligence artificielle », « algorithme », « magie », « automatique » : dire ce qui se passe, « Voxado retrouve vos références »",
      "le tutoiement, sous toutes ses formes : le vouvoiement s'applique partout, y compris dans les messages d'erreur",
      "le vocabulaire du logiciel à la place de celui du métier : « item », « workflow », « dashboard », « lead », « template ». On dit devis, ligne, référence, main d'œuvre",
      "les superlatifs et les points d'exclamation : « incroyable », « révolutionnaire », « la solution ultime »",
      "les étoiles, émojis et autres signes de « magie » dans le sujet comme dans le corps",
      "écrire un montant à l'anglaise : c'est 1 519,90 € (virgule décimale, espace pour les milliers, euro après le nombre), et les prix s'annoncent HTVA",
      "promettre une fonction qui n'existe pas : facturation, paiement, planning, gestion ou suivi de chantier, signature électronique, comptabilité",
      "laisser croire que l'abonnement est ouvert à tous immédiatement : les accès s'ouvrent par petits groupes, on demande un accès",
      "annoncer un tarif, une remise, une promotion ou une durée d'essai qui ne figure pas dans la grille : elle n'est pas publiée, un prix lâché en prospection devient une promesse",
      "toute garantie de conformité fiscale ou comptable, et toute formule laissant entendre que Voxado remplace le comptable"
    ]
  }
}$config$::jsonb, false)
on conflict (slug) do nothing;
