/**
 * Traitement des événements de webhook Resend.
 *
 * L'app utilise UN SEUL compte Resend (clé et secret de webhook communs) :
 * tous les événements de toutes les marques arrivent donc sur le MÊME
 * endpoint, /api/webhooks/resend. La marque ne peut pas être déduite de l'URL,
 * elle est retrouvée depuis le payload :
 *
 *   1. `email_log.resend_id` → la colonne `brand` de la ligne d'envoi.
 *      Source de vérité : c'est la marque qui a réellement expédié cet email.
 *   2. À défaut (email hors journal), l'adresse `from` de l'événement est
 *      comparée aux adresses d'envoi des marques.
 *   3. En dernier recours, la marque par défaut.
 *
 * L'attribution compte : une plainte spam mal attribuée pollue la liste de
 * suppression d'une autre marque.
 *
 * (Si un jour les marques passent sur des comptes Resend distincts, il faudra
 * un endpoint et un secret par marque : voir l'historique de ce fichier.)
 */
import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import { addSuppression, type SuppressionReason } from "./suppression";
import { recordEmailEvent } from "./email-log";
import { brandSender, resendWebhookSecret, parseAddress } from "./brand-sender";
import { defaultBrand, loadBrands, resolveBrand } from "./brands/store";
import type { BrandConfig } from "./brands/types";

/** Vérifie la signature Svix avec le secret commun. */
export function verifySvix(payload: string, headers: Headers): boolean {
  const secret = resendWebhookSecret();
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

/** Marque ayant émis l'email visé par l'événement. */
async function resolveEventBrand(
  emailId: string | undefined,
  from: unknown
): Promise<BrandConfig> {
  // 1. Le journal d'envoi sait quelle marque a expédié cet email.
  if (emailId) {
    const db = supabaseAdmin();
    const { data } = await db
      .from("email_log")
      .select("brand")
      .eq("resend_id", emailId)
      .limit(1)
      .maybeSingle();
    const logged = await resolveBrand(data?.brand);
    if (logged) return logged;
  }

  // 2. Repli : comparer l'adresse d'expédition de l'événement à celles des marques.
  const sender = typeof from === "string" ? parseAddress(from) : undefined;
  if (sender) {
    const target = sender.email.toLowerCase();
    for (const brand of await loadBrands()) {
      const resolved = await brandSender(brand);
      if (resolved.fromEmail.toLowerCase() === target) return brand;
    }
  }

  return defaultBrand();
}

/**
 * Applique un événement Resend : suivi de délivrabilité, puis mise en liste de
 * suppression pour les bounces durs et les plaintes. Répond toujours 200 pour
 * éviter les ré-essais inutiles côté Resend.
 */
export async function handleResendWebhook(req: Request): Promise<Response> {
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

  const brand = await resolveEventBrand(emailId, data.from);

  // Suivi de délivrabilité : on enregistre l'événement sur la ligne du journal.
  // "email.delivered" -> delivered, "email.opened" -> opened, etc.
  const logEvent = type.startsWith("email.") ? type.slice("email.".length) : "";
  if (emailId && logEvent) await recordEmailEvent(emailId, logEvent, brand.slug);

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
    // Le périmètre (cette marque ou toutes) est décidé par suppressionScope().
    for (const to of tos) await addSuppression(to, brand.slug, reason, type);
    if (emailId && status) {
      const db = supabaseAdmin();
      await db
        .from("campaign_recipients")
        .update({ status, error: reason })
        .eq("resend_id", emailId);
    }
  }

  return new Response("ok", { status: 200 });
}
