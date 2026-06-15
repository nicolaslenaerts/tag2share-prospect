# Tag2Share - Prospection

App Next.js **autonome** (indépendante de l'app tag2share / profile-card-creator) pour :

1. **Proposer des types de business** (via Gemini) qui auraient besoin des objets connectés Tag2Share (porte-clé, carte de visite, présentoir).
2. **Rechercher** ces business via **Google Maps / Places** (pays sélectionnable : Belgique / France).
3. **Enrichir** chaque prospect : email, personne de contact, logo, réseaux sociaux, depuis leur site web.
4. **Campagne email** : template éditable avec variables `{{name}}`, `{{contact_name}}`, etc., adaptation par prospect, **email de test** vers votre adresse, puis **envoi réel uniquement après confirmation explicite** via Resend.

> 🔒 **Sécurité** : aucun email n'est envoyé sans action explicite. L'envoi réel exige `confirm: true` côté serveur + une confirmation tapée (`ENVOYER`) côté interface. Les tests sont toujours redirigés vers votre adresse.

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
- Le logo email pointe vers le bucket Supabase de l'app tag2share existante. Vous pouvez héberger un logo propre et changer `LOGO_URL` dans `lib/email.ts`.
- IA secondaires (Claude, Mistral) : clés présentes dans `.env.local`, non câblées par défaut (Gemini est le moteur principal choisi).
