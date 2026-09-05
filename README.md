# Prospection multi-marque

App Next.js **autonome** (indépendante de l'app tag2share / profile-card-creator) pour :

1. **Proposer des types de business** (via Gemini) qui auraient besoin des objets connectés Tag2Share (porte-clé, carte de visite, présentoir).
2. **Rechercher** ces business via **Google Maps / Places** (pays sélectionnable : Belgique / France).
3. **Enrichir** chaque prospect : email, personne de contact, logo, réseaux sociaux, depuis leur site web.
4. **Campagne email** : template éditable avec variables `{{name}}`, `{{contact_name}}`, etc., adaptation par prospect, **email de test** vers votre adresse, puis **envoi réel uniquement après confirmation explicite** via Resend.

> 🔒 **Sécurité** : aucun email n'est envoyé sans action explicite. L'envoi réel exige `confirm: true` côté serveur + une confirmation tapée (`ENVOYER`) côté interface. Les tests sont toujours redirigés vers votre adresse.

## Multi-marque

L'outil gère **plusieurs marques** (produits/enseignes). Chaque marque a sa propre
identité visuelle, son catalogue, son gabarit d'email, son adresse d'expédition
et son positionnement injecté dans les prompts IA.

> ⚠️ Vocabulaire : `product` (colonnes `segments.product`, `campaigns.product`,
> `email_log.product_key`) désigne une **variante de produit à l'intérieur d'une
> marque** (pour Tag2Share : `keyring | card | stand`) et alimente les tokens
> `{{product_*}}`. La **marque** est la colonne `brand`. Une marque possède N produits.

### Où vit la configuration

| Élément | Emplacement |
|---|---|
| Registre des marques | [`lib/brands/index.ts`](lib/brands/index.ts) (`BRANDS`) |
| Contrat d'une marque | [`lib/brands/types.ts`](lib/brands/types.ts) (`BrandConfig`) |
| Marque Tag2Share | [`lib/brands/tag2share.ts`](lib/brands/tag2share.ts) |
| Gabarit pour une nouvelle marque | [`lib/brands/_example.ts`](lib/brands/_example.ts) (non enregistré) |
| Gabarits d'email | [`lib/email-layouts/`](lib/email-layouts/) (`classic`, `minimal`) |
| Identité d'expédition effective | [`lib/brand-sender.ts`](lib/brand-sender.ts) (serveur) |
| Marque active d'une requête | [`lib/brand-context.ts`](lib/brand-context.ts) |

Les fichiers de marque sont importés **aussi côté navigateur** (aperçu d'email) :
ils ne contiennent donc aucun secret, seulement le **nom** des variables
d'environnement, résolues côté serveur.

### Adresse d'envoi : saisie dans l'interface

Un **seul compte Resend** pour toute l'app (`RESEND_API_KEY`), avec un domaine
vérifié par marque. Ce qui change d'une marque à l'autre est l'**adresse
d'envoi**, éditable dans la page **/reglages** et stockée dans la table
`brand_settings` (nom affiché, adresse d'envoi, adresse de réponse, adresse de
test).

Ordre de résolution, du plus fort au plus faible ([`lib/brand-sender.ts`](lib/brand-sender.ts)) :

1. la table `brand_settings` (saisie dans /reglages) ;
2. la variable d'environnement nommée dans `lib/brands/<slug>.ts` ;
3. la valeur littérale de `lib/brands/<slug>.ts`.

Vider un champ dans l'interface efface la valeur enregistrée et fait retomber
sur l'étape suivante. La page affiche l'en-tête `From` effectif et sa provenance.

Le couple (nom, adresse) est résolu **comme un tout** : jamais un nom enregistré
avec une adresse venue du code. Les valeurs sont validées à l'écriture (pas de
retour chariot ni de chevron dans le nom : elles finissent dans un en-tête SMTP).

⚠️ Le domaine de l'adresse d'envoi doit être **vérifié chez Resend**, sinon
l'envoi échoue.

### Catalogue : produits, formules, ou offre globale

`products[]` alimente les tokens `{{product_*}}`. Trois réglages permettent de
couvrir autre chose qu'un catalogue de produits physiques :

| Champ | Effet |
|---|---|
| `price` (optionnel) | Une entrée « offre globale » n'a pas de prix ; `{{product_price}}` rend une chaîne vide. |
| `uiLabel` (optionnel) | Libellé dans les menus et badges, quand il diffère du nom employé dans les phrases d'email. Ex. Horodo : `name: "Horodo"` (« Avec Horodo, le geste est capté ») et `uiLabel: "Général (offre complète)"` dans le sélecteur. |
| `defaultProductKey` | Produit présélectionné à l'étape 1. Ne change pas le repli de `normalizeProductKey`, qui reste le premier du catalogue. |
| `email.showProductsMore` | À `false`, l'encart « À découvrir aussi » disparaît et les routes de rédaction IA cessent de l'imposer. À utiliser quand le catalogue est une grille tarifaire : lister les paliers sous un email de prospection déplace la conversation sur le prix trop tôt. |

Horodo combine les quatre : une entrée `general` sans prix en tête de catalogue
(donc aussi le repli des valeurs inconnues), suivie des trois formules
Starter / Pro / Entreprise.

### Webhook Resend : un seul endpoint

Compte unique = tous les événements arrivent sur `POST /api/webhooks/resend`.
La marque n'est donc **pas** déduite de l'URL mais du payload
([`lib/resend-webhook.ts`](lib/resend-webhook.ts)) :

1. `email_log.resend_id` → colonne `brand` de la ligne d'envoi (source de vérité) ;
2. sinon, l'adresse `from` de l'événement comparée aux adresses d'envoi des marques ;
3. sinon, la marque par défaut.

L'attribution compte : une plainte spam mal attribuée polluerait la liste de
suppression d'une autre marque.

### Ajouter une marque

1. Copier `lib/brands/_example.ts` en `lib/brands/<slug>.ts`, renommer la constante,
   remplir identité / domaines / catalogue / positionnement IA / contenu par défaut.
2. L'ajouter au tableau `BRANDS` de `lib/brands/index.ts`.
3. Vérifier son domaine d'envoi dans le compte Resend existant.
4. Basculer sur la marque dans l'en-tête, puis saisir son adresse d'envoi dans
   **/reglages**. Aucune variable d'environnement supplémentaire n'est requise.

Le sélecteur de marque apparaît dans l'en-tête dès qu'il y a **au moins deux**
marques enregistrées. Il écrit un cookie `brand` ; le middleware le valide et
pose l'en-tête `x-brand` que lisent les routes API.

### Ce qui est cloisonné, ce qui est partagé

| Donnée | Périmètre |
|---|---|
| `segments`, `campaigns`, `searches`, `email_log` | **par marque** (colonne `brand`) |
| `prospects` | **par marque** (colonne `brand`) - deux marques qui démarchent le même commerce en détiennent chacune leur fiche, éditable sans se marcher dessus. L'unicité du `place_id` est donc `(brand, place_id)` |
| `suppressions` | **par périmètre** : `brand = '*'` (toutes marques) ou `brand = '<slug>'` - règle décidée par `suppressionScope()` dans [`lib/suppression.ts`](lib/suppression.ts) |
| « déjà contacté » | **par marque** ; les contacts des autres marques sont signalés (badge `↔`) sans bloquer l'envoi - rapprochement par **email**, seul point commun entre deux fiches désormais distinctes |
| Plafond d'envoi quotidien | **par marque** (la réputation se joue par domaine) |

Le cloisonnement est **applicatif** : la RLS Supabase est active sans policy, tous
les accès passent par la clé `service_role` côté serveur. Toute nouvelle route qui
lit ou écrit des données de marque doit filtrer explicitement sur `brand`.

### Ne pas repayer l'enrichissement

Cloisonner le vivier coûterait cher si chaque marque devait relancer Places +
Gemini sur un commerce déjà enrichi par une autre. Quand une marque découvre un
business déjà connu ailleurs, elle obtient **sa propre ligne**, pré-remplie avec
les données d'**entreprise** déjà payées (email, contact, logo, téléphone, site,
adresse, blob `enrichment`) : [`lib/prospect-seed.ts`](lib/prospect-seed.ts),
appelé par la recherche Places et par l'import de fichiers.

La reprise a lieu **une seule fois, à la création**. Ensuite les deux lignes sont
indépendantes : corriger un email chez une marque ne touche pas l'autre. Ne sont
jamais repris les jugements propres à une marque : `status: "rejected"`, le
segment d'origine, les rattachements, l'historique de contact.

### Résolution du produit mis en avant

`prospects.segment_id` (segment d'ORIGINE) peut pointer vers un segment d'une
**autre** marque sur les données antérieures à `0015`, quand le vivier était
partagé. Le produit de `{{product_*}}` est donc résolu via les **segments de la
campagne**, filtrés sur sa marque : [`lib/campaign-segments.ts`](lib/campaign-segments.ts).
L'aperçu de l'UI utilise la même résolution (`resolved_segment`) que l'envoi réel.

## Stack

- Next.js 15 (App Router) · TypeScript · Tailwind
- Supabase (projet `umabxfhfsacnxbbsxwat`) - stockage prospects / campagnes
- Google Places API (New) + Gemini (`@google/generative-ai`)
- Resend (domaine `mail.tag2share.com`)

## Mise en route

### 0. ⚠️ Libérer de l'espace disque

Au moment du scaffold, le volume était plein (**< 400 Mo libres**). `npm install` a besoin de ~500 Mo.
Libérez de l'espace avant l'étape 1 (`df -h /` pour vérifier).

### 1. Installer les dépendances

```bash
cd tag2share-prospect
npm install
```

### 2. Créer les tables Supabase

Ouvrir le **SQL Editor** du projet (https://supabase.com/dashboard/project/umabxfhfsacnxbbsxwat/sql)
et exécuter le contenu de [`supabase/schema.sql`](supabase/schema.sql).

Puis les migrations, dans l'ordre. Pour le multi-marque :

- [`0009_brands.sql`](supabase/migrations/0009_brands.sql) - colonnes `brand`
  (défaut `'tag2share'` : les données existantes sont rattachées à la marque historique).
- [`0010_suppressions_brand.sql`](supabase/migrations/0010_suppressions_brand.sql) -
  périmètre des suppressions, clé primaire `(email, brand)`.
- [`0011_brand_sender.sql`](supabase/migrations/0011_brand_sender.sql) - table
  `brand_settings` : adresse d'envoi par marque, éditable dans /reglages.
- [`0015_prospects_brand.sql`](supabase/migrations/0015_prospects_brand.sql) -
  cloisonnement du vivier : colonne `brand` sur `prospects`, unicité
  `(brand, place_id)` à la place du `place_id` global, chaque prospect existant
  attribué à la marque de son segment d'origine. Les rattachements devenus
  inter-marques sont supprimés ; les destinataires de campagne inter-marques
  sont conservés (archive) mais ignorés à l'envoi.

⚠️ **À exécuter avant de lancer la version multi-marque** : les routes écrivent
désormais la colonne `brand`.

### 3. Vérifier les clés

`.env.local` est déjà rempli (Supabase, Google, Gemini, Resend, `TEST_EMAIL`).
Activez l'API **Places API (New)** dans la console Google Cloud pour la clé Maps.

### 4. Lancer

```bash
npm run dev
# http://localhost:3000
```

## Workflow dans l'app

| Étape | Action |
|------|--------|
| 1 | Gemini propose des types de business → vous cochez ceux à garder → « Valider » |
| 2 | Pour chaque segment : pays + ville → « Rechercher » (Google Places, dédoublonnage auto) |
| 3 | Sélection des prospects → « Enrichir » (email/contact/logo) ; champs corrigeables |
| 4 | Créer une campagne → éditer le template → ajouter des destinataires → **Test** → **Approuver** → **Envoyer aux approuvés** |

## Variables de fusion disponibles

`{{name}}` `{{contact_name}}` `{{category}}` `{{city}}` `{{country}}` `{{address}}` `{{phone}}` `{{website}}` `{{logo_url}}`

## Notes

- L'app est **mono-utilisateur** : la RLS Supabase est activée sans policy publique ; toutes les écritures passent par les routes API serveur (clé `service_role`). Ne pas exposer cette clé côté navigateur.
- Le logo email pointe vers le bucket Supabase de l'app tag2share existante. Pour le changer, éditer `theme.logoUrl` dans `lib/brands/tag2share.ts`.
- Les variables `SENDER_NAME` / `SENDER_ADDRESS` / `SENDER_CONTACT` n'existent plus : l'identité du pied d'email est portée par `sender.identity` dans la config de la marque (l'email est aussi rendu côté navigateur pour l'aperçu, où `process.env` n'est pas lisible).
- Les liens de désinscription déjà envoyés (signature sans marque) restent valides : `lib/unsubscribe.ts` accepte l'ancien format pour la marque par défaut.
- IA secondaires (Claude, Mistral) : clés présentes dans `.env.local`, non câblées par défaut (Gemini est le moteur principal choisi).
