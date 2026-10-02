import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { activeBrand, requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { listPosts, parsePostInput, writePost } from "@/lib/social/store";

export const runtime = "nodejs";

/**
 * Posts de la marque active. `from` / `to` (ISO) restreignent aux posts datés
 * de la plage (calendrier) ; sans plage, tous les posts (liste).
 */
export async function GET(req: Request) {
  try {
    const brand = await activeBrand(req);
    const url = new URL(req.url);
    const posts = await listPosts(supabaseAdmin(), brand.slug, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return ok({ posts });
  } catch (err) {
    return socialFail(err);
  }
}

/** Crée un post en brouillon (rien ne part vers Buffer ici). */
export async function POST(req: Request) {
  try {
    const brand = await requireBrand(req);
    const input = parsePostInput(brand.slug, await readJson(req));
    return ok({ post: await writePost(supabaseAdmin(), brand.slug, input) }, 201);
  } catch (err) {
    return socialFail(err);
  }
}
