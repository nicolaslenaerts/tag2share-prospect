# Serveur MCP — tag2share-prospect

Expose l'outil de prospection à Claude Code : lire les marques, les segments et
les campagnes, créer une campagne sur un segment, lui ajouter des variantes
d'email ; préparer et programmer les posts réseaux sociaux (publication, réel,
carrousel) publiés via Buffer.

## Ce que c'est (et ce que ce n'est pas)

Le serveur est un **client HTTP de l'API interne** (`app/api/*`), pas un second
accès à la base. Créer une campagne déclenche côté API la création de sa
première variante à 100 %, les liaisons `campaign_segments` et le contrôle que
les segments appartiennent bien à la marque ; ajouter une variante recalcule les
poids et **réaffecte les destinataires** (`lib/campaign-variants.ts`). Réécrire
tout cela contre Supabase produirait des campagnes à moitié formées.

Conséquence directe : **l'application doit tourner**. En local, `npm run dev`.

Aucune dépendance npm : le transport stdio tient dans `server.mjs`.

## Configuration

`.mcp.json` à la racine déclare le serveur. Il lit `.env.local` du projet — donc
rien à configurer si vous développez déjà sur ce dépôt.

| Variable | Rôle |
| --- | --- |
| `APP_PASSWORD` | **Requis.** Sert à reconstruire le jeton de session (même HMAC que le cookie `t2s_auth`). Aucun second secret n'est introduit. |
| `T2S_MCP_BASE_URL` | Instance visée. Défaut : **`http://localhost:3000`**, toujours. Pas de repli sur `APP_URL` : cette variable vaut la production sur un poste de dev, et l'agent écrirait en production sans que personne ne l'ait demandé. |

Pour viser la production depuis Claude Code, renseignez le bloc `env` de
`.mcp.json` — ce qui y est posé **prime** sur `.env.local` :

```json
{ "mcpServers": { "tag2share": {
  "command": "node",
  "args": ["mcp/server.mjs"],
  "env": { "T2S_MCP_BASE_URL": "https://prospect.example.com" }
} } }
```

## Outils

| Outil | Effet |
| --- | --- |
| `list_brands` | Marques, et si l'envoi réel y est autorisé. |
| `list_segments` | Segments d'une marque + nombre de prospects. |
| `list_campaigns` | Campagnes d'une marque, avec la validité de la répartition des variantes. |
| `get_campaign` | Détail : variantes complètes, destinataires comptés par statut. |
| `create_campaign` | Nouvelle campagne (brouillon) sur un ou plusieurs segments. |
| `add_campaign_variant` | Ajoute un template à une campagne. |
| `set_campaign_variants` | Met à jour textes et **poids** en bloc. |

### Réseaux sociaux (Buffer)

| Outil | Effet |
| --- | --- |
| `get_social_setup` | Clé Buffer connectée ou non, canaux utilisables (leurs `channel_ids`). |
| `list_social_posts` | Calendrier de la marque, sur une plage ou en entier. |
| `get_social_post` | Détail d'un post, médias et `check` (ce qui bloque sa programmation). |
| `create_social_post` | Nouveau post (publication, réel, carrousel) en **brouillon**, médias envoyés au passage. |
| `update_social_post` | Modifie les champs fournis ; `reschedule: true` si le post est déjà programmé. |
| `schedule_social_post` | `buffer_draft` (test, rien ne part) ou `schedule` (à sa date), `confirm: true` exigé. |
| `unschedule_social_post` | Retire le post de Buffer et le ramène en brouillon. |

Médias : chaque élément est un fichier local (`file`), une URL (`url`,
téléchargée) ou un média déjà stocké (`storage_path`). Tout finit dans un bucket
PUBLIC, d'où deux garde-fous : le type est lu dans le **contenu** du fichier
(signature des premiers octets, jamais l'extension ni un paramètre), et une URL
se télécharge en **https seulement**, adresses du poste et du réseau local
refusées au moment de la connexion, redirections comprises. Le serveur lit les
dimensions, rend la vignette d'un PDF (exigée par LinkedIn) et d'une vidéo, puis
envoie le fichier directement à Supabase par l'URL signée de l'API, comme
l'éditeur. Vignettes : `pdftoppm` et `ffmpeg` s'ils sont installés
(`brew install poppler ffmpeg`), sinon `sips` / `qlmanage` de macOS. Pour un
carrousel LinkedIn, l'agent fournit le PDF : le serveur ne l'assemble pas depuis
les images.

Dates : ISO 8601 **avec fuseau** (`2026-10-05T09:30:00+02:00`). Une date sans
fuseau est refusée, le serveur la lirait en UTC.

Toute opération est **cloisonnée par marque** : le paramètre `brand` est validé
contre le registre avant écriture. L'API, elle, retombe silencieusement sur la
marque par défaut quand le slug est inconnu (comportement voulu pour un
navigateur, dangereux pour un agent) : voir `mcp/brand.mjs`.

## Ce que le serveur ne fait pas

Aucun outil n'**envoie d'email**, ne synchronise les destinataires ni ne
supprime quoi que ce soit. Une campagne créée ici naît en brouillon et reste
inerte tant qu'un humain ne la lance pas depuis l'interface.

Côté réseaux sociaux, l'agent peut **programmer** un post à sa date (après
accord explicite de l'utilisateur, `confirm: true`), mais **jamais le publier
immédiatement** : le mode `now` de l'API n'est pas exposé. Un post programmé se
retire jusqu'à sa date ; un post parti à l'instant ne se rattrape pas. Le
serveur ne supprime pas de post et ne touche pas à la clé Buffer, qui se
connecte dans `/social`.

## Vérification

```bash
node mcp/selftest.mjs
```
