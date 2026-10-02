# Serveur MCP — tag2share-prospect

Expose l'outil de prospection à Claude Code : lire les marques, les segments et
les campagnes, créer une campagne sur un segment, lui ajouter des variantes
d'email.

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

Toute opération est **cloisonnée par marque** : le paramètre `brand` est validé
contre le registre avant écriture. L'API, elle, retombe silencieusement sur la
marque par défaut quand le slug est inconnu (comportement voulu pour un
navigateur, dangereux pour un agent) : voir `mcp/brand.mjs`.

## Ce que le serveur ne fait pas

Aucun outil n'**envoie d'email**, ne synchronise les destinataires ni ne
supprime quoi que ce soit. Une campagne créée ici naît en brouillon et reste
inerte tant qu'un humain ne la lance pas depuis l'interface.

## Vérification

```bash
node mcp/selftest.mjs
```
