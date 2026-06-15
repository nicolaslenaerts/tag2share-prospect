/**
 * Liens de désinscription signés (HMAC) - aucun stockage de token nécessaire :
 * le lien se vérifie tout seul. L'email du destinataire figure en clair dans
 * l'URL (c'est sa propre adresse), accompagné d'une signature.
 */
import crypto from "crypto";
import { normEmail } from "./suppression";

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

export function sign(email: string): string {
  return crypto.createHmac("sha256", secret()).update(normEmail(email)).digest("hex").slice(0, 32);
}

export function verify(email: string, token: string): boolean {
  if (!email || !token) return false;
  const expected = sign(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** URL de désinscription pour un destinataire donné. */
export function unsubscribeUrl(email: string): string {
  const e = normEmail(email);
  return `${appUrl()}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${sign(e)}`;
}
