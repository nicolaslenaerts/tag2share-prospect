import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { requireBrand } from "@/lib/brand-context";
import { socialFail } from "@/lib/social/http";
import { MEDIA_RULES, mediaKind } from "@/lib/social/rules";
import { isMissingTable, publicMediaUrl, SOCIAL_BUCKET, SocialError } from "@/lib/social/store";

export const runtime = "nodejs";

/** Vignettes générées par le navigateur (page 1 d'un PDF, image d'une vidéo). */
const THUMBNAIL_MIME = new Set(["image/png", "image/jpeg"]);
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

function safeName(filename: string): string {
  const cleaned = filename
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-80);
  return cleaned || "fichier";
}

/**
 * Émet une URL d'upload signée : le navigateur envoie le fichier directement
 * à Supabase Storage, sans passer par une fonction serverless (plafonnée à
 * 4,5 Mo de requête chez Vercel, une vidéo n'y passerait pas).
 *
 * Le chemin est choisi ICI, préfixé par la marque, avec un UUID : il est
 * public (Buffer doit pouvoir le télécharger) mais impossible à deviner.
 */
export async function POST(req: Request) {
  try {
    const brand = await requireBrand(req);
    const { filename, mimeType, size, purpose } = await readJson<{
      filename?: string;
      mimeType?: string;
      size?: number;
      purpose?: "media" | "thumbnail";
    }>(req);
    const mime = (mimeType || "").toLowerCase();
    if (!filename || !mime || typeof size !== "number") throw new SocialError("filename, mimeType et size requis.");

    if (purpose === "thumbnail") {
      if (!THUMBNAIL_MIME.has(mime) || size > THUMBNAIL_MAX_BYTES) throw new SocialError("Vignette invalide.");
    } else {
      const kind = mediaKind(mime);
      if (!kind)
        throw new SocialError(
          `Type non pris en charge (${mime}). Acceptés : ${Object.values(MEDIA_RULES).map((r) => r.label).join(" · ")}.`
        );
      if (size > MEDIA_RULES[kind].maxBytes)
        throw new SocialError(`« ${filename} » dépasse la taille maximale : ${MEDIA_RULES[kind].label}.`);
    }

    const month = new Date().toISOString().slice(0, 7);
    const path = `${brand.slug}/${month}/${randomUUID()}-${safeName(filename)}`;
    const db = supabaseAdmin();
    const { data, error } = await db.storage.from(SOCIAL_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      if (/bucket not found/i.test(error?.message ?? "") || isMissingTable(error as never))
        throw new SocialError(
          "Bucket « social-media » introuvable : exécutez supabase/migrations/0018_social_buffer.sql.",
          503
        );
      throw new SocialError(`Upload impossible : ${error?.message ?? "réponse vide"}`, 500);
    }
    return ok({ path, token: data.token, publicUrl: publicMediaUrl(db, path) });
  } catch (err) {
    return socialFail(err);
  }
}
