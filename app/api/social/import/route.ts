import { supabaseAdmin } from "@/lib/supabase";
import { ok } from "@/lib/http";
import { requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { importFromBuffer } from "@/lib/social/import";

export const runtime = "nodejs";
// Recopie des médias : le budget interne (35 s) s'arrête avant cette limite.
export const maxDuration = 60;

/**
 * Importe les posts programmés directement dans Buffer pour la marque active.
 * Rien n'est modifié chez Buffer : lecture seule côté Buffer.
 * `deferred > 0` : il en reste, rappeler la route.
 */
export async function POST(req: Request) {
  try {
    const brand = await requireBrand(req);
    return ok(await importFromBuffer(supabaseAdmin(), brand.slug));
  } catch (err) {
    return socialFail(err);
  }
}
