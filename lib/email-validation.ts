/**
 * Validation d'email avant envoi : format, adresses "rôle" non contactables,
 * et présence d'enregistrements MX sur le domaine (réduit fortement les bounces).
 */
import { promises as dns } from "dns";

const FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Adresses automatiques qui ne doivent jamais être prospectées.
// NB : on garde volontairement info@/contact@/hello@ (légitimes en B2B).
const ROLE =
  /^(no-?reply|do-?not-?reply|donotreply|postmaster|mailer-daemon|abuse|spam|bounce|unsubscribe)@/i;

export function isValidFormat(email: string): boolean {
  return FORMAT.test(email || "");
}

export function isRoleAddress(email: string): boolean {
  return ROLE.test(email || "");
}

// Cache MX par domaine (durée de vie du process serverless).
const mxCache = new Map<string, boolean>();

export async function hasMx(domain: string): Promise<boolean> {
  const d = (domain || "").toLowerCase();
  if (!d) return false;
  if (mxCache.has(d)) return mxCache.get(d)!;
  let ok = false;
  try {
    const records = await dns.resolveMx(d);
    ok = Array.isArray(records) && records.length > 0;
  } catch {
    ok = false;
  }
  mxCache.set(d, ok);
  return ok;
}

export type Validation = { ok: boolean; reason?: string };

/** Validation complète d'une adresse destinataire (format + rôle + MX). */
export async function validateSendable(email: string): Promise<Validation> {
  const e = (email || "").trim();
  if (!isValidFormat(e)) return { ok: false, reason: "format invalide" };
  if (isRoleAddress(e)) return { ok: false, reason: "adresse automatique (no-reply…)" };
  const domain = e.split("@")[1];
  if (!(await hasMx(domain))) return { ok: false, reason: "domaine sans serveur mail (MX)" };
  return { ok: true };
}
