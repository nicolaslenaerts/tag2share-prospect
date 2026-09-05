/**
 * Liens de désinscription signés (HMAC) - aucun stockage de token nécessaire :
 * le lien se vérifie tout seul. L'email du destinataire figure en clair dans
 * l'URL (c'est sa propre adresse), accompagné de la marque et d'une signature.
 *
 * MULTI-MARQUE : la signature couvre "<marque>:<email>" pour qu'un lien ne
 * puisse pas être rejoué d'une marque sur une autre, et pour que la page de
 * confirmation affiche la bonne identité.
 *
 * ⚠️ RÉTRO-COMPATIBILITÉ : des emails déjà partis portent des liens signés
 * SANS marque (HMAC de l'email seul). Ces liens doivent continuer de
 * fonctionner - une désinscription qui échoue est un risque de plainte spam,
 * pas un simple bug. Ils sont acceptés uniquement pour la marque par défaut,
 * seule à avoir émis dans cet ancien format.
 */
import crypto from "crypto";
import { normEmail } from "./suppression";
import { DEFAULT_BRAND } from "./brands";

function secret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-unsubscribe-secret"
  );
}

/** Base URL publique de l'app (pour des liens absolus dans les emails). */
export function appUrl(): string {
  const url =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
}

/** Signature courante : liée à la marque ET à l'adresse. */
export function sign(email: string, brandSlug: string): string {
  return hmac(`${brandSlug}:${normEmail(email)}`);
}

/** Ancien format (email seul), conservé pour les emails déjà envoyés. */
function signLegacy(email: string): string {
  return hmac(normEmail(email));
}

function equals(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Vérifie un token de désinscription. Accepte le format courant pour toute
 * marque, et l'ancien format uniquement pour la marque par défaut.
 */
export function verify(email: string, token: string, brandSlug: string): boolean {
  if (!email || !token) return false;
  if (equals(sign(email, brandSlug), token)) return true;
  if (brandSlug === DEFAULT_BRAND.slug && equals(signLegacy(email), token)) return true;
  return false;
}

/** URL de désinscription pour un destinataire d'une marque donnée. */
export function unsubscribeUrl(email: string, brandSlug: string): string {
  const e = normEmail(email);
  const params = new URLSearchParams({ e, b: brandSlug, t: sign(e, brandSlug) });
  return `${appUrl()}/api/unsubscribe?${params.toString()}`;
}
