# Guide de l'outil Tag2Share Marketing (MCP) : campagnes email et réseaux sociaux

> Guide destiné aux sessions Claude des projets (sites, marques, contenus).
> Il explique comment utiliser **Tag2Share Marketing**, par son serveur MCP, pour
> préparer des campagnes de prospection par email et des publications sur les
> réseaux sociaux (publication, réel, carrousel) via Buffer.
> Mis à jour le 02/10/2026.

## 1. Ce que c'est

> **Outil ou produit ?** Ne confondez pas les deux.
> - **Tag2Share Marketing** (aussi appelé « Prospect », dépôt
>   `tag2share-prospect`) est l'**outil** : l'application de prospection et de
>   publication. Il a d'abord servi aux emails du produit Tag2Share, puis il a
>   été étendu aux autres produits. Il gère aujourd'hui **plusieurs marques**.
> - **Tag2Share** (slug `tag2share`) est **un des produits** gérés par l'outil
>   (porte-clé, carte de visite et présentoir connectés), au même titre
>   qu'Horodo ou Voxado.
>
> Le serveur MCP s'appelle `tag2share` pour des raisons historiques. Il sert
> **toutes** les marques : c'est le paramètre `brand` qui choisit le produit.

- Le serveur MCP `tag2share` expose 14 outils, nommés `mcp__tag2share__<outil>`.
- Il pilote l'application de **production** (`https://marketing.tag2share.com`) :
  tout ce que vous créez est réel, visible dans l'interface et partagé avec
  l'équipe.
- Toutes les opérations sont **cloisonnées par marque**. Le paramètre `brand` est
  obligatoire partout. Une demande qui parle de « Tag2Share » sans autre précision
  vise en principe le **produit** Tag2Share (`brand: "tag2share"`). En cas de
  doute, demandez à l'utilisateur de quel produit il s'agit.
- Premier appel conseillé : `list_brands`. S'il échoue ou si les outils
  `mcp__tag2share__*` sont absents, le serveur n'est pas chargé dans la session.
  Signalez-le à l'utilisateur au lieu de chercher un autre chemin : pas d'appel
  direct à l'API, pas d'accès à Supabase, pas de secret à demander.

## 2. Règles impératives

1. **Marque explicite.** Passez toujours le slug exact renvoyé par `list_brands`.
   Une campagne créée sur la mauvaise marque part avec une autre identité
   d'expédition. Si l'utilisateur ne la nomme pas mais que la session travaille
   dans le projet d'une marque (dossier ou dépôt à son nom, par exemple
   `eazzy`), prenez cette marque et **annoncez-la** dans le récapitulatif.
   Sinon, demandez.
2. **Rien de public sans accord explicite de l'utilisateur.** Programmer un post
   le rendra public à sa date, sans autre intervention. Avant tout
   `schedule_social_post` en mode `schedule`, présentez un résumé (marque,
   réseaux, date et heure locales, texte, médias) et attendez un « oui » clair.
   `confirm: true` ne se pose qu'après ce oui. Pour une série, un seul accord
   peut couvrir plusieurs posts si le récapitulatif les liste **un par un**
   (date, réseaux, texte, média) ; il ne s'étend jamais à un post absent du
   récapitulatif ni à un post modifié depuis.
3. **Tester avant de programmer.** Pour le premier post d'une marque ou d'un
   canal, faites d'abord un `buffer_draft` : le post arrive en brouillon dans
   Buffer et rien n'est publié.
4. **Dates avec fuseau, toujours.** Format ISO 8601 avec décalage, par exemple
   `2026-10-14T09:30:00+02:00`. Heure de Bruxelles : `+02:00` jusqu'au
   25/10/2026 à 3 h, puis `+01:00` jusqu'au 28/03/2027. Une date sans fuseau est
   refusée.
5. **Jamais de tiret cadratin** (le tiret long, caractère Unicode U+2014) dans les textes
   produits, emails comme posts. Utilisez une virgule, deux-points ou des
   parenthèses.
6. **Ne jamais inventer d'identifiant.** `segment_ids`, `campaign_id`,
   `variant id`, `channel_ids`, `post_id` et `storage_path` viennent toujours de
   la réponse d'un outil.
7. **Médias réels uniquement.** Fichiers locaux qui sont de vraies images,
   vidéos ou PDF, ou URL **https publiques**. Le type est lu dans le contenu du
   fichier, et les adresses locales ou privées sont refusées.

## 3. Les marques (produits gérés par l'outil)

État au 02/10/2026, à revérifier avec `list_brands` et `get_social_setup`.
L'outil a sa propre adresse (`marketing.tag2share.com`), mais chaque marque a
aussi la sienne (`app_url` dans `list_brands`, par exemple
`marketing.horodo.be`) : c'est le même outil, présenté aux couleurs de la marque.

| Slug | Produits (clé = nom) | Envoi d'emails réels | Buffer |
| --- | --- | --- | --- |
| `horodo` | `general` = Horodo, `starter`, `pro`, `entreprise` | oui | connecté : Instagram, Facebook, LinkedIn |
| `tag2share` (le produit, pas l'outil) | `keyring` = Porte-clé connecté, `card` = Carte de visite connectée, `stand` = Présentoir connecté | non : adresse de test manquante | non connecté |
| `voxado` | `general` = Voxado, `starter`, `pro`, `premium` | oui | connecté : Instagram, Facebook, LinkedIn |
| `eazzy` | `general` = Eazzy, `pack-base` = l'accompagnement en 4 étapes | oui | non connecté |

Une marque non connectée à Buffer peut recevoir des posts en **brouillon**,
mais sans canal : rien n'est programmable tant que sa clé Buffer n'est pas
connectée dans `/social`.

- `can_send` (dans `list_brands`) dit si une campagne de cette marque peut
  partir pour de vrai. S'il est faux, `blockers` explique pourquoi.
- La connexion Buffer et les canaux (Instagram, Facebook, LinkedIn...) se
  vérifient marque par marque avec `get_social_setup`.

## 4. Référence des outils

### Campagnes email

| Outil | Paramètres | Effet |
| --- | --- | --- |
| `list_brands` | aucun | Marques, `can_send`, blocages. |
| `list_segments` | `brand` | Segments (cibles) avec `prospect_count`. |
| `list_campaigns` | `brand` | Campagnes : statut, segments, variantes, `variants_valid`. |
| `get_campaign` | `brand`, `campaign_id` | Détail : sujet et corps de chaque variante, destinataires par statut. |
| `create_campaign` | `brand`, `name`, `segment_ids[]`, `subject?`, `body_html?` | Crée une campagne **brouillon** avec une variante A à 100 %. Sans sujet ni corps : le template type de la marque. |
| `add_campaign_variant` | `brand`, `campaign_id`, `name?`, `subject?`, `body_html?`, `email_tagline?`, `product?`, `weight?`, `copy_from?` | Ajoute une variante pour un test A/B. Sans `weight`, toutes les variantes sont rééquilibrées (100/n). Sans texte, copie de l'existant (ou de `copy_from`). |
| `set_campaign_variants` | `brand`, `campaign_id`, `variants[]` (`id` obligatoire, puis `name`, `subject`, `body_html`, `email_tagline`, `product`, `weight`) | Met à jour plusieurs variantes d'un coup, surtout les poids. L'ordre du tableau devient l'ordre d'affichage. |

Réponse des outils de variantes : `valid` (la somme des poids fait 100) et
`warning` sinon. **Une campagne dont la somme ne fait pas 100 refuse de partir.**

### Réseaux sociaux

| Outil | Paramètres | Effet |
| --- | --- | --- |
| `get_social_setup` | `brand`, `refresh_channels?` | Clé Buffer connectée ou non, canaux (`id`, `service`, `name`, `usable`), destinataire des notifications, `next_step` si quelque chose manque. `refresh_channels: true` relit Buffer (quota limité : seulement si un canal manque). |
| `list_social_posts` | `brand`, `from?`, `to?` | Calendrier : format, statut, date (`scheduled_at_local`), réseaux visés. Sans plage : tous les posts, brouillons compris. |
| `get_social_post` | `brand`, `post_id` | Détail complet, médias avec leur `storage_path`, statut par réseau, et `check`. |
| `create_social_post` | `brand`, `format`, `text`, `title?`, `scheduled_at?`, `channel_ids?`, `media?`, `first_comment?`, `notify?`, `notify_email?` | Crée un post **brouillon** (rien ne part vers Buffer) et envoie les médias. |
| `update_social_post` | `brand`, `post_id`, puis seulement les champs à changer, `reschedule?` | Modifie un post. `media` et `channel_ids`, s'ils sont fournis, **remplacent la liste entière**. |
| `schedule_social_post` | `brand`, `post_id`, `mode` (`buffer_draft` ou `schedule`), `confirm: true` | Envoie à Buffer. `buffer_draft` : brouillon Buffer, rien de publié. `schedule` : programmé à sa date, au moins 2 minutes dans le futur. |
| `unschedule_social_post` | `brand`, `post_id` | Retire le post de Buffer et le remet en brouillon. Ce qui est déjà publié reste en ligne. |

**`check`** (renvoyé par `get_social_post`, `create_social_post`,
`update_social_post`) :

- `errors` : ce qui bloque la programmation. Tant que la liste n'est pas vide, `schedule_social_post` refuse.
- `warnings` : à signaler à l'utilisateur, sans bloquer.
- `schedulable` : `true` si les règles sont respectées ET la date est assez lointaine.

**Médias** (`media`, 12 au maximum, dans l'ordre d'affichage) : chaque élément
porte une seule source.

| Source | Exemple | Remarque |
| --- | --- | --- |
| `file` | `{"file": "/Users/.../visuel.jpg"}` | Fichier sur la machine de la session. `~/` accepté. |
| `url` | `{"url": "https://site.be/img/visuel.png"}` | https public seulement. |
| `storage_path` | `{"storage_path": "horodo/2026-10/....jpg"}` | Média déjà stocké (lu dans `get_social_post`), réutilisable dans un autre post de la marque. |

Option `thumbnail_file` : vignette PNG ou JPEG à la place de celle calculée
(PDF, vidéo). La vignette d'un PDF est obligatoire pour LinkedIn, mais elle est
calculée automatiquement.

## 5. Rédiger un email de campagne

- `body_html` est du HTML avec styles **inline**. Le plus sûr : partir d'une
  variante existante (`get_campaign`) et garder sa structure, notamment le **pied
  de page** (identité légale de l'entreprise, mention de désinscription
  « Répondez stop »).
- Variables disponibles :

| Variable | Contenu | Remarque |
| --- | --- | --- |
| `{{name}}` | Nom de l'entreprise prospectée | toujours rempli |
| `{{city}}` | Ville | presque toujours rempli |
| `{{category}}` | Catégorie / secteur | toujours rempli |
| `{{contact_name}}` | Personne de contact | **à éviter** : quasi jamais rempli |
| `{{country}}`, `{{address}}`, `{{phone}}`, `{{website}}`, `{{logo_url}}` | Champs du prospect | remplissage variable |
| `{{product_name}}`, `{{product_url}}`, `{{config_url}}`, `{{products_more}}` | Produit mis en avant (catalogue de la marque) | toujours disponibles |

- **Attention : chaque variable prospect utilisée devient obligatoire.** Un
  prospect à qui elle manque est écarté de la campagne. Toutes les variantes
  comptent : utiliser `{{contact_name}}` dans une seule variante écarte presque
  tous les prospects (1 sur 1521 chez Horodo, 85 sur 1152 chez Tag2Share).
- Le produit mis en avant suit cet ordre : variante (`product`), puis campagne,
  puis segment du prospect. Utilisez seulement les clés du tableau des marques.
- Liens : ajoutez des paramètres UTM explicites, par exemple
  `?utm_source=email&utm_medium=prospection&utm_campaign=<nom-court>-a`.
- Après la création, les **destinataires** s'ajoutent dans l'interface, puis
  l'utilisateur s'envoie un **email de test** avant tout envoi réel. Le MCP ne
  fait ni l'un ni l'autre.

## 6. Réseaux sociaux : règles par format et par réseau

### Formats

| Format | Instagram / Facebook | LinkedIn | Autres réseaux |
| --- | --- | --- | --- |
| `post` | texte + au plus 1 visuel (image ou vidéo). Instagram exige un visuel. | idem | idem |
| `reel` | 1 vidéo, publiée en **réel** | vidéo classique | vidéo classique |
| `carousel` | **2 à 10 images** | **1 PDF** (carrousel document) | les images |

Un carrousel multi-réseaux contient **les images ET le PDF dans le même post** :
chaque réseau reçoit ce qui le concerne. Pour LinkedIn, c'est à vous de fournir
le PDF (une page par image). Le MCP ne l'assemble pas.

### Limites contrôlées avant l'envoi

| Règle | Valeur |
| --- | --- |
| Texte | Instagram 2200, LinkedIn 3000, Facebook 63206, X 280, Threads 500, TikTok 2200, Pinterest 500, Bluesky 300, Mastodon 500 caractères |
| Images | JPG, PNG, WebP, GIF, 10 Mo |
| Vidéos | MP4, MOV, 100 Mo en théorie, **50 Mo en pratique** (limite du stockage Supabase) |
| PDF | 100 Mo, vignette obligatoire (calculée) |
| Images par post | X et Bluesky : 4 au maximum |
| Vidéo obligatoire | TikTok, YouTube |
| Image obligatoire | Pinterest |
| Premier commentaire (`first_comment`) | Instagram, Facebook, LinkedIn seulement (ignoré ailleurs) |
| Réel | format réel sur Instagram et Facebook seulement |

Vidéo trop lourde : la recompresser avant l'envoi, par exemple
`ffmpeg -i in.mov -vf "scale=1080:-2" -c:v libx264 -crf 26 -preset slow -c:a aac -b:a 128k out.mp4`.

### Notification

À la publication, un email part avec le lien public de chaque réseau (ou
l'erreur). Destinataire : `notify_email` du post, sinon celui de la marque.
`notify: false` le désactive.

## 7. Recettes

### A. Campagne email A/B sur un segment

1. `list_segments {"brand": "horodo"}` : choisir le segment et noter son `id`.
2. `list_campaigns {"brand": "horodo"}` puis `get_campaign` sur une campagne
   récente, pour reprendre la structure HTML et le pied de page.
3. `create_campaign {"brand": "horodo", "name": "Toiture - octobre 2026", "segment_ids": ["<id>"], "subject": "...", "body_html": "..."}`
4. `add_campaign_variant {"brand": "horodo", "campaign_id": "<id>", "name": "Variante B", "subject": "...", "body_html": "..."}`
5. Vérifier `valid: true`. Pour des parts différentes, utiliser
   `set_campaign_variants` avec des poids dont la somme fait 100.
6. Dire à l'utilisateur d'ajouter les destinataires et de s'envoyer un test dans
   l'interface.

### B. Publication avec image sur Instagram, Facebook et LinkedIn

1. `get_social_setup {"brand": "horodo"}` : noter les `id` des canaux `usable`.
2. `create_social_post {"brand": "horodo", "format": "post", "title": "Annonce article heures sup", "text": "...", "scheduled_at": "2026-10-14T09:30:00+02:00", "channel_ids": ["<ig>", "<fb>", "<li>"], "media": [{"file": "/chemin/visuel.jpg"}]}`
3. Lire `check`. S'il y a des `errors`, corriger avec `update_social_post`.
4. Résumer le post à l'utilisateur et demander son accord (voir 2.2).

### C. Réel

`create_social_post` avec `"format": "reel"` et **une seule vidéo** dans `media`.
Sur les réseaux sans format réel, la vidéo part en publication classique (un
`warning` le signale).

### D. Carrousel Instagram / Facebook + LinkedIn

```json
{
  "brand": "horodo",
  "format": "carousel",
  "text": "...",
  "channel_ids": ["<ig>", "<fb>", "<li>"],
  "media": [
    {"file": "/chemin/slide-1.png"},
    {"file": "/chemin/slide-2.png"},
    {"file": "/chemin/slide-3.png"},
    {"file": "/chemin/carrousel-linkedin.pdf"}
  ]
}
```

### E. Tester dans Buffer, puis programmer

1. `schedule_social_post {"brand": "horodo", "post_id": "<id>", "mode": "buffer_draft", "confirm": true}` : rien n'est publié. L'outil exige aussi `confirm: true` ici ; prévenez l'utilisateur que le post arrive en brouillon dans son Buffer. Lire `results` : un résultat par canal.
2. Si tout est bon, et **après l'accord explicite de l'utilisateur** :
   `schedule_social_post {"brand": "horodo", "post_id": "<id>", "mode": "schedule", "confirm": true}`.

### F. Modifier un post déjà programmé

1. `get_social_post` pour lire l'état actuel (et les `storage_path` à garder).
2. Demander l'accord de l'utilisateur : la modification retire le post de Buffer
   puis le reprogramme.
3. `update_social_post {"brand": "horodo", "post_id": "<id>", "text": "...", "reschedule": true}`.

Pour changer un seul média, renvoyez la liste complète : les `storage_path` à
garder, plus les nouveaux `file`.

### G. Programmer une série de médias déjà prêts

Demande typique : « utilise marketing pour programmer les réels ». Les fichiers
existent déjà, l'utilisateur veut qu'ils soient placés au calendrier.

1. **Trouver les fichiers** si aucun chemin n'est donné : chercher dans le projet
   courant les vidéos (`.mp4`, `.mov`) pour des réels, les images pour des
   publications ou carrousels. Écarter ce qui ressemble à des rushes ou des
   exports intermédiaires, et demander en cas de doute.
2. **Trouver les textes** : légende dans un fichier du même nom (`.txt`, `.md`),
   un fichier de planning, ou le nom du fichier lui-même. À défaut, rédiger une
   légende par média (regarder la vidéo si un outil le permet).
3. **Vérifier la marque et ses canaux** : `get_social_setup`. Sans clé Buffer ou
   sans canal, créer seulement les brouillons et le dire.
4. **Proposer un calendrier** si l'utilisateur n'en donne pas : un rythme
   régulier (par exemple mardi et jeudi, en fin de matinée), sans collision avec
   les posts déjà prévus (`list_social_posts`), avec le bon fuseau de part et
   d'autre du 25/10.
5. **Créer tous les posts en brouillon** (`create_social_post`, un post par
   réel), puis présenter **un tableau récapitulatif** : date locale, fichier,
   début de légende, réseaux, et les `warnings` éventuels.
6. **Après accord** : `buffer_draft` sur le premier post, puis vérification par
   l'utilisateur dans Buffer.
7. **Après confirmation** : `schedule` sur tous les posts du tableau, puis
   compte rendu par post (`results`).

### H. Annuler une programmation

`unschedule_social_post {"brand": "horodo", "post_id": "<id>"}` : le post revient
en brouillon. La suppression d'un post se fait dans l'interface.

## 8. Erreurs fréquentes

| Message (extrait) | Cause | Que faire |
| --- | --- | --- |
| `Marque inconnue` | slug mal écrit | `list_brands`, puis le slug exact |
| `Application injoignable` | prod indisponible ou réseau coupé | réessayer plus tard, prévenir l'utilisateur |
| `Authentification refusée (401)` | mot de passe de l'app modifié | prévenir l'utilisateur (configuration du MCP) |
| `Aucune clé Buffer` (`next_step`) | Buffer pas connecté pour la marque | l'utilisateur connecte la clé dans `/social` |
| `Canal inconnu ou inutilisable` | id inventé, canal désactivé ou nouveau | `get_social_setup`, au besoin avec `refresh_channels: true` |
| `scheduled_at ... avec fuseau` | date sans décalage horaire | ajouter `+02:00` ou `+01:00` |
| `Post non programmable : ...` | règles de format non respectées | corriger chaque point listé |
| `La date de publication doit être au moins 2 minutes dans le futur` | date passée ou trop proche | changer `scheduled_at` |
| `Ce post est programmé dans Buffer ... reschedule: true` | modification d'un post programmé | accord de l'utilisateur, puis `reschedule: true` |
| `Ce post est déjà publié` | post en ligne | créer un nouveau post |
| `son contenu n'est pas un média accepté` | fichier qui n'est pas une vraie image, vidéo ou PDF | fournir le bon fichier |
| `URL refusée (https seulement)`, `adresse ... refusée` | URL en http, locale ou privée | URL https publique, ou fichier local |
| `dépasse la taille autorisée par Supabase Storage` | vidéo de plus de 50 Mo | recompresser (voir section 6) |
| `La somme des parts ne fait pas 100` | poids des variantes | `set_campaign_variants` |

## 9. Ce que le MCP ne fait pas

Renvoyez l'utilisateur vers l'interface (`https://marketing.tag2share.com`, ou
l'`app_url` de la marque dans `list_brands`) pour :

- ajouter les destinataires d'une campagne, envoyer un test, lancer l'envoi ;
- créer des segments, chercher ou importer des prospects, gérer les
  désinscriptions ;
- connecter la clé Buffer d'une marque, activer ou désactiver un canal (`/social`) ;
- supprimer un post ou une campagne ;
- publier un post **immédiatement** (le MCP ne fait que programmer à une date).
