/**
 * Envoi d'emails via Resend (domaine validé : mail.tag2share.com).
 * SÉCURITÉ : aucune fonction ici n'est appelée sans action explicite côté serveur.
 */
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY!;
const from = process.env.RESEND_FROM || "Tag2Share <prospect@mail.tag2share.com>";

export function resendClient() {
  if (!apiKey) throw new Error("RESEND_API_KEY manquante.");
  return new Resend(apiKey);
}

export type SendArgs = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export async function sendEmail({ to, subject, html, replyTo }: SendArgs) {
  const resend = resendClient();
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}

export const FROM_ADDRESS = from;
