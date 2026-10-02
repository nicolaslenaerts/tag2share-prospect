/**
 * Règles de publication : ce que chaque réseau accepte, ce que chaque canal
 * reçoit, et la validation complète d'un post AVANT tout appel à Buffer.
 *
 * Module PUR (aucun accès réseau ni base) : l'éditeur l'utilise pour afficher
 * les problèmes au fil de la saisie, le serveur pour refuser une programmation
 * invalide. Une seule source de vérité, donc pas d'écart entre ce que l'aperçu
 * promet et ce qui part.
 *
 * Validation globale avant envoi : Buffer ne connaît qu'un canal par post.
 * Un post refusé au troisième canal laisserait les deux premiers partis et le
 * troisième non, ce qui ne se rattrape pas proprement.
 */
import type {
  MediaKind,
  SocialFormat,
  SocialMedia,
  SocialPostStatus,
  SocialTarget,
  TargetStatus,
} from "./types";

export const SERVICE_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  twitter: "X",
  threads: "Threads",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  youtube: "YouTube",
  googlebusiness: "Google Business",
};

/** Couleur et monogramme d'un réseau (pastilles du calendrier, onglets d'aperçu). */
export const SERVICE_STYLE: Record<string, { bg: string; letter: string }> = {
  instagram: { bg: "bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600", letter: "IG" },
  facebook: { bg: "bg-[#1877F2]", letter: "f" },
  linkedin: { bg: "bg-[#0A66C2]", letter: "in" },
  twitter: { bg: "bg-black", letter: "X" },
  threads: { bg: "bg-black", letter: "@" },
  tiktok: { bg: "bg-black", letter: "TT" },
  pinterest: { bg: "bg-[#E60023]", letter: "P" },
  youtube: { bg: "bg-[#FF0000]", letter: "YT" },
};

export function serviceLabel(service: string): string {
  return SERVICE_LABEL[service] ?? service;
}

export const FORMAT_LABEL: Record<SocialFormat, string> = {
  post: "Publication",
  reel: "Réel",
  carousel: "Carrousel",
};

export const POST_STATUS_LABEL: Record<SocialPostStatus, string> = {
  draft: "Brouillon",
  scheduled: "Programmé",
  published: "Publié",
  partial: "Publié en partie",
  failed: "Échec",
};

export const TARGET_STATUS_LABEL: Record<TargetStatus, string> = {
  pending: "Non envoyé",
  scheduled: "Programmé",
  buffer_draft: "Brouillon Buffer",
  published: "Publié",
  failed: "Échec",
};

/**
 * Longueur maximale du texte par réseau (caractères). Au-delà, Buffer refuse
 * le post : on bloque avant.
 */
export const TEXT_LIMITS: Record<string, number> = {
  instagram: 2200,
  linkedin: 3000,
  facebook: 63206,
  twitter: 280,
  threads: 500,
  tiktok: 2200,
  pinterest: 500,
  bluesky: 300,
  mastodon: 500,
};

/** Réseaux où le format réel existe. Ailleurs, la vidéo part en post classique. */
export const REEL_SERVICES: ReadonlySet<string> = new Set(["instagram", "facebook"]);

/**
 * Réseaux qui acceptent un « premier commentaire » (metadata.<service>.firstComment,
 * vérifié par introspection du schéma Buffer).
 */
export const FIRST_COMMENT_SERVICES: ReadonlySet<string> = new Set([
  "instagram",
  "facebook",
  "linkedin",
]);

export const MIN_CAROUSEL_IMAGES = 2;
export const MAX_CAROUSEL_IMAGES = 10;

/** Plafond d'images plus bas que le carrousel standard. */
const MAX_IMAGES_BY_SERVICE: Record<string, number> = { twitter: 4, bluesky: 4 };

export const MEDIA_RULES: Record<
  MediaKind,
  { mimeTypes: readonly string[]; maxBytes: number; label: string }
> = {
  image: {
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxBytes: 10 * 1024 * 1024,
    label: "JPG, PNG, WebP, GIF (10 Mo)",
  },
  video: {
    mimeTypes: ["video/mp4", "video/quicktime"],
    maxBytes: 100 * 1024 * 1024,
    label: "MP4, MOV (100 Mo)",
  },
  // Plafond LinkedIn pour un document : 100 Mo, 300 pages.
  document: {
    mimeTypes: ["application/pdf"],
    maxBytes: 100 * 1024 * 1024,
    label: "PDF (100 Mo)",
  },
};

export function mediaKind(mimeType: string): MediaKind | null {
  const mime = mimeType.toLowerCase();
  for (const kind of Object.keys(MEDIA_RULES) as MediaKind[]) {
    if (MEDIA_RULES[kind].mimeTypes.includes(mime)) return kind;
  }
  return null;
}

type MediaLike = Pick<SocialMedia, "kind" | "position" | "filename" | "thumbnail_path">;

function byPosition<M extends MediaLike>(media: M[]): M[] {
  return [...media].sort((a, b) => a.position - b.position);
}

/**
 * Médias qui partiront réellement sur un canal, dans l'ordre. Même règle pour
 * l'aperçu et pour l'appel Buffer.
 */
export function mediaForTarget<M extends MediaLike>(
  format: SocialFormat,
  service: string,
  media: M[]
): M[] {
  const sorted = byPosition(media);
  const images = sorted.filter((m) => m.kind === "image");
  const videos = sorted.filter((m) => m.kind === "video");
  const docs = sorted.filter((m) => m.kind === "document");
  if (format === "reel") return videos.slice(0, 1);
  if (format === "carousel") return service === "linkedin" ? docs.slice(0, 1) : images;
  return [...images, ...videos].slice(0, 1);
}

export type PlanCheck = { errors: string[]; warnings: string[] };

/**
 * Ce que l'offre Buffer de la marque autorise. Offre inconnue (pas encore
 * détectée) : tout est permis, Buffer tranchera.
 */
export type PlanFeatures = {
  /** Premier commentaire : offres payantes seulement. */
  firstComment: boolean;
  /** Posts programmés au plus par canal (10 en offre gratuite), null si inconnu. */
  scheduledPostsPerChannel: number | null;
};

export function planFeatures(
  plan: "free" | "paid" | null | undefined,
  limits?: { scheduledPosts: number } | null
): PlanFeatures {
  return { firstComment: plan !== "free", scheduledPostsPerChannel: limits?.scheduledPosts ?? null };
}

export const FIRST_COMMENT_FREE_WARNING =
  "Premier commentaire non disponible avec l'offre gratuite de Buffer : il ne sera pas envoyé.";

/**
 * Canaux dont la file Buffer est déjà pleine. `queued` = posts déjà programmés
 * sur le canal, CE post exclu. Compté sur les posts connus de l'outil : un post
 * créé dans Buffer sans être importé échappe au compte (Buffer refusera alors
 * lui-même, avec son propre message).
 */
export function queueErrors(
  channels: { label: string; queued: number }[],
  limit: number | null
): string[] {
  if (!limit) return [];
  return channels
    .filter((c) => c.queued >= limit)
    .map(
      (c) =>
        `${c.label} : file Buffer pleine (${c.queued}/${limit} posts programmés). Attendez qu'un post parte, déprogrammez-en un, ou passez à une offre Buffer payante.`
    );
}

/**
 * Valide un post complet pour un ensemble de canaux. Renvoie TOUS les
 * problèmes d'un coup (vide = programmable) : l'utilisateur les corrige en une
 * fois plutôt qu'au fil des refus.
 */
export function checkPlan(input: {
  format: SocialFormat;
  text: string;
  firstComment?: string | null;
  services: string[];
  media: MediaLike[];
  /** Offre Buffer de la marque ; absente = pas de restriction. */
  features?: PlanFeatures;
}): PlanCheck {
  const { format, text, services } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const media = byPosition(input.media);
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  const docs = media.filter((m) => m.kind === "document");
  const unique = [...new Set(services)];
  const hasLinkedIn = unique.includes("linkedin");
  const others = unique.filter((s) => s !== "linkedin");

  if (unique.length === 0) errors.push("Choisissez au moins un canal.");
  if (!text.trim() && media.length === 0) errors.push("Le post est vide : ajoutez un texte ou un visuel.");

  if (format === "post") {
    if (images.length + videos.length > 1)
      errors.push("Une publication porte un seul visuel. Passez en format Carrousel pour en publier plusieurs.");
    if (docs.length) errors.push("Un PDF se publie en format Carrousel (LinkedIn).");
  }

  if (format === "reel") {
    if (videos.length === 0) errors.push("Un réel se publie avec une vidéo.");
    if (videos.length > 1) errors.push("Un réel ne contient qu'une seule vidéo.");
    if (images.length || docs.length)
      errors.push("Un réel ne contient que la vidéo : retirez les images et le PDF.");
    const noReel = unique.filter((s) => !REEL_SERVICES.has(s));
    if (noReel.length)
      warnings.push(
        `${noReel.map(serviceLabel).join(", ")} : pas de format réel, la vidéo y part en publication classique.`
      );
  }

  if (format === "carousel") {
    if (videos.length) errors.push("Le carrousel se compose d'images (et d'un PDF pour LinkedIn) : retirez la vidéo.");
    if (docs.length > 1) errors.push("Un seul PDF par carrousel LinkedIn.");
    if (others.length && (images.length < MIN_CAROUSEL_IMAGES || images.length > MAX_CAROUSEL_IMAGES))
      errors.push(
        `${others.map(serviceLabel).join(", ")} : le carrousel demande entre ${MIN_CAROUSEL_IMAGES} et ${MAX_CAROUSEL_IMAGES} images (${images.length} actuellement).`
      );
    if (hasLinkedIn && docs.length === 0)
      errors.push("LinkedIn : ajoutez le PDF du carrousel, ou générez-le depuis les images.");
    if (!hasLinkedIn && docs.length)
      warnings.push("Le PDF ne sert qu'à LinkedIn : aucun canal LinkedIn n'est sélectionné.");
  }

  for (const doc of docs) {
    if (!doc.thumbnail_path)
      errors.push(`Le PDF « ${doc.filename} » n'a pas de vignette : retirez-le puis ajoutez-le de nouveau.`);
  }

  for (const service of unique) {
    const label = serviceLabel(service);
    const limit = TEXT_LIMITS[service];
    if (limit && text.length > limit)
      errors.push(`${label} : ${text.length} caractères, ${limit} au maximum.`);

    const sent = mediaForTarget(format, service, media);
    // Carrousel et réel ont déjà leur propre règle de médias, plus précise.
    if (service === "instagram" && format === "post" && sent.length === 0)
      errors.push("Instagram exige un visuel (image ou vidéo).");
    if ((service === "tiktok" || service === "youtube") && !sent.some((m) => m.kind === "video"))
      errors.push(`${label} : une vidéo est obligatoire.`);
    if (service === "pinterest" && sent.length === 0) errors.push("Pinterest exige une image.");
    const maxImages = MAX_IMAGES_BY_SERVICE[service];
    if (maxImages && sent.filter((m) => m.kind === "image").length > maxImages)
      errors.push(`${label} : ${maxImages} images au maximum.`);
  }

  if (input.firstComment?.trim()) {
    if (input.features && !input.features.firstComment) {
      warnings.push(FIRST_COMMENT_FREE_WARNING);
    } else {
      const ignored = unique.filter((s) => !FIRST_COMMENT_SERVICES.has(s));
      if (ignored.length)
        warnings.push(`Premier commentaire ignoré sur ${ignored.map(serviceLabel).join(", ")}.`);
    }
  }

  return { errors, warnings };
}

/**
 * Statut d'ensemble d'un post d'après ses canaux. Un canal encore programmé
 * l'emporte : le post n'est pas fini tant qu'il reste quelque chose à partir
 * (le détail par canal reste affiché, échecs compris).
 */
export function rollupStatus(targets: Pick<SocialTarget, "status">[]): SocialPostStatus {
  if (targets.length === 0) return "draft";
  const count = (s: TargetStatus) => targets.filter((t) => t.status === s).length;
  if (count("scheduled") > 0) return "scheduled";
  const published = count("published");
  const failed = count("failed");
  if (published === targets.length) return "published";
  if (published > 0) return "partial";
  if (failed > 0) return "failed";
  return "draft";
}

/** Libellé court d'un post : son titre interne, sinon le début du texte. */
export function postLabel(post: { title: string | null; text: string }, max = 80): string {
  const base = post.title?.trim() || post.text.replace(/\s+/g, " ").trim() || "Sans texte";
  return base.length > max ? `${base.slice(0, max - 3)}...` : base;
}
