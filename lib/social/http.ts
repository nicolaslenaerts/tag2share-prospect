/**
 * Traduction des erreurs du module social en réponses HTTP lisibles.
 * ⚠️ Module SERVEUR.
 */
import { fail } from "@/lib/http";
import { BufferApiError } from "./buffer";
import { EncryptionConfigError } from "./crypto";
import { SocialError } from "./store";

export function socialFail(err: unknown) {
  if (err instanceof SocialError) return fail(err.message, err.status);
  if (err instanceof EncryptionConfigError) return fail(err.message, 500);
  if (err instanceof BufferApiError) {
    const status = err.kind === "auth" ? 401 : err.kind === "rate_limit" ? 429 : 502;
    return fail(err.message, status);
  }
  return fail((err as Error)?.message || "Erreur inattendue.", 500);
}
