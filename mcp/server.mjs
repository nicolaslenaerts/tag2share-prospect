#!/usr/bin/env node
/**
 * Serveur MCP (transport stdio) de l'outil de prospection.
 *
 * Pas de dépendance : le protocole se réduit ici à du JSON-RPC 2.0 en lignes
 * sur stdin/stdout, avec quatre méthodes (initialize, tools/list, tools/call,
 * ping). Tirer le SDK officiel dans package.json ajouterait une dépendance à
 * une application Next qui ne s'en sert jamais, et un « pnpm install » entre
 * le dépôt et un serveur capable de démarrer.
 *
 * ⚠️ stdout est RÉSERVÉ au protocole. Tout diagnostic part sur stderr.
 */
import { TOOLS } from "./tools.mjs";
import { loadEnv, baseUrl } from "./client.mjs";

loadEnv();

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "tag2share-prospect", version: "1.0.0" };

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  if (id === undefined || id === null) return; // notification : rien à répondre
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

/* ------------------------------------------------------------------ */
/* Méthodes                                                            */
/* ------------------------------------------------------------------ */

async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      // On renvoie la version demandée par le client quand on la connaît :
      // ce serveur ne dépend d'aucune nouveauté de révision.
      return reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return;

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const tool = byName.get(params?.name);
      if (!tool) return replyError(id, -32602, `Outil inconnu : ${params?.name}`);
      try {
        const result = await tool.run(params.arguments ?? {});
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        // Erreur MÉTIER (marque inconnue, segment hors marque, app éteinte) :
        // elle appartient au résultat de l'outil, pas au transport — l'agent
        // doit pouvoir la lire et corriger son appel plutôt que de la voir
        // remonter comme une panne du serveur.
        return reply(id, {
          isError: true,
          content: [{ type: "text", text: e.message }],
        });
      }
    }

    default:
      return replyError(id, -32601, `Méthode non gérée : ${method}`);
  }
}

/* ------------------------------------------------------------------ */
/* Boucle                                                              */
/* ------------------------------------------------------------------ */

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } });
      continue;
    }
    handle(msg).catch((e) => replyError(msg.id, -32603, e.message));
  }
});
process.stdin.on("end", () => process.exit(0));

console.error(`[mcp] tag2share-prospect prêt, cible : ${baseUrl()}`);
