import { supabaseAdmin } from "@/lib/supabase";
import { ok } from "@/lib/http";
import { requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { unschedulePost } from "@/lib/social/schedule";

export const runtime = "nodejs";

/** Retire le post de Buffer et le ramène en brouillon (canaux publiés exceptés). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const brand = await requireBrand(req);
    return ok({ post: await unschedulePost(supabaseAdmin(), brand.slug, id) });
  } catch (err) {
    return socialFail(err);
  }
}
