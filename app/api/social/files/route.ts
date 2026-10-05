import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { activeBrand, requireBrand } from "@/lib/brand-context";
import { deleteBrandFiles, listBrandFiles } from "@/lib/social/files";
import { socialFail } from "@/lib/social/http";
import { SocialError } from "@/lib/social/store";

export const runtime = "nodejs";

/** Fichiers du stockage de la marque active, avec les posts qui les utilisent. */
export async function GET(req: Request) {
  try {
    const brand = await activeBrand(req);
    return ok(await listBrandFiles(supabaseAdmin(), brand.slug));
  } catch (err) {
    return socialFail(err);
  }
}

/**
 * Supprime des fichiers. `detach: true` autorise le retrait des brouillons et
 * posts publiés qui les utilisent (confirmé dans l'interface). Un fichier d'un
 * post encore dans Buffer est toujours refusé.
 */
export async function DELETE(req: Request) {
  try {
    const brand = await requireBrand(req);
    const { paths, detach } = await readJson<{ paths?: unknown; detach?: boolean }>(req);
    if (!Array.isArray(paths) || paths.length === 0) throw new SocialError("paths requis.");
    if (paths.length > 200) throw new SocialError("200 fichiers au maximum par suppression.");
    return ok(await deleteBrandFiles(supabaseAdmin(), brand.slug, paths as string[], { detach: detach === true }));
  } catch (err) {
    return socialFail(err);
  }
}
