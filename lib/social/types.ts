/**
 * Contrat des posts réseaux sociaux, partagé par le navigateur et le serveur.
 *
 * Module PUR : aucun accès réseau ni base, importable depuis un composant
 * client. Le vocabulaire suit celui de Buffer quand il existe (channel,
 * service), en français pour le reste.
 */

/**
 * Format éditorial d'un post :
 *   - post     : texte + au plus un visuel (image ou vidéo) ;
 *   - reel     : une vidéo, publiée en réel sur Instagram et Facebook, en
 *                vidéo classique ailleurs ;
 *   - carousel : 2 à 10 images pour Instagram / Facebook, un PDF pour
 *                LinkedIn (carrousel document).
 */
export type SocialFormat = "post" | "reel" | "carousel";

export type MediaKind = "image" | "video" | "document";

/** Statut d'ensemble d'un post, déduit de celui de ses canaux. */
export type SocialPostStatus = "draft" | "scheduled" | "published" | "partial" | "failed";

/**
 * Statut d'un canal ciblé :
 *   - pending      : pas encore envoyé à Buffer ;
 *   - scheduled    : programmé dans Buffer, pas encore parti ;
 *   - buffer_draft : créé en brouillon dans Buffer (test), ne partira pas seul ;
 *   - published    : publié sur le réseau ;
 *   - failed       : refusé par Buffer ou par le réseau.
 */
export type TargetStatus = "pending" | "scheduled" | "buffer_draft" | "published" | "failed";

export type SocialChannel = {
  id: string;
  service: string;
  name: string | null;
  display_name: string | null;
  avatar: string | null;
  enabled: boolean;
  disconnected: boolean;
};

export type SocialMedia = {
  id?: string;
  kind: MediaKind;
  position: number;
  storage_path: string;
  /** URL publique, recalculée côté serveur depuis storage_path. */
  url: string;
  mime_type: string;
  filename: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  thumbnail_url: string | null;
  page_count: number | null;
};

export type SocialTarget = {
  id: string;
  channel_id: string;
  service: string;
  status: TargetStatus;
  buffer_post_id: string | null;
  published_url: string | null;
  published_at: string | null;
  error: string | null;
};

export type SocialPost = {
  id: string;
  brand: string;
  title: string | null;
  text: string;
  format: SocialFormat;
  scheduled_at: string | null;
  status: SocialPostStatus;
  first_comment: string | null;
  notify: boolean;
  notify_email: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  targets: SocialTarget[];
  media: SocialMedia[];
};

/** Média tel que l'éditeur l'envoie à l'enregistrement (URL recalculée serveur). */
export type MediaInput = Omit<SocialMedia, "id" | "url" | "thumbnail_url">;

/** Corps d'une création / modification de post. */
export type PostInput = {
  title: string | null;
  text: string;
  format: SocialFormat;
  scheduled_at: string | null;
  first_comment: string | null;
  notify: boolean;
  notify_email: string | null;
  channel_ids: string[];
  media: MediaInput[];
};

/** Mode d'envoi vers Buffer. */
export type ScheduleMode = "schedule" | "now" | "buffer_draft";

/** État de la connexion Buffer d'une marque, tel que l'interface le voit. */
export type ConnectionView = {
  /** Migration 0018 appliquée ? */
  ready: boolean;
  /** SOCIAL_ENCRYPTION_KEY présente et valide ? */
  encryptionReady: boolean;
  connected: boolean;
  accountEmail: string | null;
  keyHint: string | null;
  notifyEmail: string | null;
  /** Repli quand notifyEmail est vide : adresse de test de la marque. */
  defaultNotifyEmail: string | null;
  connectedAt: string | null;
  channelsSyncedAt: string | null;
  channels: SocialChannel[];
  /** Offre Buffer détectée d'après les limites de l'organisation (null : inconnue). */
  plan: "free" | "paid" | null;
  limits: { channels: number; scheduledPosts: number; members: number; postTemplates: number } | null;
};
