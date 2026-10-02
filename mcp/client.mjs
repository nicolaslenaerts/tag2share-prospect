/**
 * Client HTTP de l'API interne, pour le serveur MCP.
 *
 * Le serveur MCP ne parle PAS à Supabase : il appelle les mêmes routes que
 * l'interface. Toute la logique métier (création de la variante initiale à
 * 100 %, liaisons campaign_segments, redistribution des destinataires entre
 * variantes) vit dans les route handlers ; la dupliquer ici produirait des
 * campagnes à moitié formées dès la première divergence.
 *
 * Authentification : on reconstruit le MÊME jeton que le cookie de session
 * (HMAC-SHA256 de APP_PASSWORD), plutôt que d'ajouter un second secret à
 * gérer et à révoquer. Le middleware ne voit donc aucune différence entre
 * Claude Code et un navigateur connecté.
 *
 * Marque : elle voyage par le COOKIE `brand`, pas par l'en-tête `x-brand` —
 * le middleware retire tout `x-brand` entrant (choisir sa marque depuis le
 * réseau serait une porte ouverte) et le repose lui-même d'après le cookie.
 */
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Charge .env.local / .env du projet, SANS écraser ce que le parent a fourni.
 *
 * L'ordre compte : Claude Code peut passer des variables dans .mcp.json (par
 * exemple pour viser la production), et un fichier .env.local du dépôt ne doit
 * pas silencieusement reprendre la main dessus.
 */
export function loadEnv() {
  const fromParent = new Map(Object.entries(process.env));
  for (const file of [".env", ".env.local"]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
    } catch (e) {
      console.error(`[mcp] ${file} illisible : ${e.message}`);
    }
  }
  for (const [k, v] of fromParent) process.env[k] = v;
}

/** Doit rester identique à MESSAGE dans lib/auth.ts. */
const AUTH_MESSAGE = "t2s-authenticated-v1";
const AUTH_COOKIE = "t2s_auth";
const BRAND_COOKIE = "brand";

function authToken() {
  const pw = process.env.APP_PASSWORD;
  if (!pw)
    throw new Error(
      "APP_PASSWORD manquant : le serveur MCP ne peut pas s'authentifier. " +
        "Renseignez-le dans .env.local ou dans le bloc env de .mcp.json."
    );
  return createHmac("sha256", pw).update(AUTH_MESSAGE).digest("hex");
}

/**
 * Instance visée. Par défaut le serveur de dev LOCAL, toujours.
 *
 * Volontairement sans repli sur APP_URL : cette variable désigne l'URL
 * publique de l'application (liens de désinscription, webhooks) et vaut la
 * production sur un poste de développement ordinaire. S'y rabattre ferait
 * écrire l'agent en production sans que personne ne l'ait demandé. Viser une
 * autre instance est donc une déclaration EXPLICITE, via T2S_MCP_BASE_URL.
 */
export function baseUrl() {
  const raw = process.env.T2S_MCP_BASE_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * Appelle une route de l'API. `brand` choisit la marque active de la requête.
 *
 * Les erreurs sont remontées telles quelles : les handlers répondent déjà
 * `{ error: "..." }` en français, c'est le message le plus utile à afficher.
 */
export async function request(pathname, { method = "GET", body, brand } = {}) {
  const cookies = [`${AUTH_COOKIE}=${authToken()}`];
  if (brand) cookies.push(`${BRAND_COOKIE}=${encodeURIComponent(brand)}`);

  const url = baseUrl() + pathname;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", cookie: cookies.join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Application injoignable sur ${baseUrl()} (${e.cause?.code || e.message}). ` +
        "Lancez « npm run dev », ou pointez T2S_MCP_BASE_URL sur l'instance déployée."
    );
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }

  if (res.status === 401)
    throw new Error(
      "Authentification refusée (401) : APP_PASSWORD ne correspond pas à celui de l'instance visée."
    );
  if (!res.ok)
    throw new Error(data?.error || `HTTP ${res.status} sur ${pathname}`);
  return data;
}
