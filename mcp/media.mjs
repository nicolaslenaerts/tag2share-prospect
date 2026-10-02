/**
 * Médias des posts réseaux sociaux, côté serveur MCP.
 *
 * L'éditeur du navigateur prépare un média ainsi (lib/social/client-media.ts) :
 * mesure, vignette éventuelle, puis upload DIRECT vers Supabase Storage via une
 * URL signée émise par l'API. On refait le même chemin, avec ce qu'offre une
 * machine plutôt qu'un navigateur :
 *
 *   - la source est un fichier local ou une URL https (téléchargée d'abord) ;
 *   - les dimensions d'une image se lisent dans son en-tête (PNG, JPEG, GIF,
 *     WebP), sans dépendance ;
 *   - la vignette d'un PDF (EXIGÉE par Buffer pour un document LinkedIn, qui ne
 *     la calcule pas) et celle d'une vidéo (confort d'aperçu) sont rendues par
 *     les outils du poste : pdftoppm / ffmpeg s'ils sont installés, sinon sips /
 *     qlmanage sur macOS.
 *
 * SÉCURITÉ. Tout ce qui part d'ici atterrit dans un bucket PUBLIC, et l'agent
 * qui appelle l'outil peut avoir lu une page ou un document piégé. Deux règles :
 *   - le type d'un fichier se lit dans son CONTENU (signature des premiers
 *     octets), jamais dans son nom ni dans un paramètre : un fichier de config
 *     ou une clé ne passe pas pour une image ;
 *   - une URL se télécharge en https seulement, et l'adresse est contrôlée AU
 *     MOMENT DE LA CONNEXION (redirections comprises) : rien sur le poste ni le
 *     réseau local ne peut être aspiré puis publié.
 *
 * La taille est validée par l'API (/api/social/media/upload-url) AVANT la
 * lecture complète du fichier : une seule source de vérité, MEDIA_RULES.
 */
import { execFile } from "node:child_process";
import dns from "node:dns";
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isAllowedTarget, request } from "./client.mjs";

const run = promisify(execFile);

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
};

const ACCEPTED = "images JPG, PNG, WebP, GIF ; vidéos MP4, MOV ; PDF";

/** Marques `ftyp` d'une vidéo MP4. HEIC, AVIF ou 3GP portent les leurs et sont refusés. */
const MP4_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1",
  "M4V ", "M4VH", "M4VP", "dash", "mmp4", "MSNV", "f4v ",
]);

/**
 * Type réel d'un fichier d'après ses premiers octets, ou null s'il n'est pas
 * un média accepté. C'est la seule source du type : l'extension ment
 * facilement, le contenu beaucoup moins.
 */
export function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a)
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return "image/gif";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (buf.length >= 12) {
    const box = buf.toString("latin1", 4, 8);
    if (box === "ftyp") {
      const brand = buf.toString("latin1", 8, 12);
      if (brand === "qt  ") return "video/quicktime";
      return MP4_BRANDS.has(brand) ? "video/mp4" : null;
    }
    // Anciens .mov sans ftyp : le premier atome est directement moov, mdat...
    if (["moov", "mdat", "wide", "free", "skip"].includes(box)) return "video/quicktime";
  }
  return null;
}

/** Premiers octets d'un fichier, sans le lire en entier. */
async function head(abs, bytes = 4096) {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/* ------------------------------------------------------------------ */
/* Adresses réseau                                                     */
/* ------------------------------------------------------------------ */

/** Plages qui ne doivent jamais être téléchargées : poste, réseau local, métadonnées cloud. */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) PRIVATE.addSubnet(net, prefix, "ipv4");
// Pas de règle ::ffff:0:0/96 : BlockList compare déjà une adresse IPv4 mappée
// (::ffff:127.0.0.1, ::ffff:7f00:1) aux règles IPv4, et une telle règle
// bloquerait en retour TOUTES les adresses IPv4.
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) PRIVATE.addSubnet(net, prefix, "ipv6");

/** Vrai si l'adresse IP est publique (joignable sur internet, hors réseau local). */
export function isPublicAddress(ip) {
  const family = isIP(ip);
  if (!family) return false;
  return !PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Résolution DNS contrôlée, branchée sur la connexion elle-même : vérifier
 * l'adresse avant le fetch puis laisser le fetch résoudre à nouveau laisserait
 * un nom de domaine changer d'adresse entre les deux (DNS rebinding).
 */
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === "object" && options ? options : { family: options || 0 };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad) return callback(new Error(`adresse ${bad.address} refusée (poste ou réseau local)`));
    if (opts.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(raw, original = raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL invalide : ${original}`);
  }
  if (u.protocol !== "https:") throw new Error(`URL refusée (https seulement) : ${original}`);
  // Une IP littérale ne passe pas par la résolution DNS : contrôle direct.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host))
    throw new Error(`URL refusée (adresse du poste ou du réseau local) : ${original}`);
  return u;
}

function httpsGet(u) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { lookup: guardedLookup, timeout: 60_000 }, resolve);
    req.on("timeout", () => req.destroy(new Error("délai dépassé")));
    req.on("error", reject);
  });
}

/** Téléchargement https, redirections suivies À LA MAIN pour contrôler chaque étape. */
async function download(raw) {
  let u = checkUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    let res;
    try {
      res = await httpsGet(u);
    } catch (e) {
      throw new Error(`Téléchargement impossible (${e.message}) : ${raw}`);
    }
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      u = checkUrl(new URL(res.headers.location, u).toString(), raw);
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`Téléchargement impossible (${res.statusCode}) : ${raw}`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD_BYTES) {
        res.destroy();
        throw new Error(`Fichier trop lourd (plus de ${MAX_DOWNLOAD_BYTES} octets) : ${raw}`);
      }
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), finalUrl: u };
  }
  throw new Error(`Trop de redirections : ${raw}`);
}

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

/**
 * Fichier local : chemin absolu, ou relatif au dossier courant. Le type vient
 * du contenu ; `name` remplace le nom affiché (fichier téléchargé).
 */
async function fromFile(file, name) {
  const abs = path.resolve(expandHome(String(file)));
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`Fichier introuvable : ${abs}`);
  }
  if (!info.isFile()) throw new Error(`Pas un fichier : ${abs}`);
  const shown = name || path.basename(abs);
  const mime = sniff(await head(abs));
  if (!mime) throw new Error(`« ${shown} » refusé : son contenu n'est pas un média accepté (${ACCEPTED}).`);
  // Le nom suit le contenu : un PNG nommé .jpg repart en .png.
  const ext = path.extname(shown);
  const base = ext ? shown.slice(0, -ext.length) : shown;
  const expected = EXT_BY_MIME[mime];
  const filename = ext.toLowerCase() === expected || (expected === ".jpg" && ext.toLowerCase() === ".jpeg")
    ? shown
    : `${base || "media"}${expected}`;
  return { abs, filename, mime, size: info.size };
}

/** URL https : téléchargée dans `dir`, puis traitée comme un fichier local. */
async function fromUrl(url, dir) {
  const { bytes, finalUrl } = await download(url);
  let urlName = "media";
  try {
    urlName = decodeURIComponent(path.basename(finalUrl.pathname)) || "media";
  } catch {
    // Nom mal encodé : on garde le nom par défaut.
  }
  const abs = path.join(dir, `dl-${Date.now()}-${urlName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80)}`);
  await writeFile(abs, bytes);
  return fromFile(abs, urlName);
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
  if (!isAllowedTarget(uploadUrl))
    throw new Error("URL d'upload refusée : https obligatoire hors localhost.");

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

/** Vignette : même contrôle du contenu, et seulement PNG ou JPEG (règle de l'API). */
async function thumbnailSource(file) {
  const src = await fromFile(file);
  if (src.mime !== "image/png" && src.mime !== "image/jpeg")
    throw new Error(`Vignette « ${src.filename} » refusée : PNG ou JPEG attendu.`);
  return src;
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

      if (item.mime_type)
        throw new Error(`${label} : mime_type n'est plus accepté, le type est lu dans le contenu du fichier.`);
      const src = item.file ? await fromFile(item.file) : await fromUrl(item.url, dir);
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

      // Vignette contrôlée AVANT tout envoi, puis le fichier principal : s'il est
      // refusé (type, taille), aucune vignette orpheline ne reste dans le bucket.
      const t = thumbFile ? await thumbnailSource(thumbFile) : null;
      const main = await upload(brand, src);
      let thumbPath = null;
      if (t) {
        const thumb = await upload(brand, t, "thumbnail");
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
