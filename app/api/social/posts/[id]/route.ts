import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { activeBrand, requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { checkPlan, planFeatures, queueErrors, serviceLabel } from "@/lib/social/rules";
import { schedulePost, unschedulePost } from "@/lib/social/schedule";
import {
  deletePostRow,
  listChannels,
  loadConnection,
  loadPost,
  parsePostInput,
  queuedPerChannel,
  SocialError,
  writePost,
} from "@/lib/social/store";

export const runtime = "nodejs";
// Un appel Buffer par canal (et par post échu pour le suivi) : au-delà des 10 s par défaut.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/**
 * Un post, avec `check` : les problèmes qui bloqueraient sa programmation
 * (mêmes règles que l'éditeur et que schedulePost). L'éditeur les calcule
 * lui-même ; le serveur MCP, qui ne peut pas importer rules.ts, les lit ici.
 * L'offre Buffer de la marque compte : premier commentaire et file par canal.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const brand = await activeBrand(req);
    const db = supabaseAdmin();
    const [post, connection, channels] = await Promise.all([
      loadPost(db, brand.slug, id),
      loadConnection(db, brand.slug),
      listChannels(db, brand.slug),
    ]);
    const features = planFeatures(connection?.plan, connection?.limits);
    const check = checkPlan({
      format: post.format,
      text: post.text,
      firstComment: post.first_comment,
      services: post.targets.map((t) => t.service),
      media: post.media,
      features,
    });
    // File : seulement pour ce qui reste à programmer.
    const pending = post.targets.filter((t) => t.status === "pending" || t.status === "failed" || t.status === "buffer_draft");
    if (pending.length && features.scheduledPostsPerChannel) {
      const queued = await queuedPerChannel(db, pending.map((t) => t.channel_id), post.id);
      const names = new Map(channels.map((c) => [c.id, c.display_name || c.name || c.id]));
      check.errors.push(
        ...queueErrors(
          pending.map((t) => ({
            label: `${serviceLabel(t.service)} (${names.get(t.channel_id) ?? t.channel_id})`,
            queued: queued.get(t.channel_id) ?? 0,
          })),
          features.scheduledPostsPerChannel
        )
      );
    }
    return ok({ post, check, plan: connection?.plan ?? null });
  } catch (err) {
    return socialFail(err);
  }
}

/**
 * Modifie un post.
 *
 * Buffer n'offre pas de moyen fiable de modifier un post programmé avec ses
 * médias : un post déjà dans Buffer est RETIRÉ puis reprogrammé avec les
 * nouvelles valeurs, ce qui exige `reschedule: true` (confirmé dans
 * l'interface). Si le retrait échoue, rien n'est modifié : pas de doublon.
 * Un post déjà publié n'est plus modifiable (on le duplique).
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const brand = await requireBrand(req);
    const db = supabaseAdmin();
    const body = await readJson<Record<string, unknown> & { reschedule?: boolean }>(req);
    const input = parsePostInput(brand.slug, body);
    const post = await loadPost(db, brand.slug, id);

    if (post.targets.some((t) => t.status === "published"))
      throw new SocialError("Ce post est déjà publié : dupliquez-le pour le réutiliser.", 409);

    if (!post.targets.some((t) => t.status === "scheduled"))
      return ok({ post: await writePost(db, brand.slug, input, id) });

    if (body.reschedule !== true)
      throw new SocialError("Ce post est programmé dans Buffer : confirmez sa reprogrammation.", 409);

    await unschedulePost(db, brand.slug, id);
    await writePost(db, brand.slug, input, id);
    try {
      const { post: rescheduled, results } = await schedulePost(db, brand.slug, id, "schedule");
      return ok({ post: rescheduled, results });
    } catch (err) {
      throw new SocialError(
        `Modifications enregistrées, mais la reprogrammation a échoué : ${(err as Error).message} Le post est repassé en brouillon.`,
        err instanceof SocialError ? err.status : 502
      );
    }
  } catch (err) {
    return socialFail(err);
  }
}

/**
 * Supprime le post. Ce qui est encore programmé est d'abord retiré de Buffer ;
 * si ce retrait échoue, le post est conservé (il partirait sinon sans trace).
 * Un post déjà publié reste en ligne sur le réseau.
 */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const brand = await requireBrand(req);
    const db = supabaseAdmin();
    let post = await loadPost(db, brand.slug, id);
    if (post.targets.some((t) => t.status === "scheduled" || t.status === "buffer_draft"))
      post = await unschedulePost(db, brand.slug, id);
    await deletePostRow(db, brand.slug, post);
    return ok({ deleted: true });
  } catch (err) {
    return socialFail(err);
  }
}
