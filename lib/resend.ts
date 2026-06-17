/**
 * Envoi d'emails via Resend (domaine validé : marketing.tag2share.com).
 * SÉCURITÉ : aucune fonction ici n'est appelée sans action explicite côté serveur.
 */
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY!;
const from = process.env.RESEND_FROM || "Nicolas de Tag2Share <nicolas@marketing.tag2share.com>";
const defaultReplyTo = process.env.RESEND_REPLY_TO || "nicolas@tag2share.com";

export function resendClient() {
  if (!apiKey) throw new Error("RESEND_API_KEY manquante.");
  return new Resend(apiKey);
}

export type SendArgs = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export async function sendEmail({ to, subject, html, replyTo, headers }: SendArgs) {
  const resend = resendClient();
  const finalReplyTo = replyTo || defaultReplyTo;
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(finalReplyTo ? { replyTo: finalReplyTo } : {}),
    ...(headers ? { headers } : {}),
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}

export const FROM_ADDRESS = from;
