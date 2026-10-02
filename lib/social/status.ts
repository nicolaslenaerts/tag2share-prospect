/**
 * Suivi des publications : interroge Buffer pour les canaux échus, met à
 * jour les statuts et le lien public, puis envoie l'email de notification.
 *
 * Appelé par le cron (/api/cron/social-status, toutes marques) et à
 * l'ouverture de la page Réseaux sociaux (marque active). Les deux peuvent se
 * croiser : l'email est « réservé » par une écriture conditionnelle sur
 * `notified_at` avant l'envoi, jamais deux fois pour une même programmation.
 *
 * Budget Buffer : 250 requêtes par jour et par clé en offre gratuite. Seuls
 * les canaux dont la date est passée sont interrogés, au plus une fois par
 * minute chacun, et jamais au-delà de 48 h.
 *
 * ⚠️ Module SERVEUR.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBrand } from "@/lib/brands/store";
import { brandSender } from "@/lib/brand-sender";
import { sendEmail } from "@/lib/resend";
import { BufferApiError, bufferPostStatus } from "./buffer";
import { finalize } from "./schedule";
import { loadConnection, loadPost, requireApiKey } from "./store";
import { publicationEmail } from "./notify";
import type { SocialPost, SocialTarget } from "./types";

type Db = SupabaseClient;

const RECHECK_AFTER_MS = 60_000;
const GIVE_UP_AFTER_MS = 48 * 3600_000;
/** Buffer passe en « sent » avant que le réseau ait rendu le permalien. */
const URL_GRACE_MS = 10 * 60_000;
const BATCH = 40;

type DueRow = {
  id: string;
  post_id: string;
  service: string;
  status: string;
  buffer_post_id: string;
  published_url: string | null;
  post: { brand: string; scheduled_at: string };
};

export type SyncSummary = { checked: number; published: number; failed: number; notified: number; errors: string[] };

export async function syncPublications(db: Db, opts: { brand?: string } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { checked: 0, published: 0, failed: 0, notified: 0, errors: [] };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  let q = db
    .from("social_post_targets")
    .select("id, post_id, service, status, buffer_post_id, published_url, post:social_posts!inner(brand, scheduled_at)")
    .not("buffer_post_id", "is", null)
    // Programmés et échus, OU publiés depuis peu sans lien (le permalien arrive après).
    .or(`status.eq.scheduled,and(status.eq.published,published_url.is.null,published_at.gte.${iso(now - URL_GRACE_MS)})`)
    .or(`last_checked_at.is.null,last_checked_at.lt.${iso(now - RECHECK_AFTER_MS)}`)
    .lte("post.scheduled_at", iso(now))
    .gte("post.scheduled_at", iso(now - GIVE_UP_AFTER_MS))
    .limit(BATCH);
  if (opts.brand) q = q.eq("post.brand", opts.brand);
  const { data, error } = await q;
  if (error) {
    summary.errors.push(error.message);
    return summary;
  }

  const rows = (data ?? []) as unknown as DueRow[];
  const keys = new Map<string, string | null>();
  const touched = new Map<string, string>();

  for (const row of rows) {
    const brand = row.post.brand;
    if (!keys.has(brand)) keys.set(brand, await requireApiKey(db, brand).catch(() => null));
    const apiKey = keys.get(brand);
    if (!apiKey) continue;

    summary.checked++;
    try {
      const state = await bufferPostStatus(apiKey, row.buffer_post_id);
      const fields: Record<string, unknown> = { last_checked_at: new Date().toISOString() };
      if (state.status === "published") {
        if (row.status !== "published") summary.published++;
        Object.assign(fields, {
          status: "published",
          published_at: state.sentAt ?? new Date().toISOString(),
          published_url: state.url ?? row.published_url,
          error: null,
        });
      } else if (state.status === "failed" || state.status === "missing") {
        summary.failed++;
        Object.assign(fields, {
          status: "failed",
          error:
            state.status === "missing"
              ? "Post introuvable dans Buffer (supprimé depuis Buffer ?)."
              : state.error ?? "Publication refusée par le réseau.",
        });
      }
      await db.from("social_post_targets").update(fields).eq("id", row.id);
      touched.set(row.post_id, brand);
    } catch (err) {
      summary.errors.push(`${row.service} : ${(err as Error).message}`);
      // Clé refusée ou quota atteint : inutile d'insister pour cette marque.
      if (err instanceof BufferApiError && (err.kind === "auth" || err.kind === "rate_limit")) keys.set(brand, null);
    }
  }

  for (const [postId, brand] of touched) await finalize(db, brand, postId, {}).catch(() => {});

  summary.notified = await notifyReadyPosts(db, opts, summary.errors);
  return summary;
}

/**
 * Le post est-il prêt pour l'email de notification ?
 *
 * Appelée pour chaque post échu, à chaque passage du cron, jusqu'à ce qu'elle
 * réponde `true` (un seul email part ensuite par programmation).
 *
 * `sent` = canaux réellement envoyés à Buffer (les brouillons Buffer et les
 * canaux jamais partis sont exclus en amont). `now` en millisecondes.
 */
export function readyToNotify(post: SocialPost, sent: SocialTarget[], now: number): boolean {
  // TODO(Nicolas) : politique d'attente avant l'email (5 à 10 lignes).
  // Par défaut : on attend que chaque canal soit tranché (publié ou en échec).
  void post;
  void now;
  return sent.length > 0 && sent.every((t) => t.status === "published" || t.status === "failed");
}

async function notifyReadyPosts(db: Db, opts: { brand?: string }, errors: string[]): Promise<number> {
  const now = Date.now();
  let q = db
    .from("social_posts")
    .select("id, brand")
    .eq("notify", true)
    .is("notified_at", null)
    .in("status", ["scheduled", "published", "partial", "failed"])
    .lte("scheduled_at", new Date(now).toISOString())
    .gte("scheduled_at", new Date(now - GIVE_UP_AFTER_MS).toISOString())
    .limit(BATCH);
  if (opts.brand) q = q.eq("brand", opts.brand);
  const { data, error } = await q;
  if (error) {
    errors.push(error.message);
    return 0;
  }

  let sentCount = 0;
  for (const { id, brand } of (data ?? []) as { id: string; brand: string }[]) {
    try {
      const post = await loadPost(db, brand, id);
      const sent = post.targets.filter((t) => t.buffer_post_id && t.status !== "buffer_draft" && t.status !== "pending");
      if (!readyToNotify(post, sent, now)) continue;

      // Réservation : seul le premier passage qui pose notified_at envoie.
      const claimedAt = new Date().toISOString();
      const { data: claimed } = await db
        .from("social_posts")
        .update({ notified_at: claimedAt })
        .eq("id", id)
        .is("notified_at", null)
        .select("id");
      if (!claimed?.length) continue;

      try {
        await sendPublicationEmail(db, brand, post, sent);
        sentCount++;
      } catch (err) {
        // Libère la réservation : le prochain passage retentera.
        await db.from("social_posts").update({ notified_at: null }).eq("id", id).eq("notified_at", claimedAt);
        throw err;
      }
    } catch (err) {
      errors.push(`notification ${id} : ${(err as Error).message}`);
    }
  }
  return sentCount;
}

async function sendPublicationEmail(db: Db, brandSlug: string, post: SocialPost, sent: SocialTarget[]) {
  const brand = await resolveBrand(brandSlug);
  if (!brand) throw new Error(`Marque inconnue : ${brandSlug}`);
  const [connection, sender, channels] = await Promise.all([
    loadConnection(db, brandSlug),
    brandSender(brand),
    db.from("social_channels").select("id, name, display_name").eq("brand", brandSlug),
  ]);
  const to = post.notify_email || connection?.notify_email || sender.testEmail;
  if (!to) throw new Error("Aucune adresse de notification (onglet Connexion) ni adresse de test pour cette marque.");

  const names = new Map(
    ((channels.data ?? []) as { id: string; name: string | null; display_name: string | null }[]).map((c) => [
      c.id,
      c.display_name || c.name || null,
    ])
  );
  const email = publicationEmail({ brand, post, targets: sent, channelNames: names });
  await sendEmail({ brand, to, subject: email.subject, html: email.html, sender });
}
