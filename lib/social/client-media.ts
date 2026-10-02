"use client";
/**
 * Médias côté navigateur : upload direct vers Supabase Storage, vignettes et
 * conversions.
 *
 * Tout ce qui demande un rendu (page 1 d'un PDF, image d'une vidéo, PDF
 * assemblé depuis des images) se fait ICI plutôt que sur le serveur : les
 * fonctions serverless n'ont ni canvas natif ni la place d'accueillir une
 * vidéo, et le navigateur a déjà le fichier sous la main.
 *
 * pdfjs-dist et pdf-lib sont chargés à la demande (imports dynamiques) : ils
 * ne pèsent sur la page que si l'on ajoute un PDF.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "@/lib/api";
import { MEDIA_RULES, mediaKind } from "./rules";
import type { MediaInput, MediaKind } from "./types";

const BUCKET = "social-media";

let browserClient: SupabaseClient | null = null;
function storageClient(): SupabaseClient {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes.");
    browserClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return browserClient;
}

/** Envoie un fichier dans le bucket via une URL signée émise par le serveur. */
export async function uploadBlob(
  blob: Blob,
  filename: string,
  purpose: "media" | "thumbnail" = "media"
): Promise<{ path: string; publicUrl: string }> {
  const mimeType = blob.type || "application/octet-stream";
  const { path, token, publicUrl } = await api<{ path: string; token: string; publicUrl: string }>(
    "/api/social/media/upload-url",
    { method: "POST", json: { filename, mimeType, size: blob.size, purpose } }
  );
  const { error } = await storageClient()
    .storage.from(BUCKET)
    .uploadToSignedUrl(path, token, blob, { contentType: mimeType, upsert: false });
  if (error) {
    const tooBig = /maximum allowed size|payload too large|413/i.test(error.message);
    throw new Error(
      tooBig
        ? `« ${filename} » dépasse la taille autorisée par Supabase Storage (50 Mo sur l'offre gratuite).`
        : `Envoi de « ${filename} » impossible : ${error.message}`
    );
  }
  return { path, publicUrl };
}

// ─── Mesures et vignettes ────────────────────────────────────────────────────

export async function imageSize(src: Blob | string): Promise<{ width: number; height: number }> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Rendu de l'image impossible."))), type, quality)
  );
}

/** Dimensions d'une vidéo et image extraite vers 1 s (vignette d'aperçu). */
export async function videoInfo(file: Blob): Promise<{ width: number; height: number; thumbnail: Blob | null }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Vidéo illisible par le navigateur."));
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    let thumbnail: Blob | null = null;
    try {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 3000);
      });
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1080 / Math.max(width, 1));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbnail = await canvasToBlob(canvas, "image/jpeg", 0.85);
    } catch {
      // Codec non décodable ici (HEVC sous Chrome...) : pas de vignette, l'aperçu lit la vidéo.
    }
    return { width, height, thumbnail };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return lib;
}

type PdfSource = Blob | string;

async function openPdf(src: PdfSource) {
  const lib = await pdfjs();
  const data = typeof src === "string" ? { url: src } : { data: new Uint8Array(await src.arrayBuffer()) };
  return lib.getDocument(data).promise;
}

async function renderPage(
  doc: Awaited<ReturnType<typeof openPdf>>,
  pageNumber: number,
  width: number
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  // Fond blanc explicite : les vignettes partent en JPEG, sans transparence.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Nombre de pages et vignette (page 1 en JPEG). Buffer exige cette vignette
 * pour un document LinkedIn et ne la calcule pas lui-même.
 */
export async function pdfInfo(src: PdfSource): Promise<{ pageCount: number; thumbnail: Blob; width: number; height: number }> {
  const doc = await openPdf(src);
  try {
    const canvas = await renderPage(doc, 1, 1080);
    return {
      pageCount: doc.numPages,
      thumbnail: await canvasToBlob(canvas, "image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    await doc.destroy();
  }
}

/** Pages d'un PDF rendues en images (aperçu LinkedIn). */
export async function pdfPages(src: PdfSource, maxPages = 20, width = 720): Promise<string[]> {
  const doc = await openPdf(src);
  try {
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const canvas = await renderPage(doc, i, width);
      out.push(canvas.toDataURL("image/jpeg", 0.8));
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Largeur max d'une page de carrousel PDF : LinkedIn redimensionne au-delà. */
const MAX_PDF_PAGE_WIDTH = 1600;

/**
 * Assemble des images en PDF, une page par image À SON RATIO (pas de
 * recadrage). Sert à fabriquer le carrousel LinkedIn depuis les images
 * Instagram / Facebook.
 */
export async function imagesToPdf(urls: string[]): Promise<Blob> {
  if (urls.length === 0) throw new Error("Aucune image à assembler.");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const url of urls) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_PDF_PAGE_WIDTH / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    // Fond blanc : un PNG transparent deviendrait noir en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.88);
    const embedded = await pdf.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

// ─── Préparation complète d'un fichier ───────────────────────────────────────

/** Média prêt à être joint au post, avec ses URL publiques pour l'aperçu. */
export type ComposerMedia = MediaInput & { url: string; thumbnail_url: string | null };

/**
 * Contrôle, mesure, vignette éventuelle et upload d'un fichier choisi par
 * l'utilisateur. Lève avec un message lisible si le fichier est refusé.
 */
export async function prepareMedia(file: File, expected?: MediaKind[]): Promise<ComposerMedia> {
  const kind = mediaKind(file.type);
  if (!kind) throw new Error(`« ${file.name} » : type non pris en charge (${file.type || "inconnu"}).`);
  if (expected && !expected.includes(kind))
    throw new Error(`« ${file.name} » : attendu ${expected.map((k) => MEDIA_RULES[k].label).join(" ou ")}.`);
  if (file.size > MEDIA_RULES[kind].maxBytes)
    throw new Error(`« ${file.name} » dépasse la taille maximale : ${MEDIA_RULES[kind].label}.`);

  let width: number | null = null;
  let height: number | null = null;
  let pageCount: number | null = null;
  let thumbnail: Blob | null = null;

  if (kind === "image") ({ width, height } = await imageSize(file));
  if (kind === "video") ({ width, height, thumbnail } = await videoInfo(file));
  if (kind === "document") {
    const info = await pdfInfo(file);
    ({ width, height, thumbnail } = info);
    pageCount = info.pageCount;
  }

  const main = await uploadBlob(file, file.name);
  const thumb = thumbnail
    ? await uploadBlob(thumbnail, `${file.name}.${thumbnail.type === "image/png" ? "png" : "jpg"}`, "thumbnail")
    : null;

  return {
    kind,
    position: 0,
    storage_path: main.path,
    url: main.publicUrl,
    mime_type: file.type,
    filename: file.name,
    size_bytes: file.size,
    width,
    height,
    thumbnail_path: thumb?.path ?? null,
    thumbnail_url: thumb?.publicUrl ?? null,
    page_count: pageCount,
  };
}
