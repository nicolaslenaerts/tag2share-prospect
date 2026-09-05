/**
 * URL PUBLIQUE de l'outil, quand celui-ci répond sur PLUSIEURS domaines.
 *
 * Un déploiement unique peut servir marketing.tag2share.com et
 * marketing.horodo.be. Tout lien hébergé par l'app et visible par un prospect
 * - aujourd'hui le lien de désinscription du pied d'email - doit sortir sur le
 * domaine de SA marque : un email signé Horodo dont le lien de désinscription
 * pointe vers tag2share.com révèle une enseigne que le destinataire ne connaît
 * pas, et un domaine de lien étranger au domaine d'envoi pèse sur la
 * délivrabilité.
 *
 * Ordre de résolution :
 *   1. `appUrl` déclaré par la marque          → la réponse juste
 *   2. domaine de la requête en cours, s'il est CONNU → utile tant qu'une
 *      marque n'a pas encore le sien
 *   3. variable d'environnement APP_URL        → domaine commun historique
 *   4. http://localhost:3000                   → développement
 *
 * ⚠️ Module SERVEUR : l'étape 2 lit le registre en base.
 */
import { loadBrands } from "./brands/store";
import { normalizeDomain } from "./brands/schema";
import type { BrandConfig } from "./brands/types";

const trim = (v: string) => v.trim().replace(/\/+$/, "");

/**
 * Domaine COMMUN, utilisé par les marques qui n'en déclarent pas. Avec
 * plusieurs domaines servis, ce n'est plus « l'URL de l'app » mais seulement
 * son défaut : la vraie adresse d'une marque se déclare dans /marques.
 */
export function appUrl(): string {
  return trim(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  );
}

/**
 * Origine de la requête en cours (`https://marketing.horodo.be`).
 * L'en-tête Host est une donnée fournie par le client : elle n'est utilisée
 * qu'après recoupement avec les domaines connus (voir publicBaseFor).
 */
export function requestOrigin(req: Request): string | undefined {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    .trim();
  if (!host) return undefined;
  const proto =
    (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Base publique d'une marque, SANS consulter la requête. Suffit partout où
 * l'on n'a pas d'objet Request sous la main.
 */
export function brandAppUrl(brand: Pick<BrandConfig, "appUrl">): string {
  return trim(brand.appUrl || "") || appUrl();
}

/**
 * Base publique d'une marque, en tenant compte du domaine par lequel la
 * requête est arrivée.
 *
 * Le domaine de la requête n'est retenu que s'il est DÉCLARÉ quelque part
 * (URL publique d'une marque, ou APP_URL). Sans ce recoupement, un en-tête
 * Host falsifié placerait l'adresse d'un tiers dans le lien de désinscription
 * d'emails réellement envoyés.
 */
export async function publicBaseFor(
  brand: Pick<BrandConfig, "appUrl">,
  req?: Request
): Promise<string> {
  const own = trim(brand.appUrl || "");
  if (own) return own;

  if (req) {
    const origin = requestOrigin(req);
    const host = origin ? normalizeDomain(origin) : "";
    if (host) {
      const known = new Set<string>([normalizeDomain(appUrl())]);
      for (const b of await loadBrands()) {
        if (b.appUrl) known.add(normalizeDomain(b.appUrl));
      }
      if (known.has(host)) return origin!;
    }
  }

  return appUrl();
}

/**
 * URL du webhook Resend à déclarer pour cette marque. Un seul endpoint par
 * domaine suffit : tous mènent au même déploiement.
 */
export function webhookUrl(brand: Pick<BrandConfig, "appUrl">): string {
  return `${brandAppUrl(brand)}/api/webhooks/resend`;
}
