/**
 * Outils MCP des réseaux sociaux (publication via Buffer).
 *
 * Même posture que les outils de campagne : un client de l'API interne
 * (app/api/social/*), qui valide la marque avant d'écrire et réduit les
 * réponses à ce qu'un agent lit vraiment.
 *
 * Ce que l'agent peut faire, et ce qu'il ne peut pas :
 *   - créer et modifier des posts (publication, réel, carrousel), médias compris ;
 *   - les envoyer en BROUILLON Buffer (test : rien ne part) ou les PROGRAMMER à
 *     leur date, avec `confirm: true` explicite ;
 *   - JAMAIS les publier immédiatement : le mode `now` de l'API n'est pas
 *     exposé. Un post programmé reste retirable (unschedule) jusqu'à sa date ;
 *     un post parti à l'instant ne se rattrape pas ;
 *   - ni supprimer un post, ni toucher à la clé Buffer (connexion dans /social).
 *
 * Dates : l'agent DOIT donner un fuseau (Z ou ±hh:mm). Une date sans fuseau
 * serait lue dans celui du serveur (UTC chez Vercel) et décalerait le post
 * d'une ou deux heures sans que personne ne le voie.
 */
import { request } from "./client.mjs";
import { BRAND_ARG, resolveBrandSlug } from "./brand.mjs";
import { keepMedia, prepareMedia } from "./media.mjs";

const POST_ID_ARG = { type: "string", description: "Id du post (voir list_social_posts)." };

const FORMAT_ARG = {
  type: "string",
  enum: ["post", "reel", "carousel"],
  description:
    "post : texte + au plus UN visuel (image ou vidéo), Instagram exige un visuel. " +
    "reel : UNE vidéo (MP4/MOV), en réel sur Instagram et Facebook, en vidéo classique ailleurs. " +
    "carousel : 2 à 10 images pour Instagram / Facebook ; pour LinkedIn, un PDF (fourni) dans les " +
    "médias du MÊME post. Chaque réseau reçoit ce qui le concerne.",
};

const WHEN_ARG = {
  type: ["string", "null"],
  description:
    "Date de publication ISO 8601 AVEC fuseau, ex. 2026-10-05T09:30:00+02:00. null = sans date.",
};

const MEDIA_ARG = {
  type: "array",
  maxItems: 12,
  description:
    "Médias dans l'ordre d'affichage. Chaque élément porte exactement une source : file (chemin " +
    "local), url (http/https, téléchargée) ou storage_path (média déjà dans un post de la marque). " +
    "Images JPG/PNG/WebP/GIF 10 Mo, vidéos MP4/MOV 100 Mo (50 Mo sur l'offre gratuite Supabase), " +
    "PDF 100 Mo. La vignette d'un PDF ou d'une vidéo est calculée automatiquement.",
  items: {
    type: "object",
    properties: {
      file: { type: "string", description: "Chemin d'un fichier local." },
      url: { type: "string", description: "URL http(s) d'un fichier à télécharger." },
      storage_path: { type: "string", description: "Chemin d'un média existant (get_social_post)." },
      mime_type: { type: "string", description: "Force le type si l'extension ne le dit pas." },
      thumbnail_file: { type: "string", description: "Vignette PNG/JPEG à utiliser au lieu de celle calculée." },
    },
    additionalProperties: false,
  },
};

const CHANNELS_ARG = {
  type: "array",
  items: { type: "string" },
  description: "Ids des canaux Buffer visés (voir get_social_setup).",
};

/* ------------------------------------------------------------------ */
/* Lectures                                                            */
/* ------------------------------------------------------------------ */

const getSocialSetup = {
  name: "get_social_setup",
  description:
    "État de Buffer pour une marque : clé connectée ou non, canaux disponibles (id, réseau, nom) " +
    "et destinataire des notifications. À appeler avant de créer un post, pour connaître les " +
    "channel_ids. refresh_channels relit les canaux chez Buffer (quota de 250 appels par jour : " +
    "seulement si un canal manque).",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG, refresh_channels: { type: "boolean" } },
    required: ["brand"],
    additionalProperties: false,
  },
  async run({ brand, refresh_channels }) {
    const slug = await resolveBrandSlug(brand);
    let view = await request("/api/social/connection", { brand: slug });
    if (refresh_channels && view.connected) {
      await request("/api/social/channels", { method: "POST", brand: slug });
      view = await request("/api/social/connection", { brand: slug });
    }
    const channels = (view.channels ?? []).map((c) => ({
      id: c.id,
      service: c.service,
      name: c.display_name || c.name,
      usable: c.enabled && !c.disconnected,
      ...(c.enabled ? null : { disabled: true }),
      ...(c.disconnected ? { disconnected: true } : null),
    }));
    let next_step;
    if (!view.ready) next_step = "Migration 0018 absente sur cette instance.";
    else if (!view.connected)
      next_step = "Aucune clé Buffer : la connecter dans /social (Connexion). Le MCP ne manipule pas les clés.";
    else if (!channels.some((c) => c.usable))
      next_step = "Aucun canal utilisable : relancer avec refresh_channels: true, ou en activer un dans /social.";
    return {
      brand: slug,
      connected: Boolean(view.connected),
      account_email: view.accountEmail ?? null,
      notify_email: view.notifyEmail || view.defaultNotifyEmail || null,
      channels_synced_at: view.channelsSyncedAt ?? null,
      channels,
      next_step,
    };
  },
};

const listSocialPosts = {
  name: "list_social_posts",
  description:
    "Posts réseaux sociaux d'une marque (calendrier) : format, statut, date, réseaux visés. " +
    "from / to (ISO) restreignent aux posts datés de la plage ; sans plage, tous les posts, " +
    "brouillons sans date compris.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      from: { type: "string", description: "Début de plage, ISO (ex. 2026-10-01)." },
      to: { type: "string", description: "Fin de plage exclue, ISO." },
    },
    required: ["brand"],
    additionalProperties: false,
  },
  async run({ brand, from, to }) {
    const slug = await resolveBrandSlug(brand);
    const qs = new URLSearchParams();
    if (from) qs.set("from", asIso(from, "from"));
    if (to) qs.set("to", asIso(to, "to"));
    const query = qs.toString();
    const { posts } = await request(`/api/social/posts${query ? `?${query}` : ""}`, { brand: slug });
    return { brand: slug, timezone: LOCAL_TZ, posts: (posts ?? []).map(summarizePost) };
  },
};

const getSocialPost = {
  name: "get_social_post",
  description:
    "Détail d'un post : texte complet, médias (avec leur storage_path, réutilisable), canaux et " +
    "leur statut chez Buffer, et `check` : les erreurs qui bloqueraient sa programmation.",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG, post_id: POST_ID_ARG },
    required: ["brand", "post_id"],
    additionalProperties: false,
  },
  async run({ brand, post_id }) {
    const slug = await resolveBrandSlug(brand);
    return fullResult(slug, await loadPost(slug, post_id));
  },
};

/* ------------------------------------------------------------------ */
/* Écritures                                                           */
/* ------------------------------------------------------------------ */

const createSocialPost = {
  name: "create_social_post",
  description:
    "Crée un post en BROUILLON dans le calendrier de la marque (rien ne part vers Buffer). " +
    "Les médias sont envoyés dans le stockage au passage. La réponse contient `check` : tant " +
    "qu'il reste des erreurs, le post n'est pas programmable. Limites de texte : Instagram 2200, " +
    "LinkedIn 3000, X 280, Threads 500 caractères.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      format: FORMAT_ARG,
      text: { type: "string", description: "Texte du post." },
      title: { type: "string", description: "Libellé interne (calendrier), non publié." },
      scheduled_at: WHEN_ARG,
      channel_ids: CHANNELS_ARG,
      media: MEDIA_ARG,
      first_comment: { type: "string", description: "Premier commentaire (Instagram, Facebook, LinkedIn)." },
      notify: { type: "boolean", description: "Email à la publication (défaut : oui)." },
      notify_email: { type: "string", description: "Destinataire de cet email, sinon celui de la marque." },
    },
    required: ["brand", "format", "text"],
    additionalProperties: false,
  },
  async run(args) {
    const slug = await resolveBrandSlug(args.brand);
    const scheduledAt = parseWhen(args.scheduled_at);
    const channelIds = args.channel_ids ?? [];
    // Avant tout upload : un canal inconnu laisserait sinon des fichiers orphelins.
    await assertChannels(slug, channelIds);

    const known = (args.media ?? []).some((m) => m?.storage_path) ? await brandMedia(slug) : [];
    const { media, uploaded } = await prepareMedia(slug, args.media ?? [], known);

    const { post } = await request("/api/social/posts", {
      method: "POST",
      brand: slug,
      body: {
        format: args.format,
        text: args.text,
        title: args.title ?? null,
        scheduled_at: scheduledAt,
        first_comment: args.first_comment ?? null,
        notify: args.notify !== false,
        notify_email: args.notify_email ?? null,
        channel_ids: channelIds,
        media,
      },
    });
    return { ...fullResult(slug, await loadPost(slug, post.id)), uploaded };
  },
};

const updateSocialPost = {
  name: "update_social_post",
  description:
    "Modifie un post. Seuls les champs fournis changent ; `media` et `channel_ids`, s'ils sont " +
    "fournis, REMPLACENT la liste entière (reprendre les storage_path à garder, voir " +
    "get_social_post). Un post déjà programmé dans Buffer est retiré puis reprogrammé : il faut " +
    "alors reschedule: true. Un post publié n'est plus modifiable.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      post_id: POST_ID_ARG,
      format: FORMAT_ARG,
      text: { type: "string" },
      title: { type: ["string", "null"] },
      scheduled_at: WHEN_ARG,
      channel_ids: CHANNELS_ARG,
      media: MEDIA_ARG,
      first_comment: { type: ["string", "null"] },
      notify: { type: "boolean" },
      notify_email: { type: ["string", "null"] },
      reschedule: {
        type: "boolean",
        description: "Obligatoire (true) si le post est déjà programmé dans Buffer.",
      },
    },
    required: ["brand", "post_id"],
    additionalProperties: false,
  },
  async run(args) {
    const slug = await resolveBrandSlug(args.brand);
    const { post: cur } = await loadPost(slug, args.post_id);
    const has = (k) => Object.prototype.hasOwnProperty.call(args, k);
    // Mêmes refus que l'API, mais AVANT d'envoyer des médias qui resteraient orphelins.
    if (cur.targets.some((t) => t.status === "published"))
      throw new Error("Ce post est déjà publié : il n'est plus modifiable.");
    if (cur.targets.some((t) => t.status === "scheduled") && args.reschedule !== true)
      throw new Error(
        "Ce post est programmé dans Buffer : le modifier le retire puis le reprogramme. " +
          "Repasser l'appel avec reschedule: true, après accord de l'utilisateur."
      );

    const channelIds = args.channel_ids ?? cur.targets.map((t) => t.channel_id);
    if (args.channel_ids) await assertChannels(slug, channelIds);

    let media = keepMedia(cur);
    let uploaded = [];
    if (args.media) {
      const known = args.media.some((m) => m?.storage_path) ? [...cur.media, ...(await brandMedia(slug))] : [];
      ({ media, uploaded } = await prepareMedia(slug, args.media, known));
    }

    const res = await request(`/api/social/posts/${encodeURIComponent(args.post_id)}`, {
      method: "PATCH",
      brand: slug,
      body: {
        format: args.format ?? cur.format,
        text: has("text") ? args.text : cur.text,
        title: has("title") ? args.title : cur.title,
        scheduled_at: has("scheduled_at") ? parseWhen(args.scheduled_at) : cur.scheduled_at,
        first_comment: has("first_comment") ? args.first_comment : cur.first_comment,
        notify: has("notify") ? args.notify : cur.notify,
        notify_email: has("notify_email") ? args.notify_email : cur.notify_email,
        channel_ids: channelIds,
        media,
        reschedule: args.reschedule === true,
      },
    });
    return {
      ...fullResult(slug, await loadPost(slug, args.post_id)),
      uploaded,
      ...(res.results ? { rescheduled: res.results } : null),
    };
  },
};

const scheduleSocialPost = {
  name: "schedule_social_post",
  description:
    "Envoie un post à Buffer. mode buffer_draft : brouillon dans Buffer, RIEN n'est publié " +
    "(test conseillé avant une première programmation). mode schedule : programmé à sa date " +
    "(au moins 2 minutes dans le futur), il partira SEUL et sera visible publiquement. " +
    "La publication immédiate n'est pas disponible depuis le MCP. confirm: true est exigé : " +
    "ne le poser qu'après accord explicite de l'utilisateur sur ce post, ces canaux et cette date.",
  inputSchema: {
    type: "object",
    properties: {
      brand: BRAND_ARG,
      post_id: POST_ID_ARG,
      mode: { type: "string", enum: ["buffer_draft", "schedule"] },
      confirm: { type: "boolean", const: true, description: "Accord explicite de l'utilisateur." },
    },
    required: ["brand", "post_id", "mode", "confirm"],
    additionalProperties: false,
  },
  async run({ brand, post_id, mode, confirm }) {
    // Contrôles redoublés ici : le schéma n'est qu'une indication pour le client.
    if (mode !== "buffer_draft" && mode !== "schedule")
      throw new Error("Mode refusé : seuls buffer_draft et schedule sont disponibles depuis le MCP.");
    if (confirm !== true) throw new Error("confirm: true requis, après accord explicite de l'utilisateur.");
    const slug = await resolveBrandSlug(brand);

    const { post, check } = await loadPost(slug, post_id);
    if (check?.errors?.length)
      throw new Error(`Post non programmable :\n- ${check.errors.join("\n- ")}`);
    if (mode === "schedule" && !post.scheduled_at)
      throw new Error("Ce post n'a pas de date : la fixer avec update_social_post (scheduled_at).");

    const res = await request(`/api/social/posts/${encodeURIComponent(post_id)}/schedule`, {
      method: "POST",
      brand: slug,
      body: { mode, confirm: true },
    });
    return { ...fullResult(slug, await loadPost(slug, post_id)), results: res.results };
  },
};

const unscheduleSocialPost = {
  name: "unschedule_social_post",
  description:
    "Retire un post de Buffer (programmé ou brouillon Buffer) et le ramène en brouillon dans " +
    "l'outil. Ce qui est déjà publié reste en ligne.",
  inputSchema: {
    type: "object",
    properties: { brand: BRAND_ARG, post_id: POST_ID_ARG },
    required: ["brand", "post_id"],
    additionalProperties: false,
  },
  async run({ brand, post_id }) {
    const slug = await resolveBrandSlug(brand);
    await request(`/api/social/posts/${encodeURIComponent(post_id)}/unschedule`, { method: "POST", brand: slug });
    return fullResult(slug, await loadPost(slug, post_id));
  },
};

export const SOCIAL_TOOLS = [
  getSocialSetup,
  listSocialPosts,
  getSocialPost,
  createSocialPost,
  updateSocialPost,
  scheduleSocialPost,
  unscheduleSocialPost,
];

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */

/** Fuseau d'affichage : celui du poste, comme l'éditeur (fuseau du navigateur). */
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localFmt = new Intl.DateTimeFormat("fr-BE", {
  timeZone: LOCAL_TZ,
  dateStyle: "full",
  timeStyle: "short",
});

function local(iso) {
  return iso ? localFmt.format(new Date(iso)) : null;
}

const WITH_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Date de publication : ISO avec fuseau, sinon refus (voir l'en-tête). */
function parseWhen(value) {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim();
  if (!WITH_OFFSET.test(v) || Number.isNaN(Date.parse(v)))
    throw new Error(
      `scheduled_at « ${value} » : date ISO 8601 avec fuseau attendue, ex. 2026-10-05T09:30:00+02:00 ` +
        "(sans fuseau, l'heure serait lue en UTC)."
    );
  return new Date(v).toISOString();
}

/** Borne de plage (from / to) : une date seule est acceptée. */
function asIso(value, label) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`${label} « ${value} » : date ISO attendue.`);
  return new Date(t).toISOString();
}

async function loadPost(brand, id) {
  const res = await request(`/api/social/posts/${encodeURIComponent(id)}`, { brand });
  return { post: res.post, check: res.check ?? null };
}

/** Médias de tous les posts de la marque, pour réutiliser un storage_path. */
async function brandMedia(brand) {
  const { posts } = await request("/api/social/posts", { brand });
  return (posts ?? []).flatMap((p) => p.media ?? []);
}

/** Refuse un canal inconnu ou inutilisable, en listant ceux qui le sont. */
async function assertChannels(brand, ids) {
  if (!ids.length) return;
  const view = await request("/api/social/connection", { brand });
  const usable = (view.channels ?? []).filter((c) => c.enabled && !c.disconnected);
  const bad = ids.filter((id) => !usable.some((c) => c.id === id));
  if (!bad.length) return;
  const list = usable.map((c) => `${c.id} (${c.service}, ${c.display_name || c.name})`).join(", ");
  throw new Error(
    `Canal inconnu ou inutilisable pour ${brand} : ${bad.join(", ")}. ` +
      (list ? `Canaux disponibles : ${list}.` : "Aucun canal disponible : voir get_social_setup.")
  );
}

function targetView(t) {
  return {
    channel_id: t.channel_id,
    service: t.service,
    status: t.status,
    ...(t.published_url ? { published_url: t.published_url } : null),
    ...(t.published_at ? { published_at: t.published_at } : null),
    ...(t.error ? { error: t.error } : null),
  };
}

function summarizePost(p) {
  const text = (p.text ?? "").replace(/\s+/g, " ").trim();
  return {
    id: p.id,
    title: p.title,
    text_preview: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    format: p.format,
    status: p.status,
    scheduled_at: p.scheduled_at,
    scheduled_at_local: local(p.scheduled_at),
    targets: (p.targets ?? []).map(targetView),
    media_count: (p.media ?? []).length,
  };
}

/**
 * Post complet + diagnostic. `schedulable` répond à la seule question que
 * l'agent se pose avant schedule_social_post.
 */
function fullResult(brand, { post: p, check }) {
  const future = p.scheduled_at && Date.parse(p.scheduled_at) > Date.now() + 2 * 60_000;
  // checkPlan signale déjà l'absence de canal (« Choisissez au moins un canal »).
  const blockers = check?.errors ?? [];
  return {
    brand,
    timezone: LOCAL_TZ,
    post: {
      id: p.id,
      title: p.title,
      text: p.text,
      format: p.format,
      status: p.status,
      scheduled_at: p.scheduled_at,
      scheduled_at_local: local(p.scheduled_at),
      first_comment: p.first_comment,
      notify: p.notify,
      notify_email: p.notify_email,
      notified_at: p.notified_at,
      targets: (p.targets ?? []).map(targetView),
      media: (p.media ?? []).map((m) => ({
        storage_path: m.storage_path,
        kind: m.kind,
        filename: m.filename,
        mime_type: m.mime_type,
        url: m.url,
        width: m.width,
        height: m.height,
        ...(m.thumbnail_url ? { thumbnail_url: m.thumbnail_url } : null),
        ...(m.page_count ? { page_count: m.page_count } : null),
      })),
    },
    check: check
      ? {
          errors: blockers,
          warnings: check.warnings ?? [],
          schedulable: blockers.length === 0 && Boolean(future),
          ...(blockers.length === 0 && !future
            ? { note: "Règles respectées, mais la date manque ou est trop proche : seul buffer_draft est possible." }
            : null),
        }
      : { note: "Instance sans diagnostic (GET /api/social/posts/[id] sans check) : déployer la version à jour." },
  };
}
