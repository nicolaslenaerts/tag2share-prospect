import { supabaseAdmin } from "@/lib/supabase";
import { ok } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { syncPublications } from "@/lib/social/status";

export const runtime = "nodejs";
// Un appel Buffer par canal (et par post échu pour le suivi) : au-delà des 10 s par défaut.
export const maxDuration = 60;

/**
 * Met à jour les statuts des posts échus de la marque active (appelé à
 * l'ouverture de la page). Complète le cron sans le remplacer : sans cron,
 * les emails de notification ne partent qu'à la prochaine visite.
 */
export async function POST(req: Request) {
  try {
    const brand = await activeBrand(req);
    return ok(await syncPublications(supabaseAdmin(), { brand: brand.slug }));
  } catch (err) {
    return socialFail(err);
  }
}
