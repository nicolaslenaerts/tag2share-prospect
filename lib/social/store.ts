/**
 * Accès base des réseaux sociaux : connexion Buffer d'une marque, canaux,
 * posts, canaux ciblés et médias.
 *
 * ⚠️ Le cloisonnement entre marques est APPLICATIF (RLS sans policy, clé
 * service_role) : chaque fonction prend le slug de marque et filtre dessus.
 *
 * ⚠️ Module SERVEUR.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidEmail } from "@/lib/brand-sender";
import { bufferChannels, bufferPlan, type BufferChannel, type BufferLimits, type BufferPlan } from "./buffer";
import { decryptSecret, encryptSecret } from "./crypto";
import { mediaKind } from "./rules";
import type {
  MediaInput,
  PostInput,
  SocialChannel,
  SocialFormat,
  SocialMedia,
  SocialPost,
  SocialTarget,
} from "./types";

type Db = SupabaseClient;

export const SOCIAL_BUCKET = "social-media";

/** Erreur lisible côté interface (statut HTTP associé). */
export class SocialError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "SocialError";
  }
}

/** Table absente : migration 0018 pas encore appliquée. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}

export const MIGRATION_HINT =
  "Tables réseaux sociaux absentes : exécutez supabase/migrations/0018_social_buffer.sql dans l'éditeur SQL de Supabase.";

export function check<T>(res: { data: T; error: { code?: string; message: string } | null }): T {
  if (res.error) {
    if (isMissingTable(res.error)) throw new SocialError(MIGRATION_HINT, 503);
    throw new SocialError(res.error.message, 500);
  }
  return res.data;
}

export function publicMediaUrl(db: Db, path: string): string {
  return db.storage.from(SOCIAL_BUCKET).getPublicUrl(path).data.publicUrl;
}

function safeName(filename: string): string {
  const cleaned = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-80);
  return cleaned || "fichier";
}

/**
 * Chemin d'un nouveau média dans le bucket : préfixé par la marque (contrôlé
 * à l'enregistrement du post), avec un UUID. Le fichier est public (Buffer
 * doit pouvoir le télécharger) mais son adresse est impossible à deviner.
 */
export function newMediaPath(brand: string, filename: string): string {
  const month = new Date().toISOString().slice(0, 7);
  return `${brand}/${month}/${randomUUID()}-${safeName(filename)}`;
}

// ─── Connexion Buffer ────────────────────────────────────────────────────────

export type ConnectionRow = {
  brand: string;
  api_key_encrypted: string;
  api_key_iv: string;
  api_key_version: number;
  api_key_hint: string | null;
  account_email: string | null;
  notify_email: string | null;
  channels_synced_at: string | null;
  connected_at: string;
  plan: BufferPlan | null;
  limits: BufferLimits | null;
  plan_checked_at: string | null;
};

export async function loadConnection(db: Db, brand: string): Promise<ConnectionRow | null> {
  return check(await db.from("brand_buffer").select("*").eq("brand", brand).maybeSingle()) as ConnectionRow | null;
}

/** Clé API en clair de la marque. Lève une SocialError si la marque n'est pas connectée. */
export async function requireApiKey(db: Db, brand: string): Promise<string> {
  const row = await loadConnection(db, brand);
  if (!row) throw new SocialError("Aucun compte Buffer connecté pour cette marque (onglet Connexion).", 409);
  return decryptSecret({ encrypted: row.api_key_encrypted, iv: row.api_key_iv, version: row.api_key_version });
}

export async function saveApiKey(db: Db, brand: string, apiKey: string, accountEmail: string | null) {
  const { encrypted, iv, version } = encryptSecret(apiKey);
  check(
    await db.from("brand_buffer").upsert(
      {
        brand,
        api_key_encrypted: encrypted,
        api_key_iv: iv,
        api_key_version: version,
        api_key_hint: apiKey.slice(-4),
        account_email: accountEmail,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brand" }
    )
  );
}

export async function saveNotifyEmail(db: Db, brand: string, email: string | null) {
  const value = email?.trim() || null;
  if (value && !isValidEmail(value)) throw new SocialError("Adresse de notification invalide.");
  check(
    await db
      .from("brand_buffer")
      .update({ notify_email: value, updated_at: new Date().toISOString() })
      .eq("brand", brand)
  );
}

/** Relit l'offre Buffer de la marque (limites de l'organisation) et l'enregistre. */
export async function refreshPlan(db: Db, brand: string, apiKey: string): Promise<{ plan: BufferPlan; limits: BufferLimits }> {
  const result = await bufferPlan(apiKey);
  check(
    await db
      .from("brand_buffer")
      .update({ plan: result.plan, limits: result.limits, plan_checked_at: new Date().toISOString() })
      .eq("brand", brand)
  );
  return result;
}

/** Une offre se change rarement : relue au plus une fois par jour. */
const PLAN_MAX_AGE_MS = 24 * 3600_000;

/**
 * Offre de la marque, relue chez Buffer si elle n'a jamais été détectée ou
 * date de plus d'un jour. En cas d'échec réseau, la dernière valeur connue
 * (ou null) : la détection ne doit jamais bloquer l'affichage.
 */
export async function currentPlan(
  db: Db,
  row: ConnectionRow
): Promise<{ plan: BufferPlan | null; limits: BufferLimits | null }> {
  const fresh = row.plan_checked_at && Date.now() - Date.parse(row.plan_checked_at) < PLAN_MAX_AGE_MS;
  if (row.plan && fresh) return { plan: row.plan, limits: row.limits };
  try {
    const key = decryptSecret({ encrypted: row.api_key_encrypted, iv: row.api_key_iv, version: row.api_key_version });
    return await refreshPlan(db, row.brand, key);
  } catch {
    return { plan: row.plan, limits: row.limits };
  }
}

/** Déconnecte la marque. Les posts déjà programmés restent dans Buffer. */
export async function deleteConnection(db: Db, brand: string) {
  check(await db.from("brand_buffer").delete().eq("brand", brand));
  check(await db.from("social_channels").delete().eq("brand", brand));
}

// ─── Canaux ──────────────────────────────────────────────────────────────────

export async function listChannels(db: Db, brand: string): Promise<SocialChannel[]> {
  const rows = check(
    await db
      .from("social_channels")
      .select("id, service, name, display_name, avatar, enabled, disconnected")
      .eq("brand", brand)
      .order("service")
      .order("name")
  );
  return (rows ?? []) as SocialChannel[];
}

/**
 * Recopie les canaux Buffer en base. Un canal disparu côté Buffer est marqué
 * déconnecté plutôt que supprimé : des posts y font peut-être référence.
 * `enabled` n'est jamais écrasé (choix de l'utilisateur).
 */
export async function syncChannels(db: Db, brand: string, apiKey: string): Promise<SocialChannel[]> {
  const remote: BufferChannel[] = await bufferChannels(apiKey);
  const now = new Date().toISOString();
  if (remote.length) {
    check(
      await db.from("social_channels").upsert(
        remote.map((c) => ({
          brand,
          id: c.id,
          service: c.service,
          name: c.name,
          display_name: c.displayName,
          avatar: c.avatar,
          organization_id: c.organizationId,
          disconnected: c.isDisconnected,
          synced_at: now,
        })),
        { onConflict: "brand,id", ignoreDuplicates: false }
      )
    );
  }
  const known = remote.map((c) => c.id);
  let gone = db.from("social_channels").update({ disconnected: true }).eq("brand", brand);
  if (known.length) gone = gone.not("id", "in", `(${known.map((id) => `"${id}"`).join(",")})`);
  check(await gone);
  check(await db.from("brand_buffer").update({ channels_synced_at: now }).eq("brand", brand));
  // Même occasion pour relire l'offre (connexion, « Actualiser », import).
  await refreshPlan(db, brand, apiKey).catch(() => {});
  return listChannels(db, brand);
}

/**
 * Posts encore programmés (date future) par canal, `excludePostId` exclu.
 * Toutes marques confondues : la limite de file appartient au canal Buffer,
 * même si une clé partagée l'expose à deux marques. Seul le compte sort d'ici.
 */
export async function queuedPerChannel(
  db: Db,
  channelIds: string[],
  excludePostId?: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (channelIds.length === 0) return out;
  let q = db
    .from("social_post_targets")
    .select("channel_id, post:social_posts!inner(scheduled_at)")
    .in("channel_id", channelIds)
    .eq("status", "scheduled")
    .gt("post.scheduled_at", new Date().toISOString());
  if (excludePostId) q = q.neq("post_id", excludePostId);
  const rows = (check(await q) ?? []) as unknown as { channel_id: string }[];
  for (const r of rows) out.set(r.channel_id, (out.get(r.channel_id) ?? 0) + 1);
  return out;
}

export async function setChannelEnabled(db: Db, brand: string, id: string, enabled: boolean) {
  check(await db.from("social_channels").update({ enabled }).eq("brand", brand).eq("id", id));
}

// ─── Posts ───────────────────────────────────────────────────────────────────

const POST_COLUMNS =
  "id, brand, title, document_title, text, format, scheduled_at, status, first_comment, notify, notify_email, notified_at, created_at, updated_at";

type PostRow = Omit<SocialPost, "targets" | "media">;
type MediaRow = Omit<SocialMedia, "url" | "thumbnail_url"> & { id: string; post_id: string };

async function attach(db: Db, posts: PostRow[]): Promise<SocialPost[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const [targets, media] = await Promise.all([
    db
      .from("social_post_targets")
      .select("id, post_id, channel_id, service, status, buffer_post_id, published_url, published_at, error")
      .in("post_id", ids),
    db
      .from("social_media")
      .select("id, post_id, kind, position, storage_path, mime_type, filename, size_bytes, width, height, thumbnail_path, page_count")
      .in("post_id", ids)
      .order("position"),
  ]);
  const targetRows = (check(targets) ?? []) as (SocialTarget & { post_id: string })[];
  const mediaRows = (check(media) ?? []) as MediaRow[];
  return posts.map((p) => ({
    ...p,
    targets: targetRows.filter((t) => t.post_id === p.id),
    media: mediaRows
      .filter((m) => m.post_id === p.id)
      .map((m) => ({
        ...m,
        url: publicMediaUrl(db, m.storage_path),
        thumbnail_url: m.thumbnail_path ? publicMediaUrl(db, m.thumbnail_path) : null,
      })),
  }));
}

export async function listPosts(
  db: Db,
  brand: string,
  range?: { from?: string | null; to?: string | null }
): Promise<SocialPost[]> {
  let q = db.from("social_posts").select(POST_COLUMNS).eq("brand", brand);
  // Une plage ne retient que les posts datés ; sans plage, tout (brouillons
  // sans date compris) pour la vue liste.
  if (range?.from) q = q.gte("scheduled_at", range.from);
  if (range?.to) q = q.lt("scheduled_at", range.to);
  const rows = check(await q.order("scheduled_at", { ascending: true, nullsFirst: false }).limit(1000));
  return attach(db, (rows ?? []) as PostRow[]);
}

export async function loadPost(db: Db, brand: string, id: string): Promise<SocialPost> {
  const row = check(
    await db.from("social_posts").select(POST_COLUMNS).eq("brand", brand).eq("id", id).maybeSingle()
  );
  if (!row) throw new SocialError("Post introuvable.", 404);
  const [post] = await attach(db, [row as PostRow]);
  return post;
}

const FORMATS: SocialFormat[] = ["post", "reel", "carousel"];
const MAX_MEDIA = 12;

/** Valide et normalise le corps d'une création / modification. */
export function parsePostInput(brand: string, body: unknown): PostInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const format = str(b.format) as SocialFormat;
  if (!FORMATS.includes(format)) throw new SocialError("Format inconnu.");

  const text = str(b.text);
  if (text.length > 63206) throw new SocialError("Texte trop long.");
  const title = str(b.title).trim().slice(0, 200) || null;
  const documentTitle = str(b.document_title).trim().slice(0, 200) || null;
  const firstComment = str(b.first_comment).trim().slice(0, 2200) || null;

  let scheduledAt: string | null = null;
  if (b.scheduled_at) {
    const d = new Date(str(b.scheduled_at));
    if (Number.isNaN(d.getTime())) throw new SocialError("Date de publication invalide.");
    scheduledAt = d.toISOString();
  }

  const notifyEmail = str(b.notify_email).trim() || null;
  if (notifyEmail && !isValidEmail(notifyEmail)) throw new SocialError("Adresse de notification invalide.");

  const channelIds = Array.isArray(b.channel_ids)
    ? [...new Set(b.channel_ids.filter((c): c is string => typeof c === "string" && c.length < 100))]
    : [];
  if (channelIds.length > 30) throw new SocialError("Trop de canaux.");

  const rawMedia = Array.isArray(b.media) ? b.media : [];
  if (rawMedia.length > MAX_MEDIA) throw new SocialError(`${MAX_MEDIA} médias au maximum.`);
  const media: MediaInput[] = rawMedia.map((m, i) => parseMedia(brand, m, i));

  return {
    title,
    document_title: documentTitle,
    text,
    format,
    scheduled_at: scheduledAt,
    first_comment: firstComment,
    notify: b.notify !== false,
    notify_email: notifyEmail,
    channel_ids: channelIds,
    media,
  };
}

/**
 * Le chemin vient du navigateur : il doit appartenir au dossier de la marque,
 * sans quoi un post pourrait publier (et supprimer) le fichier d'une autre.
 */
function ownPath(brand: string, path: unknown): string {
  if (typeof path !== "string" || !path.startsWith(`${brand}/`) || path.includes(".."))
    throw new SocialError("Chemin de média invalide.");
  return path;
}

function parseMedia(brand: string, raw: unknown, index: number): MediaInput {
  const m = (raw ?? {}) as Record<string, unknown>;
  const mime = typeof m.mime_type === "string" ? m.mime_type.toLowerCase() : "";
  const kind = mediaKind(mime);
  if (!kind) throw new SocialError(`Type de fichier non pris en charge : ${mime || "inconnu"}.`);
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  return {
    kind,
    position: index,
    storage_path: ownPath(brand, m.storage_path),
    mime_type: mime,
    filename: (typeof m.filename === "string" ? m.filename : "fichier").slice(0, 200),
    size_bytes: int(m.size_bytes),
    width: int(m.width),
    height: int(m.height),
    thumbnail_path: m.thumbnail_path ? ownPath(brand, m.thumbnail_path) : null,
    page_count: int(m.page_count),
  };
}

/**
 * Crée ou remplace un post (brouillon). Les canaux ciblés et les médias sont
 * remplacés en bloc ; les fichiers qui ne servent plus sont supprimés du
 * stockage.
 */
export async function writePost(
  db: Db,
  brand: string,
  input: PostInput,
  existingId?: string
): Promise<SocialPost> {
  const channels = await listChannels(db, brand);
  const byId = new Map(channels.map((c) => [c.id, c]));
  for (const id of input.channel_ids) {
    const c = byId.get(id);
    if (!c) throw new SocialError("Canal inconnu pour cette marque : actualisez les canaux.");
    if (!c.enabled || c.disconnected)
      throw new SocialError(`Le canal « ${c.display_name || c.name || id} » est désactivé ou déconnecté.`);
  }

  const fields = {
    title: input.title,
    document_title: input.document_title,
    text: input.text,
    format: input.format,
    scheduled_at: input.scheduled_at,
    first_comment: input.first_comment,
    notify: input.notify,
    notify_email: input.notify_email,
    updated_at: new Date().toISOString(),
  };

  let postId = existingId;
  const previousPaths: string[] = [];
  if (postId) {
    const existing = await loadPost(db, brand, postId);
    for (const m of existing.media) {
      previousPaths.push(m.storage_path);
      if (m.thumbnail_path) previousPaths.push(m.thumbnail_path);
    }
    check(await db.from("social_posts").update(fields).eq("id", postId).eq("brand", brand));
  } else {
    const row = check(
      await db.from("social_posts").insert({ ...fields, brand, status: "draft" }).select("id").single()
    ) as { id: string };
    postId = row.id;
  }

  // Canaux : on garde les lignes existantes des canaux toujours visés
  // (elles portent l'historique Buffer), on retire les autres.
  const current = (check(
    await db.from("social_post_targets").select("id, channel_id").eq("post_id", postId)
  ) ?? []) as { id: string; channel_id: string }[];
  const keep = new Set(input.channel_ids);
  const toRemove = current.filter((t) => !keep.has(t.channel_id)).map((t) => t.id);
  if (toRemove.length) check(await db.from("social_post_targets").delete().in("id", toRemove));
  const existingChannels = new Set(current.map((t) => t.channel_id));
  const toAdd = input.channel_ids.filter((id) => !existingChannels.has(id));
  if (toAdd.length)
    check(
      await db.from("social_post_targets").insert(
        toAdd.map((id) => ({ post_id: postId, channel_id: id, service: byId.get(id)!.service }))
      )
    );

  // Médias : remplacement en bloc, dans l'ordre reçu.
  check(await db.from("social_media").delete().eq("post_id", postId));
  if (input.media.length)
    check(
      await db
        .from("social_media")
        .insert(input.media.map((m, i) => ({ ...m, position: i, post_id: postId, brand })))
    );

  const nowUsed = new Set(input.media.flatMap((m) => [m.storage_path, m.thumbnail_path].filter(Boolean) as string[]));
  await removeUnusedFiles(db, previousPaths.filter((p) => !nowUsed.has(p)));

  return loadPost(db, brand, postId);
}

/**
 * Supprime des fichiers du bucket, sauf ceux qu'un autre post utilise encore
 * (un post dupliqué partage les fichiers de l'original). Best effort : un
 * fichier orphelin ne gêne personne, un fichier supprimé à tort casserait un
 * post programmé.
 */
export async function removeUnusedFiles(db: Db, paths: string[]): Promise<void> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return;
  const [main, thumbs] = await Promise.all([
    db.from("social_media").select("storage_path").in("storage_path", unique),
    db.from("social_media").select("thumbnail_path").in("thumbnail_path", unique),
  ]);
  if (main.error || thumbs.error) return;
  const stillUsed = new Set([
    ...(main.data ?? []).map((r) => r.storage_path as string),
    ...(thumbs.data ?? []).map((r) => r.thumbnail_path as string),
  ]);
  const orphans = unique.filter((p) => !stillUsed.has(p));
  if (orphans.length) await db.storage.from(SOCIAL_BUCKET).remove(orphans);
}

export async function deletePostRow(db: Db, brand: string, post: SocialPost): Promise<void> {
  check(await db.from("social_posts").delete().eq("id", post.id).eq("brand", brand));
  await removeUnusedFiles(
    db,
    post.media.flatMap((m) => [m.storage_path, m.thumbnail_path].filter(Boolean) as string[])
  );
}
