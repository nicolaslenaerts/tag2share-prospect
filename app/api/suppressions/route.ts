import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import {
  addSuppression,
  normEmail,
  removeSuppression,
  GLOBAL_SCOPE,
  type SuppressionReason,
} from "@/lib/suppression";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

// Liste des emails supprimés (désinscrits, bounces, plaintes, manuels) qui
// s'appliquent à la marque active : ses exclusions propres + les exclusions
// globales ('*').
// Filtres optionnels : ?reason=bounce  ·  ?q=texte
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reason = searchParams.get("reason");
  const q = searchParams.get("q");
  const brand = await activeBrand(req);
  const scopes = [brand.slug, GLOBAL_SCOPE];
  const db = supabaseAdmin();

  let query = db
    .from("suppressions")
    .select("email, reason, detail, brand, created_at")
    .in("brand", scopes)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (reason) query = query.eq("reason", reason);
  if (q) query = query.ilike("email", `%${q}%`);

  const { data, error } = await query;
  if (error) return fail(error.message, 500);

  // Comptage par raison (sur l'ensemble applicable à cette marque,
  // indépendant des filtres).
  const { data: all } = await db
    .from("suppressions")
    .select("reason")
    .in("brand", scopes);
  const counts: Record<string, number> = {};
  for (const r of all ?? []) counts[r.reason] = (counts[r.reason] ?? 0) + 1;

  return ok({ suppressions: data, counts, total: (all ?? []).length });
}

// Ajout manuel d'un email à exclure (avec raison libre optionnelle dans `detail`).
export async function POST(req: Request) {
  const { email, reason, detail } = await readJson<{
    email: string;
    reason?: string;
    detail?: string;
  }>(req);
  if (!email || !email.includes("@")) return fail("Email valide requis.");
  const brand = await activeBrand(req);
  // Le périmètre (cette marque ou toutes) est décidé par suppressionScope().
  await addSuppression(
    email,
    brand.slug,
    (reason as SuppressionReason) || "manual",
    detail?.trim() || undefined
  );
  return ok({ added: normEmail(email) }, 201);
}

// Retire un email de la liste (il pourra de nouveau être contacté).
// Retire l'exclusion propre à la marque ET l'exclusion globale : sans cela un
// email « réactivé » resterait bloqué par la ligne globale, sans explication.
export async function DELETE(req: Request) {
  const { email } = await readJson<{ email: string }>(req);
  if (!email) return fail("email requis.");
  const brand = await activeBrand(req);
  await removeSuppression(email, brand.slug);
  return ok({ removed: normEmail(email) });
}
