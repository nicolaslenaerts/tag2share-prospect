/**
 * Import des posts programmés DIRECTEMENT dans Buffer, pour que le calendrier
 * montre tout ce qui va sortir et pas seulement ce qui a été créé ici.
 *
 * Inspiré du cron `creator.import-scheduled` d'Uncover Studio :
 *   - post Buffer inconnu → post local « programmé », médias RECOPIÉS dans le
 *     bucket (aperçu, et reprogrammation possible si on le modifie ici) ;
 *   - post déjà connu → sa date et son texte suivent Buffer (déplacé dans
 *     Buffer = déplacé ici). Sans risque d'écraser une saisie locale : modifier
 *     ici un post programmé le retire de Buffer et le recrée, avec de nouveaux
 *     ids. Un id connu porte donc toujours le contenu de Buffer.
 *
 * Buffer ne connaît qu'un canal par post : un post publié sur trois réseaux
 * depuis le composeur Buffer y existe en trois exemplaires. Les exemplaires de
 * même texte, à une minute près, redeviennent UN post ici (images Instagram /
 * Facebook et PDF LinkedIn réunis), comme s'il avait été créé dans l'outil.
 *
 * ⚠️ Module SERVEUR.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { bufferQueue, type BufferQueueAsset, type BufferQueuePost } from "./buffer";
import { MEDIA_RULES, mediaKind } from "./rules";
import { finalize } from "./schedule";
import { check, newMediaPath, requireApiKey, SOCIAL_BUCKET, syncChannels } from "./store";
import type { MediaInput, SocialFormat } from "./types";

type Db = SupabaseClient;

/** Fenêtre lue chez Buffer : posts dont la date tombe dans les N prochains jours. */
const WINDOW_DAYS = 180;
/**
 * Un post créé à l'instant est peut-être celui que l'outil est en train de
 * programmer (son id Buffer n'est enregistré qu'après la réponse) : laissé au
 * passage suivant pour ne pas le dupliquer.
 */
const GRACE_MS = 5 * 60_000;
/**
 * Chaque création recopie ses médias (vidéos comprises) : on s'arrête avant
 * la limite de durée de la fonction serverless, le reste suit à l'appel
 * suivant (l'interface enchaîne les appels tant qu'il en reste).
 */
const TIME_BUDGET_MS = 35_000;
const MAX_CREATIONS_PER_CALL = 20;
/** Écart sous lequel deux dates sont identiques. */
const SAME_TIME_MS = 60_000;
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

export type ImportSummary = {
  /** Posts programmés trouvés dans Buffer sur les canaux de la marque. */
  found: number;
  /** Posts créés dans l'outil (un post peut regrouper plusieurs canaux). */
  imported: number;
  /** Publications Buffer couvertes par ces nouveaux posts. */
  importedChannels: number;
  /** Publications déjà présentes dans l'outil. */
  known: number;
  /** Posts déjà présents réalignés sur Buffer (date, texte, brouillon programmé). */
  updated: number;
  /** Posts sur des canaux décochés ou absents de la marque : non importés. */
  otherChannels: number;
  /** Créés il y a moins de 5 minutes : repris au prochain import. */
  recent: number;
  /** Laissés à l'appel suivant (budget de temps). */
  deferred: number;
  /** Médias qui n'ont pas pu être recopiés (le post Buffer, lui, est intact). */
  mediaErrors: string[];
};

const normalizeText = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const hasDocument = (p: BufferQueuePost) => p.assets.some((a) => a.kind === "document");
const visuals = (p: BufferQueuePost) => p.assets.filter((a) => a.kind !== "document");

/** Empreinte des visuels d'un post : nature et dimensions, dans l'ordre. */
function visualSignature(p: BufferQueuePost): string {
  return visuals(p)
    .map((a) => `${a.kind}:${a.width ?? "?"}x${a.height ?? "?"}`)
    .join(",");
}

/**
 * Un exemplaire peut-il rejoindre ce groupe ? Les visuels doivent concorder,
 * sauf pour un exemplaire LinkedIn porteur d'un PDF : dans le modèle de
 * l'outil, le PDF va à LinkedIn et les images aux autres réseaux.
 */
function compatible(group: BufferQueuePost[], p: BufferQueuePost): boolean {
  if (group.some((x) => x.channelId === p.channelId)) return false;
  // Proximité plutôt qu'arrondi à la minute : 08:00:29 et 08:00:31 sont le même créneau.
  if (Math.abs(Date.parse(group[0].dueAt) - Date.parse(p.dueAt)) > SAME_TIME_MS) return false;
  const withVisuals = (x: BufferQueuePost) => !(x.service === "linkedin" && hasDocument(x));
  // PDF LinkedIn : regroupable avec un autre exemplaire LinkedIn seulement si
  // c'est le même document (titre et nombre de pages).
  const docSignature = (x: BufferQueuePost) =>
    x.assets.filter((a) => a.kind === "document").map((a) => `${a.title ?? ""}|${a.pageCount ?? "?"}`).join(",");
  if (!withVisuals(p)) return group.filter((x) => !withVisuals(x)).every((x) => docSignature(x) === docSignature(p));
  return group.filter(withVisuals).every((x) => visualSignature(x) === visualSignature(p));
}

/** Regroupe les exemplaires d'une même publication (même texte, à une minute près). */
export function groupQueue(posts: BufferQueuePost[]): BufferQueuePost[][] {
  const groups: BufferQueuePost[][] = [];
  const byKey = new Map<string, BufferQueuePost[][]>();
  for (const p of [...posts].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const text = normalizeText(p.text);
    // Sans texte, rien ne prouve que deux posts sont la même publication.
    const key = text || `id:${p.id}`;
    const candidates = byKey.get(key) ?? [];
    let group = candidates.find((g) => compatible(g, p));
    if (!group) {
      group = [];
      candidates.push(group);
      byKey.set(key, candidates);
      groups.push(group);
    }
    group.push(p);
  }
  return groups;
}

/** Médias du post local : visuels d'un réseau « image », PDF de LinkedIn. */
export function groupMedia(group: BufferQueuePost[]): { visuals: BufferQueueAsset[]; document: BufferQueueAsset | null } {
  const document = group.flatMap((p) => p.assets).find((a) => a.kind === "document") ?? null;
  const owner =
    group.find((p) => p.service !== "linkedin" && visuals(p).length > 0) ?? group.find((p) => visuals(p).length > 0);
  return { visuals: owner ? visuals(owner) : [], document };
}

export function groupFormat(group: BufferQueuePost[], media: ReturnType<typeof groupMedia>): SocialFormat {
  if (group.some((p) => p.postType === "reel")) return "reel";
  if (media.document || media.visuals.filter((a) => a.kind === "image").length > 1) return "carousel";
  return "post";
}

// ─── Recopie des médias ──────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

function fileName(url: string, fallback: string, mime: string): string {
  let last = "";
  try {
    last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    // URL exotique : nom de repli.
  }
  const ext = EXT[mime] ?? "bin";
  if (!last) return `${fallback}.${ext}`;
  return /\.[a-z0-9]{2,4}$/i.test(last) ? last : `${last}.${ext}`;
}

/** Télécharge un fichier chez Buffer et le dépose dans le bucket de la marque. */
async function copyToBucket(
  db: Db,
  brand: string,
  url: string,
  declaredMime: string,
  name: string,
  maxBytes: number
): Promise<{ path: string; mime: string; size: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (declaredMime || res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!EXT[mime]) throw new Error(`type non pris en charge (${mime || "inconnu"})`);
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Error("fichier trop volumineux");
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > maxBytes) throw new Error("fichier trop volumineux");
  const path = newMediaPath(brand, name);
  const { error } = await db.storage.from(SOCIAL_BUCKET).upload(path, data, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return { path, mime, size: data.byteLength };
}

async function copyAsset(db: Db, brand: string, a: BufferQueueAsset, index: number): Promise<MediaInput> {
  const kind = mediaKind(a.mimeType) ?? a.kind;
  const base = a.kind === "document" ? a.title?.trim() || "document" : `buffer-${index + 1}`;
  const main = await copyToBucket(
    db,
    brand,
    a.url,
    a.mimeType,
    a.kind === "document" ? `${base}.pdf` : fileName(a.url, base, a.mimeType),
    MEDIA_RULES[kind].maxBytes
  );
  // Vignette : indispensable pour reprogrammer un PDF (Buffer l'exige), utile
  // comme affiche d'une vidéo. Son échec ne bloque pas le média.
  let thumbnailPath: string | null = null;
  if (a.thumbnail && a.kind !== "image") {
    thumbnailPath = await copyToBucket(db, brand, a.thumbnail, "", `${base}-vignette`, THUMBNAIL_MAX_BYTES)
      .then((t) => t.path)
      .catch(() => null);
  }
  return {
    kind,
    position: index,
    storage_path: main.path,
    mime_type: main.mime,
    filename: a.kind === "document" ? `${base}.pdf` : fileName(a.url, base, main.mime),
    size_bytes: main.size,
    width: a.width,
    height: a.height,
    thumbnail_path: thumbnailPath,
    page_count: a.pageCount,
  };
}

// ─── Posts déjà connus ───────────────────────────────────────────────────────

type KnownTarget = { id: string; post_id: string; status: string; buffer_post_id: string; brand: string };

/**
 * Canaux locaux qui portent déjà ces ids Buffer, TOUTES marques confondues :
 * un post importé par une marque ne doit pas l'être une seconde fois par une
 * autre qui partagerait la clé.
 */
async function knownTargets(db: Db, ids: string[]): Promise<Map<string, KnownTarget>> {
  const out = new Map<string, KnownTarget>();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = check(
      await db
        .from("social_post_targets")
        .select("id, post_id, status, buffer_post_id, post:social_posts!inner(brand)")
        .in("buffer_post_id", ids.slice(i, i + 100))
    ) as unknown as Array<Omit<KnownTarget, "brand"> & { post: { brand: string } }>;
    for (const r of rows ?? []) out.set(r.buffer_post_id, { ...r, brand: r.post.brand });
  }
  return out;
}

/**
 * Réaligne les posts connus sur Buffer. La date et le texte ne suivent que si
 * TOUS les canaux du post encore en file chez Buffer sont d'accord : un post
 * dont un seul réseau a été déplacé garde sa date (le détail reste exact dans
 * Buffer, et le suivi de statut le rattrape).
 */
async function alignKnown(
  db: Db,
  brand: string,
  refs: BufferQueuePost[],
  known: Map<string, KnownTarget>
): Promise<number> {
  const byPost = new Map<string, BufferQueuePost[]>();
  for (const r of refs) {
    const t = known.get(r.id);
    if (!t || t.brand !== brand) continue;
    byPost.set(t.post_id, [...(byPost.get(t.post_id) ?? []), r]);
  }

  let updated = 0;
  for (const [postId, list] of byPost) {
    let changed = false;

    // Brouillon Buffer créé ici, puis programmé depuis Buffer.
    for (const r of list) {
      const t = known.get(r.id)!;
      if (t.status === "buffer_draft") {
        check(
          await db
            .from("social_post_targets")
            .update({ status: "scheduled", last_checked_at: null, updated_at: new Date().toISOString() })
            .eq("id", t.id)
        );
        changed = true;
      }
    }

    const post = check(
      await db.from("social_posts").select("text, scheduled_at").eq("id", postId).eq("brand", brand).maybeSingle()
    ) as { text: string; scheduled_at: string | null } | null;
    const targets = (check(
      await db.from("social_post_targets").select("status, buffer_post_id").eq("post_id", postId)
    ) ?? []) as { status: string; buffer_post_id: string | null }[];
    const queued = targets.filter((t) => t.buffer_post_id && (t.status === "scheduled" || t.status === "buffer_draft"));
    const allListed = queued.length > 0 && queued.every((t) => list.some((r) => r.id === t.buffer_post_id));

    if (post && allListed) {
      const fields: Record<string, unknown> = {};
      const sameDue = list.every((r) => Math.abs(Date.parse(r.dueAt) - Date.parse(list[0].dueAt)) <= SAME_TIME_MS);
      if (sameDue && (!post.scheduled_at || Math.abs(Date.parse(list[0].dueAt) - Date.parse(post.scheduled_at)) > SAME_TIME_MS))
        fields.scheduled_at = list[0].dueAt;
      const texts = new Set(list.map((r) => r.text));
      if (texts.size === 1 && list[0].text !== post.text) fields.text = list[0].text;
      if (Object.keys(fields).length) {
        check(await db.from("social_posts").update(fields).eq("id", postId).eq("brand", brand));
        changed = true;
      }
    }

    if (changed) {
      await finalize(db, brand, postId, {});
      updated++;
    }
  }
  return updated;
}

// ─── Import ──────────────────────────────────────────────────────────────────

async function createFromGroup(db: Db, brand: string, group: BufferQueuePost[], errors: string[]) {
  const media = groupMedia(group);
  const format = groupFormat(group, media);

  // Médias d'abord : si la fonction est interrompue pendant les copies, rien
  // n'est encore enregistré et l'import suivant reprend ce post depuis le début.
  const assets = [...media.visuals, ...(media.document ? [media.document] : [])];
  const rows: MediaInput[] = [];
  for (const [i, a] of assets.entries()) {
    try {
      rows.push(await copyAsset(db, brand, a, i));
    } catch (err) {
      errors.push(`${a.kind === "document" ? "PDF" : a.kind === "video" ? "vidéo" : "image"} du ${group[0].dueAt.slice(0, 10)} : ${(err as Error).message}`);
    }
  }

  const first = group[0];
  const post = check(
    await db
      .from("social_posts")
      .insert({
        brand,
        title: media.document?.title?.trim() || null,
        text: first.text,
        format,
        scheduled_at: first.dueAt,
        status: "scheduled",
        first_comment: group.map((p) => p.firstComment).find(Boolean) ?? null,
        notify: true,
      })
      .select("id")
      .single()
  ) as { id: string };

  check(
    await db.from("social_post_targets").insert(
      group.map((p) => ({
        post_id: post.id,
        channel_id: p.channelId,
        service: p.service,
        status: "scheduled",
        buffer_post_id: p.id,
      }))
    )
  );
  if (rows.length)
    check(await db.from("social_media").insert(rows.map((m, i) => ({ ...m, position: i, post_id: post.id, brand }))));
}

export async function importFromBuffer(db: Db, brand: string): Promise<ImportSummary> {
  const started = Date.now();
  const summary: ImportSummary = {
    found: 0,
    imported: 0,
    importedChannels: 0,
    known: 0,
    updated: 0,
    otherChannels: 0,
    recent: 0,
    deferred: 0,
    mediaErrors: [],
  };

  const apiKey = await requireApiKey(db, brand);
  // Canaux à jour d'abord : un compte ajouté dans Buffer depuis la dernière
  // synchro serait sinon compté hors marque.
  const channels = await syncChannels(db, brand, apiKey);
  const usable = new Set(channels.filter((c) => c.enabled && !c.disconnected).map((c) => c.id));

  const queue = await bufferQueue(apiKey, {
    start: new Date(started).toISOString(),
    end: new Date(started + WINDOW_DAYS * 86_400_000).toISOString(),
  });
  const mine = queue.filter((p) => usable.has(p.channelId));
  summary.otherChannels = queue.length - mine.length;
  summary.found = mine.length;
  if (mine.length === 0) return summary;

  const known = await knownTargets(db, mine.map((p) => p.id));
  summary.known = mine.filter((p) => known.has(p.id)).length;
  summary.updated = await alignKnown(db, brand, mine, known);

  const fresh = mine.filter((p) => !known.has(p.id));
  const ready = fresh.filter((p) => !p.createdAt || started - Date.parse(p.createdAt) >= GRACE_MS);
  summary.recent = fresh.length - ready.length;

  for (const group of groupQueue(ready)) {
    if (summary.imported >= MAX_CREATIONS_PER_CALL || Date.now() - started > TIME_BUDGET_MS) {
      summary.deferred += group.length;
      continue;
    }
    // Garde-fou contre deux imports simultanés (double clic, deux onglets).
    if ((await knownTargets(db, group.map((p) => p.id))).size > 0) {
      summary.known += group.length;
      continue;
    }
    await createFromGroup(db, brand, group, summary.mediaErrors);
    summary.imported++;
    summary.importedChannels += group.length;
  }
  return summary;
}
