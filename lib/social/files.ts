/**
 * Fichiers du bucket `social-media` d'une marque, avec les posts qui les
 * utilisent, et leur suppression.
 *
 * Règle de suppression, du plus libre au plus strict :
 *   - orphelin (aucun post)                     → supprimable ;
 *   - rattaché à des brouillons / posts publiés → supprimable après
 *     confirmation (`detach`) : le fichier est retiré de ces posts ;
 *   - rattaché à un post encore dans Buffer      → REFUSÉ. Buffer télécharge
 *     les médias au moment de publier : supprimer le fichier ferait échouer
 *     la publication, sans que personne le voie avant le jour J.
 *
 * Une vignette (page 1 d'un PDF, image d'une vidéo) suit son fichier : elle
 * n'apparaît pas seule dans la liste et part avec lui.
 *
 * ⚠️ Module SERVEUR. Cloisonnement : seul le dossier `<marque>/` est lu ou
 * modifié.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { postLabel } from "./rules";
import { check, publicMediaUrl, removeUnusedFiles, SOCIAL_BUCKET, SocialError } from "./store";
import type { MediaKind, SocialFormat, SocialPostStatus } from "./types";

type Db = SupabaseClient;

export type FilePost = {
  id: string;
  label: string;
  status: SocialPostStatus;
  scheduled_at: string | null;
  format: SocialFormat;
  /** Un de ses canaux est programmé ou en brouillon dans Buffer. */
  in_buffer: boolean;
};

export type StoredFile = {
  path: string;
  /** Nom d'origine (sans le préfixe UUID). */
  name: string;
  size: number;
  mime: string | null;
  kind: MediaKind | "other";
  created_at: string | null;
  url: string;
  /** Image à afficher : le fichier s'il est une image, sinon sa vignette. */
  preview_url: string | null;
  thumbnail_path: string | null;
  thumbnail_size: number;
  posts: FilePost[];
  state: "orphan" | "attached" | "locked";
};

export type FilesTotals = {
  count: number;
  bytes: number;
  orphans: number;
  orphanBytes: number;
};

type StorageEntry = { path: string; size: number; mime: string | null; created_at: string | null };

/** Parcours récursif d'un dossier du bucket (l'API ne liste qu'un niveau). */
async function walk(db: Db, prefix: string, out: StorageEntry[]): Promise<void> {
  const bucket = db.storage.from(SOCIAL_BUCKET);
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new SocialError(`Lecture du stockage impossible : ${error.message}`, 500);
    for (const o of data ?? []) {
      const path = `${prefix}/${o.name}`;
      // Un « dossier » n'a pas d'id dans la réponse de l'API Storage.
      if (o.id === null) await walk(db, path, out);
      else
        out.push({
          path,
          size: Number(o.metadata?.size ?? 0),
          mime: (o.metadata?.mimetype as string | undefined) ?? null,
          created_at: o.created_at ?? null,
        });
    }
    if ((data ?? []).length < 1000) break;
  }
}

function displayName(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

function kindOf(mime: string | null): StoredFile["kind"] {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return "other";
}

type MediaRef = { id: string; post_id: string; storage_path: string; thumbnail_path: string | null };
type PostRow = {
  id: string;
  title: string | null;
  text: string;
  status: SocialPostStatus;
  scheduled_at: string | null;
  format: SocialFormat;
  targets: { status: string }[];
};

/** Médias et posts de la marque, indexés pour rattacher les fichiers. */
async function references(db: Db, brand: string) {
  const [media, posts] = await Promise.all([
    db.from("social_media").select("id, post_id, storage_path, thumbnail_path").eq("brand", brand).range(0, 9999),
    db
      .from("social_posts")
      .select("id, title, text, status, scheduled_at, format, targets:social_post_targets(status)")
      .eq("brand", brand)
      .range(0, 9999),
  ]);
  const mediaRows = (check(media) ?? []) as MediaRef[];
  const postById = new Map<string, FilePost>();
  for (const p of (check(posts) ?? []) as PostRow[]) {
    postById.set(p.id, {
      id: p.id,
      label: postLabel(p, 60),
      status: p.status,
      scheduled_at: p.scheduled_at,
      format: p.format,
      in_buffer: p.targets.some((t) => t.status === "scheduled" || t.status === "buffer_draft"),
    });
  }
  const byPath = new Map<string, MediaRef[]>();
  const byThumbnail = new Map<string, MediaRef[]>();
  for (const m of mediaRows) {
    byPath.set(m.storage_path, [...(byPath.get(m.storage_path) ?? []), m]);
    if (m.thumbnail_path) byThumbnail.set(m.thumbnail_path, [...(byThumbnail.get(m.thumbnail_path) ?? []), m]);
  }
  const postsOf = (refs: MediaRef[]) =>
    [...new Set(refs.map((r) => r.post_id))].map((id) => postById.get(id)).filter((p): p is FilePost => Boolean(p));
  return { byPath, byThumbnail, postsOf };
}

export async function listBrandFiles(db: Db, brand: string): Promise<{ files: StoredFile[]; totals: FilesTotals }> {
  const entries: StorageEntry[] = [];
  await walk(db, brand, entries);
  const sizeOf = new Map(entries.map((e) => [e.path, e.size]));
  const { byPath, byThumbnail, postsOf } = await references(db, brand);

  const files: StoredFile[] = [];
  for (const e of entries) {
    // Vignette d'un fichier présent : affichée avec lui, pas seule.
    const parents = byThumbnail.get(e.path);
    if (parents?.some((p) => sizeOf.has(p.storage_path))) continue;

    const refs = byPath.get(e.path) ?? parents ?? [];
    const posts = postsOf(refs);
    const thumbnail = refs.find((r) => r.thumbnail_path)?.thumbnail_path ?? null;
    const kind = kindOf(e.mime);
    files.push({
      path: e.path,
      name: displayName(e.path),
      size: e.size,
      mime: e.mime,
      kind,
      created_at: e.created_at,
      url: publicMediaUrl(db, e.path),
      preview_url: kind === "image" ? publicMediaUrl(db, e.path) : thumbnail ? publicMediaUrl(db, thumbnail) : null,
      thumbnail_path: thumbnail,
      thumbnail_size: thumbnail ? sizeOf.get(thumbnail) ?? 0 : 0,
      posts,
      state: posts.some((p) => p.in_buffer) ? "locked" : posts.length ? "attached" : "orphan",
    });
  }

  files.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const totals: FilesTotals = { count: 0, bytes: 0, orphans: 0, orphanBytes: 0 };
  for (const f of files) {
    const bytes = f.size + f.thumbnail_size;
    totals.count++;
    totals.bytes += bytes;
    if (f.state === "orphan") {
      totals.orphans++;
      totals.orphanBytes += bytes;
    }
  }
  return { files, totals };
}

export type DeleteResult = {
  deleted: string[];
  refused: { path: string; reason: string }[];
  /** Posts dont des médias ont été retirés. */
  detachedFrom: string[];
};

/**
 * Supprime des fichiers de la marque. Chaque chemin est jugé séparément :
 * un refus n'empêche pas les autres suppressions.
 */
export async function deleteBrandFiles(
  db: Db,
  brand: string,
  paths: string[],
  opts: { detach: boolean }
): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], refused: [], detachedFrom: [] };
  const { byPath, byThumbnail, postsOf } = await references(db, brand);
  const detached = new Set<string>();

  for (const path of [...new Set(paths)]) {
    if (typeof path !== "string" || !path.startsWith(`${brand}/`) || path.includes("..")) {
      result.refused.push({ path: String(path), reason: "Fichier hors du dossier de la marque." });
      continue;
    }
    const asMedia = byPath.get(path) ?? [];
    const asThumbnail = byThumbnail.get(path) ?? [];
    const posts = postsOf([...asMedia, ...asThumbnail]);

    const locked = posts.filter((p) => p.in_buffer);
    if (locked.length) {
      result.refused.push({
        path,
        reason: `Utilisé par un post programmé dans Buffer (« ${locked[0].label} ») : Buffer le téléchargera au moment de publier. Déprogrammez d'abord le post.`,
      });
      continue;
    }
    if (posts.length && !opts.detach) {
      result.refused.push({ path, reason: `Rattaché à ${posts.length} post(s) : confirmez pour l'en retirer.` });
      continue;
    }

    // Retrait des posts d'abord : un média qui pointerait vers un fichier
    // supprimé casserait l'aperçu et la reprogrammation.
    if (asMedia.length) check(await db.from("social_media").delete().in("id", asMedia.map((m) => m.id)));
    if (asThumbnail.length)
      check(await db.from("social_media").update({ thumbnail_path: null }).in("id", asThumbnail.map((m) => m.id)));
    for (const p of posts) detached.add(p.id);

    const { error } = await db.storage.from(SOCIAL_BUCKET).remove([path]);
    if (error) {
      result.refused.push({ path, reason: `Suppression refusée par le stockage : ${error.message}` });
      continue;
    }
    result.deleted.push(path);
    // Vignettes des médias retirés, si plus personne ne les utilise.
    await removeUnusedFiles(db, asMedia.map((m) => m.thumbnail_path).filter((t): t is string => Boolean(t)));
  }

  result.detachedFrom = [...detached];
  return result;
}
