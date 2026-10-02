/**
 * Médias des posts réseaux sociaux, côté serveur MCP.
 *
 * L'éditeur du navigateur prépare un média ainsi (lib/social/client-media.ts) :
 * mesure, vignette éventuelle, puis upload DIRECT vers Supabase Storage via une
 * URL signée émise par l'API. On refait le même chemin, avec ce qu'offre une
 * machine plutôt qu'un navigateur :
 *
 *   - la source est un fichier local ou une URL http(s) (téléchargée d'abord) ;
 *   - les dimensions d'une image se lisent dans son en-tête (PNG, JPEG, GIF,
 *     WebP), sans dépendance ;
 *   - la vignette d'un PDF (EXIGÉE par Buffer pour un document LinkedIn, qui ne
 *     la calcule pas) et celle d'une vidéo (confort d'aperçu) sont rendues par
 *     les outils du poste : pdftoppm / ffmpeg s'ils sont installés, sinon sips /
 *     qlmanage sur macOS.
 *
 * Le type et la taille sont validés par l'API (/api/social/media/upload-url)
 * AVANT la lecture du fichier : une seule source de vérité, MEDIA_RULES.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { request } from "./client.mjs";

const run = promisify(execFile);

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

const EXT_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext])
);

/** Au-delà, un téléchargement est abandonné (le plus gros média accepté fait 100 Mo). */
const MAX_DOWNLOAD_BYTES = 110 * 1024 * 1024;

function kindOf(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return null;
}

function expandHome(p) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/** Fichier local : chemin absolu, ou relatif au dossier courant. */
async function fromFile(file, mimeOverride) {
  const abs = path.resolve(expandHome(String(file)));
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`Fichier introuvable : ${abs}`);
  }
  if (!info.isFile()) throw new Error(`Pas un fichier : ${abs}`);
  const filename = path.basename(abs);
  const mime = (mimeOverride || MIME_BY_EXT[path.extname(abs).toLowerCase()] || "").toLowerCase();
  if (!mime)
    throw new Error(
      `« ${filename} » : extension non reconnue. Acceptés : ${Object.keys(MIME_BY_EXT).join(", ")}.`
    );
  return { abs, filename, mime, size: info.size };
}

/** URL http(s) : téléchargée dans `dir`, puis traitée comme un fichier local. */
async function fromUrl(url, dir, mimeOverride) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`URL invalide : ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new Error(`URL non prise en charge (http ou https seulement) : ${url}`);

  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`Fichier trop lourd (${declared} octets) : ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error(`Fichier trop lourd (${bytes.length} octets) : ${url}`);

  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const urlName = decodeURIComponent(path.basename(u.pathname)) || "media";
  const mime = (mimeOverride || (EXT_BY_MIME[headerMime] ? headerMime : "") ||
    MIME_BY_EXT[path.extname(urlName).toLowerCase()] || "").toLowerCase();
  if (!mime) throw new Error(`Type de fichier non reconnu (${headerMime || "inconnu"}) : ${url}`);
  const filename = path.extname(urlName) ? urlName : `${urlName}${EXT_BY_MIME[mime]}`;

  const abs = path.join(dir, `dl-${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]+/g, "-")}`);
  await writeFile(abs, bytes);
  return { abs, filename, mime, size: bytes.length };
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/**
 * Envoie un fichier dans le bucket `social-media`. L'API choisit le chemin
 * (préfixé par la marque, avec un UUID) et valide type et taille ; le fichier
 * part ensuite directement vers Supabase, comme depuis le navigateur.
 */
async function upload(brand, src, purpose = "media") {
  const { path: storagePath, uploadUrl, publicUrl } = await request("/api/social/media/upload-url", {
    method: "POST",
    brand,
    body: { filename: src.filename, mimeType: src.mime, size: src.size, purpose },
  });
  if (!uploadUrl)
    throw new Error(
      "L'instance visée ne renvoie pas d'URL d'upload complète (uploadUrl) : déployez la version " +
        "à jour de app/api/social/media/upload-url/route.ts."
    );

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": src.mime, "cache-control": "max-age=3600", "x-upsert": "false" },
    body: await readFile(src.abs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const tooBig = res.status === 413 || /maximum allowed size|payload too large/i.test(text);
    throw new Error(
      tooBig
        ? `« ${src.filename} » dépasse la taille autorisée par Supabase Storage (50 Mo sur l'offre gratuite).`
        : `Envoi de « ${src.filename} » impossible (${res.status}) : ${text.slice(0, 200)}`
    );
  }
  return { storagePath, publicUrl };
}

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

/** Dimensions lues dans l'en-tête d'une image, ou null si le format surprend. */
export function imageSize(buf) {
  // PNG : IHDR juste après la signature.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  // GIF : écran logique, little-endian.
  if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF")
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  // WebP : trois variantes de bloc.
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ")
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X")
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  // JPEG : on saute de segment en segment jusqu'au SOF.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Première commande qui aboutit et produit le fichier attendu ; null sinon. */
async function firstThatWorks(attempts) {
  for (const attempt of attempts) {
    try {
      await run(attempt.cmd, attempt.args, { timeout: 60_000 });
      const out = await attempt.output();
      if (out) return out;
    } catch {
      // Outil absent ou fichier qu'il ne sait pas lire : on passe au suivant.
    }
  }
  return null;
}

/** qlmanage écrit `<nom du fichier>.png` dans le dossier de sortie. */
async function qlmanageOutput(dir, filename) {
  const files = await readdir(dir);
  const hit = files.find((f) => f === `${filename}.png`);
  return hit ? path.join(dir, hit) : null;
}

async function existing(p) {
  try {
    return (await stat(p)).size > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Page 1 d'un PDF en JPEG de 1080 px de large (même rendu que l'éditeur). */
async function pdfThumbnail(src, dir) {
  const base = path.join(dir, "pdf-thumb");
  const ql = await mkdtemp(path.join(dir, "ql-"));
  return firstThatWorks([
    {
      cmd: "pdftoppm",
      args: ["-jpeg", "-singlefile", "-f", "1", "-l", "1", "-scale-to-x", "1080", "-scale-to-y", "-1", src.abs, base],
      output: () => existing(`${base}.jpg`),
    },
    {
      cmd: "sips",
      args: ["-s", "format", "jpeg", "--resampleWidth", "1080", src.abs, "--out", `${base}-sips.jpg`],
      output: () => existing(`${base}-sips.jpg`),
    },
    {
      cmd: "qlmanage",
      args: ["-t", "-s", "1080", "-o", ql, src.abs],
      output: () => qlmanageOutput(ql, path.basename(src.abs)),
    },
  ]);
}

/** Nombre de pages : pdfinfo si présent, sinon le plus grand /Count du fichier. */
async function pdfPageCount(src) {
  try {
    const { stdout } = await run("pdfinfo", [src.abs], { timeout: 30_000 });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    if (m) return Number(m[1]);
  } catch {
    // pdfinfo absent : repli ci-dessous.
  }
  const text = (await readFile(src.abs)).toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : null;
}

/** Image vers 1 s (ou la première) d'une vidéo, et ses dimensions. Au mieux. */
async function videoInfo(src, dir) {
  let width = null;
  let height = null;
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", src.abs],
      { timeout: 30_000 }
    );
    const m = stdout.trim().match(/^(\d+)x(\d+)/);
    if (m) [width, height] = [Number(m[1]), Number(m[2])];
  } catch {
    // ffprobe absent : dimensions inconnues, l'aperçu s'en passe.
  }
  const out = path.join(dir, "video-thumb.jpg");
  const ql = await mkdtemp(path.join(dir, "ql-"));
  const thumbnail = await firstThatWorks([
    {
      cmd: "ffmpeg",
      args: ["-y", "-loglevel", "error", "-ss", "1", "-i", src.abs, "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", out],
      output: () => existing(out),
    },
    {
      cmd: "qlmanage",
      args: ["-t", "-s", "1080", "-o", ql, src.abs],
      output: () => qlmanageOutput(ql, path.basename(src.abs)),
    },
  ]);
  return { width, height, thumbnail };
}

function thumbnailSource(file) {
  const ext = path.extname(file).toLowerCase();
  return { abs: file, filename: path.basename(file), mime: ext === ".png" ? "image/png" : "image/jpeg" };
}

/* ------------------------------------------------------------------ */
/* Préparation d'un média                                              */
/* ------------------------------------------------------------------ */

/** Champs d'un média tels que l'API les attend (lib/social/store.ts, parseMedia). */
function asInput(m) {
  return {
    storage_path: m.storage_path,
    mime_type: m.mime_type,
    filename: m.filename,
    size_bytes: m.size_bytes ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
    thumbnail_path: m.thumbnail_path ?? null,
    page_count: m.page_count ?? null,
  };
}

/**
 * Transforme la liste de médias d'un outil en médias prêts pour l'API.
 *
 * Chaque élément est l'un de :
 *   { file }          fichier local, envoyé dans le bucket ;
 *   { url }           fichier téléchargé puis envoyé ;
 *   { storage_path }  média DÉJÀ dans le bucket (celui d'un post existant de
 *                     la marque), réutilisé tel quel.
 * `thumbnail_file` remplace la vignette calculée (PDF, vidéo).
 *
 * @param {string} brand slug validé
 * @param {object[]} items médias demandés, dans l'ordre du carrousel
 * @param {object[]} known médias déjà connus (post en cours, autres posts)
 * @returns {Promise<{ media: object[], uploaded: object[] }>}
 */
export async function prepareMedia(brand, items, known = []) {
  const byPath = new Map(known.map((m) => [m.storage_path, m]));
  const dir = await mkdtemp(path.join(os.tmpdir(), "t2s-mcp-"));
  const media = [];
  const uploaded = [];
  try {
    for (const [i, item] of items.entries()) {
      const label = `média n° ${i + 1}`;
      const sources = ["file", "url", "storage_path"].filter((k) => item?.[k]);
      if (sources.length !== 1)
        throw new Error(`${label} : indiquez exactement un de file, url ou storage_path.`);

      if (item.storage_path) {
        const prev = byPath.get(item.storage_path);
        if (!prev)
          throw new Error(
            `${label} : « ${item.storage_path} » n'appartient à aucun post connu de cette marque. ` +
              "Utilisez file ou url pour un nouveau fichier."
          );
        media.push(asInput(prev));
        continue;
      }

      const src = item.file ? await fromFile(item.file, item.mime_type) : await fromUrl(item.url, dir, item.mime_type);
      const kind = kindOf(src.mime);
      if (!kind) throw new Error(`${label} : type non pris en charge (${src.mime}).`);

      let width = null;
      let height = null;
      let pageCount = null;
      let thumbFile = item.thumbnail_file ? path.resolve(expandHome(item.thumbnail_file)) : null;

      if (kind === "image") ({ width, height } = imageSize(await readFile(src.abs)) ?? { width, height });
      if (kind === "video") {
        const info = await videoInfo(src, dir);
        ({ width, height } = info);
        thumbFile ??= info.thumbnail;
      }
      if (kind === "document") {
        pageCount = await pdfPageCount(src);
        thumbFile ??= await pdfThumbnail(src, dir);
        if (!thumbFile)
          throw new Error(
            `« ${src.filename} » : impossible de rendre la vignette du PDF (exigée par LinkedIn). ` +
              "Installez poppler (brew install poppler) ou passez thumbnail_file (PNG ou JPEG)."
          );
      }

      // Le fichier principal d'abord : s'il est refusé (type, taille), aucune
      // vignette orpheline ne reste dans le bucket.
      const main = await upload(brand, src);
      let thumbPath = null;
      if (thumbFile) {
        const t = thumbnailSource(thumbFile);
        const tInfo = await stat(t.abs);
        const thumb = await upload(brand, { ...t, size: tInfo.size }, "thumbnail");
        thumbPath = thumb.storagePath;
        if (kind === "document") ({ width, height } = imageSize(await readFile(t.abs)) ?? { width, height });
      }

      media.push(
        asInput({
          storage_path: main.storagePath,
          mime_type: src.mime,
          filename: src.filename,
          size_bytes: src.size,
          width,
          height,
          thumbnail_path: thumbPath,
          page_count: pageCount,
        })
      );
      uploaded.push({ filename: src.filename, kind, url: main.publicUrl, thumbnail: Boolean(thumbPath), page_count: pageCount ?? undefined });
    }
    return { media, uploaded };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Médias d'un post chargé, re-sérialisés pour un PATCH qui les conserve. */
export function keepMedia(post) {
  return (post.media ?? []).map(asInput);
}
