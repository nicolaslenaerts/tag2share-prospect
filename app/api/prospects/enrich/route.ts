import { enrichWebsite } from "@/lib/enrich";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Étape 3 - enrichit un ou plusieurs prospects à partir de leur site web.
 */
export async function POST(req: Request) {
  const { ids } = await readJson<{ ids: string[] }>(req);
  if (!Array.isArray(ids) || ids.length === 0) return fail("ids requis.");

  const db = supabaseAdmin();
  const { data: prospects, error } = await db
    .from("prospects")
    .select("*")
    .in("id", ids);
  if (error) return fail(error.message, 500);

  async function enrichOne(p: any) {
    if (!p.website) return { id: p.id, skipped: "pas de site web" };
    try {
      const enr = await enrichWebsite(p.website, p.name);
      const { data: row } = await db
        .from("prospects")
        .update({
          email: p.email || enr.emails[0] || null,
          contact_name: p.contact_name || enr.contact_name || null,
          logo_url: p.logo_url || enr.logo_url || null,
          enrichment: enr,
          status: "enriched",
        })
        .eq("id", p.id)
        .select()
        .single();
      return row;
    } catch (e) {
      return { id: p.id, error: (e as Error).message };
    }
  }

  // Traitement par lots de 5 (parallélisme) pour éviter les timeouts.
  const list = prospects || [];
  const updated: any[] = [];
  const BATCH = 5;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    updated.push(...(await Promise.all(batch.map(enrichOne))));
  }

  return ok({ updated });
}
