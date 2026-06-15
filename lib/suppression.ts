/**
 * Liste de suppression : emails à ne jamais (re)contacter.
 * Alimentée par les désinscriptions, les bounces durs et les plaintes spam.
 */
import { supabaseAdmin } from "./supabase";

export function normEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export type SuppressionReason = "unsubscribe" | "bounce" | "complaint" | "manual";

/** Ajoute (ou met à jour) un email dans la liste de suppression. */
export async function addSuppression(
  email: string,
  reason: SuppressionReason = "unsubscribe",
  detail?: string
) {
  const e = normEmail(email);
  if (!e) return;
  const db = supabaseAdmin();
  await db
    .from("suppressions")
    .upsert({ email: e, reason, detail: detail ?? null }, { onConflict: "email" });
}

/** Renvoie le sous-ensemble des emails fournis qui sont supprimés. */
export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const list = Array.from(new Set(emails.map(normEmail).filter(Boolean)));
  if (list.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data } = await db.from("suppressions").select("email").in("email", list);
  return new Set((data ?? []).map((r) => r.email));
}

/** True si l'email est dans la liste de suppression. */
export async function isSuppressed(email: string): Promise<boolean> {
  const set = await suppressedSet([email]);
  return set.has(normEmail(email));
}
