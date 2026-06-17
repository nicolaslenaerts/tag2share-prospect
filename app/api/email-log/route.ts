import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

// Journal paginé des emails envoyés (table email_log, append-only).
// Filtres optionnels :
//   ?page=1            · pagination (50 par page)
//   ?status=sent|failed
//   ?event=delivered|opened|clicked|bounced|complained
//   ?q=texte           · recherche sur email / business / campagne / sujet
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const status = searchParams.get("status");
  const event = searchParams.get("event");
  const q = (searchParams.get("q") || "").trim();
  const db = supabaseAdmin();

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from("email_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (event) query = query.eq("event", event);
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `to_email.ilike.${like},prospect_name.ilike.${like},campaign_name.ilike.${like},subject.ilike.${like}`
    );
  }

  const { data, error, count } = await query;
  if (error) return fail(error.message, 500);

  const total = count ?? 0;
  return ok({
    emails: data ?? [],
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
