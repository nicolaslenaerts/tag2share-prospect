import { handleResendWebhook } from "@/lib/resend-webhook";

export const runtime = "nodejs";

/**
 * Endpoint UNIQUE du webhook Resend, toutes marques confondues (un seul compte
 * Resend). La marque de chaque événement est retrouvée depuis le payload -
 * voir lib/resend-webhook.ts.
 *
 * URL à déclarer chez Resend : https://<APP_URL>/api/webhooks/resend
 */
export async function POST(req: Request) {
  return handleResendWebhook(req);
}
