/**
 * Envoi d'emails via Resend.
 *
 * UN SEUL compte Resend (clé RESEND_API_KEY) pour toute l'app ; ce qui change
 * d'une marque à l'autre est l'ADRESSE d'envoi, résolue par
 * lib/brand-sender.ts (base de données → env → défaut du code).
 *
 * SÉCURITÉ : aucune fonction ici n'est appelée sans action explicite côté serveur.
 */
import { Resend } from "resend";
import { brandSender, resendApiKey, type SenderRuntime } from "./brand-sender";
import type { BrandConfig } from "./brands/types";

export function resendClient() {
  const apiKey = resendApiKey();
  if (!apiKey) throw new Error("RESEND_API_KEY manquante.");
  return new Resend(apiKey);
}

export type SendArgs = {
  brand: BrandConfig;
  to: string;
  subject: string;
  html: string;
  /** Surcharge ponctuelle de l'adresse de réponse. */
  replyTo?: string;
  headers?: Record<string, string>;
  /**
   * Identité d'expédition déjà résolue. À fournir dans une boucle d'envoi :
   * sinon chaque email relit la table brand_settings, et l'identité pourrait
   * changer au milieu d'un lot si quelqu'un l'édite pendant l'envoi.
   */
  sender?: SenderRuntime;
};

export async function sendEmail({
  brand,
  to,
  subject,
  html,
  replyTo,
  headers,
  sender,
}: SendArgs) {
  const s = sender ?? (await brandSender(brand));
  const resend = resendClient();
  const finalReplyTo = replyTo || s.replyTo;
  const { data, error } = await resend.emails.send({
    from: s.from,
    to,
    subject,
    html,
    ...(finalReplyTo ? { replyTo: finalReplyTo } : {}),
    ...(headers ? { headers } : {}),
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}
