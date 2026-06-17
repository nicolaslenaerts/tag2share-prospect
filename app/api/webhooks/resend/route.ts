import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { addSuppression, type SuppressionReason } from "@/lib/suppression";
import { recordEmailEvent } from "@/lib/email-log";

export const runtime = "nodejs";

/**
 * Webhook Resend : bounces durs et plaintes spam -> liste de suppression
 * (+ mise à jour du statut du destinataire). Configurer l'endpoint dans Resend
 * et renseigner RESEND_WEBHOOK_SECRET (whsec_...) pour la vérification Svix.
 */

function verifySvix(payload: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // pas de secret configuré : on accepte (dev)
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !timestamp || !sigHeader) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${id}.${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
  // svix-signature = liste "v1,<sig> v1,<sig2> ..."
  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySvix(raw, req.headers)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const type: string = event?.type || "";
  const data = event?.data || {};
  const tos: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
  const emailId: string | undefined = data.email_id;

  // Suivi de délivrabilité : on enregistre l'événement sur la ligne du journal.
  // "email.delivered" -> delivered, "email.opened" -> opened, etc.
  const logEvent = type.startsWith("email.") ? type.slice("email.".length) : "";
  if (emailId && logEvent) await recordEmailEvent(emailId, logEvent);

  let reason: SuppressionReason | null = null;
  let status: string | null = null;
  if (type === "email.bounced") {
    reason = "bounce";
    status = "failed";
  } else if (type === "email.complained") {
    reason = "complaint";
    status = "failed";
  }

  if (reason) {
    for (const to of tos) await addSuppression(to, reason, type);
    if (emailId && status) {
      const db = supabaseAdmin();
      await db
        .from("campaign_recipients")
        .update({ status, error: reason })
        .eq("resend_id", emailId);
    }
  }

  // Toujours répondre 200 pour éviter les ré-essais inutiles.
  return new Response("ok", { status: 200 });
}
