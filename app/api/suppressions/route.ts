import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { addSuppression, normEmail } from "@/lib/suppression";

export const runtime = "nodejs";

// Liste des emails supprimés (désinscrits, bounces, plaintes, manuels).
// Filtres optionnels : ?reason=bounce  ·  ?q=texte
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reason = searchParams.get("reason");
  const q = searchParams.get("q");
  const db = supabaseAdmin();

  let query = db
    .from("suppressions")
    .select("email, reason, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (reason) query = query.eq("reason", reason);
  if (q) query = query.ilike("email", `%${q}%`);

  const { data, error } = await query;
  if (error) return fail(error.message, 500);

  // Comptage par raison (sur l'ensemble, indépendant des filtres).
  const { data: all } = await db.from("suppressions").select("reason");
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
  await addSuppression(email, (reason as any) || "manual", detail?.trim() || undefined);
  return ok({ added: normEmail(email) }, 201);
}

// Retire un email de la liste (il pourra de nouveau être contacté).
export async function DELETE(req: Request) {
  const { email } = await readJson<{ email: string }>(req);
  if (!email) return fail("email requis.");
  const db = supabaseAdmin();
  const { error } = await db.from("suppressions").delete().eq("email", normEmail(email));
  if (error) return fail(error.message, 500);
  return ok({ removed: normEmail(email) });
}
