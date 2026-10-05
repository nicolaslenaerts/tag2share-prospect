/**
 * Programmation d'un post dans Buffer, et retrait.
 *
 * Un post de l'outil vise N canaux ; Buffer ne connaît qu'un canal par post.
 * Programmer = un `createPost` par canal ciblé, chacun avec SES médias (règle
 * `mediaForTarget` : images pour Instagram / Facebook, PDF pour LinkedIn...).
 *
 * Tout est validé AVANT le premier appel (règles réseau, date, médias
 * joignables) : un refus au troisième canal laisserait les deux premiers
 * programmés et le troisième non.
 *
 * ⚠️ Module SERVEUR.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BufferApiError,
  bufferCreatePost,
  bufferDeletePost,
  type BufferAsset,
} from "./buffer";
import { checkPlan, documentTitleFor, mediaForTarget, planFeatures, queueErrors, rollupStatus, serviceLabel } from "./rules";
import { listChannels, loadConnection, loadPost, queuedPerChannel, requireApiKey, SocialError } from "./store";
import type { ScheduleMode, SocialMedia, SocialPost, SocialTarget } from "./types";

type Db = SupabaseClient;

/** Marge minimale entre maintenant et la date programmée. */
const MIN_LEAD_MS = 2 * 60_000;

export type TargetResult = {
  channel_id: string;
  service: string;
  ok: boolean;
  error: string | null;
};

function toAsset(post: SocialPost, m: SocialMedia): BufferAsset {
  if (m.kind === "document") {
    // Les trois champs sont requis par le schéma ; Buffer ne calcule pas la
    // vignette, elle est rendue par le navigateur à l'ajout du PDF.
    return {
      document: {
        url: m.url,
        title: documentTitleFor(post, m),
        thumbnailUrl: m.thumbnail_url!,
      },
    };
  }
  return m.kind === "video" ? { video: { url: m.url } } : { image: { url: m.url } };
}

/**
 * Buffer télécharge les médias AU MOMENT DE LA PUBLICATION. Une URL cassée
 * (bucket non public, fichier supprimé) ne se verrait donc que le jour J, par
 * un échec. On la vérifie maintenant, tant qu'on peut encore corriger.
 */
async function assertReachable(urls: string[]): Promise<void> {
  const broken: string[] = [];
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) broken.push(`${url.split("/").pop()} (${res.status})`);
      } catch {
        broken.push(`${url.split("/").pop()} (injoignable)`);
      }
    })
  );
  if (broken.length)
    throw new SocialError(
      `Médias inaccessibles publiquement : ${broken.join(", ")}. Vérifiez que le bucket « social-media » est public (migration 0018).`,
      422
    );
}

/** Canaux à (r)envoyer : jamais partis, refusés, ou brouillons Buffer. */
function sendable(t: SocialTarget): boolean {
  return t.status === "pending" || t.status === "failed" || t.status === "buffer_draft";
}

export async function schedulePost(
  db: Db,
  brand: string,
  postId: string,
  mode: ScheduleMode
): Promise<{ post: SocialPost; results: TargetResult[] }> {
  const post = await loadPost(db, brand, postId);
  const targets = post.targets.filter(sendable);
  if (post.targets.length === 0) throw new SocialError("Choisissez au moins un canal.");
  if (targets.length === 0) throw new SocialError("Tous les canaux de ce post sont déjà programmés ou publiés.");

  if (mode === "schedule") {
    if (!post.scheduled_at) throw new SocialError("Choisissez une date de publication.");
    if (new Date(post.scheduled_at).getTime() < Date.now() + MIN_LEAD_MS)
      throw new SocialError("La date de publication doit être au moins 2 minutes dans le futur.");
  }

  const channels = new Map((await listChannels(db, brand)).map((c) => [c.id, c]));
  for (const t of targets) {
    const c = channels.get(t.channel_id);
    if (!c || !c.enabled || c.disconnected)
      throw new SocialError(`Le canal ${serviceLabel(t.service)} « ${c?.display_name || c?.name || t.channel_id} » n'est plus disponible.`);
  }

  // Offre Buffer de la marque : premier commentaire et taille de file.
  const connection = await loadConnection(db, brand);
  const features = planFeatures(connection?.plan, connection?.limits);

  const plan = checkPlan({
    format: post.format,
    text: post.text,
    firstComment: post.first_comment,
    services: targets.map((t) => t.service),
    media: post.media,
    features,
  });
  if (plan.errors.length) throw new SocialError(plan.errors.join("\n"), 422);

  // File pleine sur un canal : refusée AVANT le premier envoi, sinon le post
  // partirait sur les autres canaux et pas sur celui-là.
  if (mode === "schedule" && features.scheduledPostsPerChannel) {
    const queued = await queuedPerChannel(db, targets.map((t) => t.channel_id), postId);
    const full = queueErrors(
      targets.map((t) => {
        const c = channels.get(t.channel_id);
        return {
          label: `${serviceLabel(t.service)} (${c?.display_name || c?.name || t.channel_id})`,
          queued: queued.get(t.channel_id) ?? 0,
        };
      }),
      features.scheduledPostsPerChannel
    );
    if (full.length) throw new SocialError(full.join("\n"), 422);
  }

  const perTarget = targets.map((t) => ({
    target: t,
    media: mediaForTarget(post.format, t.service, post.media),
  }));
  await assertReachable(
    perTarget.flatMap(({ media }) => media.flatMap((m) => [m.url, m.thumbnail_url].filter(Boolean) as string[]))
  );

  const apiKey = await requireApiKey(db, brand);
  const dueAt = mode === "schedule" ? post.scheduled_at : null;
  const results: TargetResult[] = [];
  let stop: string | null = null;

  for (const { target, media } of perTarget) {
    if (stop) {
      results.push({ channel_id: target.channel_id, service: target.service, ok: false, error: stop });
      continue;
    }
    try {
      // Un brouillon Buffer existant serait sinon laissé en double.
      if (target.status === "buffer_draft" && target.buffer_post_id)
        await bufferDeletePost(apiKey, target.buffer_post_id);

      const created = await bufferCreatePost(apiKey, {
        channelId: target.channel_id,
        service: target.service,
        text: post.text,
        assets: media.map((m) => toAsset(post, m)),
        format: post.format,
        // Offre gratuite : Buffer n'accepte pas le premier commentaire.
        firstComment: features.firstComment ? post.first_comment : null,
        mode,
        dueAt,
      });
      await updateTarget(db, target.id, {
        status: mode === "buffer_draft" ? "buffer_draft" : "scheduled",
        buffer_post_id: created.id,
        error: null,
        published_url: null,
        published_at: null,
        last_checked_at: null,
      });
      results.push({ channel_id: target.channel_id, service: target.service, ok: true, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateTarget(db, target.id, { status: "failed", error: message });
      results.push({ channel_id: target.channel_id, service: target.service, ok: false, error: message });
      // Clé refusée ou quota épuisé : les canaux suivants échoueraient pareil,
      // et chaque essai consommerait du quota pour rien.
      if (err instanceof BufferApiError && (err.kind === "auth" || err.kind === "rate_limit")) stop = message;
    }
  }

  await finalize(db, brand, postId, {
    ...(mode === "now" ? { scheduled_at: new Date().toISOString() } : {}),
    // Nouvelle programmation = nouvelle notification.
    notified_at: null,
  });
  return { post: await loadPost(db, brand, postId), results };
}

/**
 * Retire de Buffer les canaux programmés (ou en brouillon Buffer) d'un post et
 * le ramène en brouillon local. Les canaux déjà publiés ne bougent pas.
 * Lève à la première suppression refusée : mieux vaut un post encore
 * programmé qu'un post en double après reprogrammation.
 */
export async function unschedulePost(db: Db, brand: string, postId: string): Promise<SocialPost> {
  const post = await loadPost(db, brand, postId);
  const inBuffer = post.targets.filter(
    (t) => (t.status === "scheduled" || t.status === "buffer_draft") && t.buffer_post_id
  );
  if (inBuffer.length) {
    const apiKey = await requireApiKey(db, brand);
    for (const t of inBuffer) {
      try {
        await bufferDeletePost(apiKey, t.buffer_post_id!);
      } catch (err) {
        throw new SocialError(
          `${serviceLabel(t.service)} : retrait de Buffer impossible (${(err as Error).message}). Rien n'a été reprogrammé.`,
          502
        );
      }
      await updateTarget(db, t.id, { status: "pending", buffer_post_id: null, error: null });
    }
  }
  // Les canaux en échec repartent aussi de zéro.
  for (const t of post.targets.filter((t) => t.status === "failed"))
    await updateTarget(db, t.id, { status: "pending", error: null });
  await finalize(db, brand, postId, {});
  return loadPost(db, brand, postId);
}

async function updateTarget(db: Db, id: string, fields: Record<string, unknown>) {
  const { error } = await db
    .from("social_post_targets")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new SocialError(error.message, 500);
}

/** Recalcule le statut d'ensemble du post d'après ses canaux. */
export async function finalize(db: Db, brand: string, postId: string, extra: Record<string, unknown>) {
  const { data: targets, error } = await db
    .from("social_post_targets")
    .select("status")
    .eq("post_id", postId);
  if (error) throw new SocialError(error.message, 500);
  const { error: upErr } = await db
    .from("social_posts")
    .update({ ...extra, status: rollupStatus(targets ?? []), updated_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("brand", brand);
  if (upErr) throw new SocialError(upErr.message, 500);
}
