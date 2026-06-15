/**
 * Authentification par mot de passe partagé (outil interne mono-utilisateur).
 * Le cookie stocke un HMAC dérivé du mot de passe : impossible à forger sans
 * connaître APP_PASSWORD. Utilise Web Crypto pour fonctionner aussi en Edge
 * runtime (middleware).
 */

export const AUTH_COOKIE = "t2s_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

const MESSAGE = "t2s-authenticated-v1";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compare deux chaînes en temps (quasi) constant. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Jeton attendu dans le cookie pour un mot de passe valide. */
export async function expectedToken(): Promise<string> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error("APP_PASSWORD manquant : authentification non configurée.");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(MESSAGE));
  return toHex(sig);
}

/** Vérifie un jeton de cookie. */
export async function verifyToken(token: string | undefined | null): Promise<boolean> {
  if (!token || !process.env.APP_PASSWORD) return false;
  return safeEqual(token, await expectedToken());
}
