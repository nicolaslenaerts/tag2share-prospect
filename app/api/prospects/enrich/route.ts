import { enrichProspect } from "@/lib/enrich";
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
    // On enrichit même sans site web : le registre (FR) peut retrouver
    // l'entreprise par nom + ville, et révéler adresse/dirigeants.
    if (!p.website && p.country !== "France" && p.country !== "FR") {
      return { id: p.id, skipped: "pas de site web" };
    }
    try {
      const enr = await enrichProspect({
        name: p.name,
        website: p.website,
        address: p.address,
        city: p.city,
        country: p.country,
      });
      const { data: row } = await db
        .from("prospects")
        .update({
          email: p.email || enr.emails[0] || null,
          phone: p.phone || enr.phone || null,
          address: p.address || enr.address || null,
          website: p.website || enr.registry?.website || null,
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

  // Traitement par petits lots parallèles. Chaque prospect est borné en temps
  // (voir ENRICH_BUDGET_MS), donc la durée d'invocation ≈ le prospect le plus lent.
  const list = prospects || [];
  const updated: any[] = [];
  const BATCH = 3;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    updated.push(...(await Promise.all(batch.map(enrichOne))));
  }

  return ok({ updated });
}
