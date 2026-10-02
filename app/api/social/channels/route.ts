import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { listChannels, requireApiKey, setChannelEnabled, SocialError, syncChannels } from "@/lib/social/store";

export const runtime = "nodejs";

/** Relit les canaux depuis Buffer (bouton « Actualiser »). */
export async function POST(req: Request) {
  try {
    const brand = await requireBrand(req);
    const db = supabaseAdmin();
    const channels = await syncChannels(db, brand.slug, await requireApiKey(db, brand.slug));
    return ok({ channels });
  } catch (err) {
    return socialFail(err);
  }
}

/** Active / désactive un canal pour cette marque. */
export async function PATCH(req: Request) {
  try {
    const brand = await requireBrand(req);
    const { id, enabled } = await readJson<{ id?: string; enabled?: boolean }>(req);
    if (!id || typeof enabled !== "boolean") throw new SocialError("id et enabled requis.");
    const db = supabaseAdmin();
    await setChannelEnabled(db, brand.slug, id, enabled);
    return ok({ channels: await listChannels(db, brand.slug) });
  } catch (err) {
    return socialFail(err);
  }
}
