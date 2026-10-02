import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { schedulePost } from "@/lib/social/schedule";
import { SocialError } from "@/lib/social/store";
import type { ScheduleMode } from "@/lib/social/types";

export const runtime = "nodejs";
// Un appel Buffer par canal (et par post échu pour le suivi) : au-delà des 10 s par défaut.
export const maxDuration = 60;

const MODES: ScheduleMode[] = ["schedule", "now", "buffer_draft"];

/**
 * Envoie le post à Buffer :
 *   - schedule     : programmé à sa date ;
 *   - now          : publié immédiatement ;
 *   - buffer_draft : créé en brouillon dans Buffer (test, rien ne part).
 *
 * SÉCURITÉ : action visible publiquement, `confirm: true` obligatoire (posé
 * par l'interface après confirmation explicite).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const brand = await requireBrand(req);
    const { mode, confirm } = await readJson<{ mode?: ScheduleMode; confirm?: boolean }>(req);
    if (!mode || !MODES.includes(mode)) throw new SocialError("Mode inconnu.");
    if (confirm !== true) throw new SocialError("Confirmation requise (confirm: true).");
    return ok(await schedulePost(supabaseAdmin(), brand.slug, id, mode));
  } catch (err) {
    return socialFail(err);
  }
}
