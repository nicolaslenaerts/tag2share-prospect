/**
 * Client de l'API Buffer (GraphQL, https://api.buffer.com).
 *
 * Repris du provider Buffer d'Uncover Studio, éprouvé en production, et
 * recoupé avec le schéma réel (introspection du 02/10/2026). Authentification
 * par clé personnelle (`Authorization: Bearer <clé>`) : Buffer n'ouvre plus
 * l'enregistrement d'applications OAuth, la clé se génère dans
 * Buffer → Settings → API.
 *
 * Pièges connus, documentés là où ils jouent :
 *   - `createPost` ne vise qu'UN canal : un post multi-réseaux = un appel par canal ;
 *   - `assets` et `needsApproval` sont requis par le schéma, même vides / false ;
 *   - les erreurs de mutation sont une union : on sélectionne l'interface
 *     `MutationError`, sinon une erreur d'un autre membre arrive sans message ;
 *   - ne jamais passer `filter.status` à la query `posts` (renvoie 0 résultat).
 *
 * Plafonds par clé (offre gratuite) : 100 requêtes / 15 min, 250 / jour.
 *
 * ⚠️ Module SERVEUR : manipule la clé en clair.
 */
import { REEL_SERVICES, FIRST_COMMENT_SERVICES } from "./rules";
import type { SocialFormat } from "./types";

const BUFFER_API_URL = "https://api.buffer.com";

export type BufferErrorKind = "auth" | "rate_limit" | "api" | "network";

export class BufferApiError extends Error {
  constructor(
    message: string,
    public kind: BufferErrorKind = "api",
    public retryAfter: number | null = null
  ) {
    super(message);
    this.name = "BufferApiError";
  }
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

async function graphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BUFFER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new BufferApiError(`Buffer injoignable (${(err as Error).message}).`, "network");
  }

  // Le statut HTTP d'abord : Buffer signale une clé refusée par 401 même
  // quand GraphQL renverrait un 200 avec une erreur.
  if (res.status === 401 || res.status === 403)
    throw new BufferApiError("Clé Buffer refusée (révoquée ou invalide).", "auth");
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    throw new BufferApiError(
      `Limite de requêtes Buffer atteinte (100 par 15 min, 250 par jour en offre gratuite).${retryAfter ? ` Réessayez dans ${retryAfter} s.` : ""}`,
      "rate_limit",
      retryAfter
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BufferApiError(`Buffer a répondu ${res.status} : ${text.slice(0, 300)}`);
  }

  const payload = (await res.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    const first = payload.errors[0];
    const code = first.extensions?.code;
    if (code === "UNAUTHENTICATED" || code === "UNAUTHORIZED")
      throw new BufferApiError(`Clé Buffer refusée : ${first.message}`, "auth");
    throw new BufferApiError(`Buffer : ${first.message}`);
  }
  if (!payload.data) throw new BufferApiError("Réponse Buffer sans données.");
  return payload.data;
}

// ─── Compte et canaux ────────────────────────────────────────────────────────

export async function bufferAccount(apiKey: string): Promise<{ id: string; email: string | null }> {
  const data = await graphql<{ account: { id: string; email?: string | null } | null }>(
    apiKey,
    "query Me { account { id email } }"
  );
  if (!data.account?.id) throw new BufferApiError("Buffer a répondu sans compte associé à cette clé.");
  return { id: data.account.id, email: data.account.email ?? null };
}

async function organizationIds(apiKey: string): Promise<string[]> {
  const data = await graphql<{ account: { organizations: Array<{ id: string }> | null } | null }>(
    apiKey,
    "query AccountOrgs { account { organizations { id } } }"
  );
  return (data.account?.organizations ?? []).map((o) => o.id);
}

export type BufferChannel = {
  id: string;
  service: string;
  name: string | null;
  displayName: string | null;
  avatar: string | null;
  organizationId: string;
  isDisconnected: boolean;
};

/**
 * Canaux de toutes les organisations accessibles à la clé. `channels` est une
 * query RACINE paramétrée par organisation, pas un champ de `account`.
 */
export async function bufferChannels(apiKey: string): Promise<BufferChannel[]> {
  const query = `
    query OrgChannels($input: ChannelsInput!) {
      channels(input: $input) { id service name displayName avatar isDisconnected }
    }
  `;
  type Resp = {
    channels: Array<{
      id: string;
      service: string;
      name?: string | null;
      displayName?: string | null;
      avatar?: string | null;
      isDisconnected?: boolean | null;
    }> | null;
  };
  const out: BufferChannel[] = [];
  for (const organizationId of await organizationIds(apiKey)) {
    const data = await graphql<Resp>(apiKey, query, { input: { organizationId } });
    for (const c of data.channels ?? []) {
      out.push({
        id: c.id,
        service: c.service,
        name: c.name ?? null,
        displayName: c.displayName ?? null,
        avatar: c.avatar ?? null,
        organizationId,
        isDisconnected: Boolean(c.isDisconnected),
      });
    }
  }
  return out;
}

// ─── Création d'un post ──────────────────────────────────────────────────────

/** AssetInput Buffer : Buffer n'a pas d'upload, il télécharge chaque URL lui-même. */
export type BufferAsset =
  | { image: { url: string } }
  | { video: { url: string } }
  | { document: { url: string; title: string; thumbnailUrl: string } };

/**
 * `metadata` de createPost pour un canal. Champs requis vérifiés par
 * introspection : Instagram exige `type` ET `shouldShareToFeed`, Facebook
 * exige `type` (PostTypeFacebook), LinkedIn n'a pas de `type`.
 */
function postMetadata(
  service: string,
  format: SocialFormat,
  firstComment: string | null | undefined
): Record<string, unknown> | undefined {
  const isReel = format === "reel" && REEL_SERVICES.has(service);
  const comment = firstComment?.trim() && FIRST_COMMENT_SERVICES.has(service) ? firstComment.trim() : undefined;
  const withComment = comment ? { firstComment: comment } : {};

  if (service === "instagram") {
    // shouldShareToFeed: true = le réel apparaît aussi dans la grille du
    // profil, comme dans l'app Instagram par défaut. Un carrousel est une
    // publication à plusieurs images : type `post` (exemple officiel Buffer).
    return { instagram: { type: isReel ? "reel" : "post", shouldShareToFeed: true, ...withComment } };
  }
  if (service === "facebook") {
    if (!isReel && !comment) return undefined;
    return { facebook: { type: isReel ? "reel" : "post", ...withComment } };
  }
  if (service === "linkedin" && comment) return { linkedin: withComment };
  return undefined;
}

export type CreatePostArgs = {
  channelId: string;
  service: string;
  text: string;
  assets: BufferAsset[];
  format: SocialFormat;
  firstComment?: string | null;
  /** schedule : à `dueAt` ; now : immédiat ; buffer_draft : brouillon Buffer (test). */
  mode: "schedule" | "now" | "buffer_draft";
  dueAt?: string | null;
};

export async function bufferCreatePost(
  apiKey: string,
  args: CreatePostArgs
): Promise<{ id: string; status: string; dueAt: string | null }> {
  const mutation = `
    mutation T2SCreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id status dueAt } }
        ... on MutationError { message }
      }
    }
  `;
  type Resp = {
    createPost: {
      __typename: string;
      post?: { id: string; status: string; dueAt: string | null };
      message?: string;
    };
  };

  if (args.mode === "schedule" && !args.dueAt)
    throw new BufferApiError("Date de publication manquante.");

  const metadata = postMetadata(args.service, args.format, args.firstComment);
  const input: Record<string, unknown> = {
    channelId: args.channelId,
    text: args.text,
    assets: args.assets, // requis par le schéma, liste vide sans média
    needsApproval: false, // requis par le schéma
    schedulingType: "automatic",
    ...(metadata ? { metadata } : {}),
    ...(args.mode === "buffer_draft"
      ? { mode: "addToQueue", saveToDraft: true }
      : args.mode === "schedule"
        ? { mode: "customScheduled", dueAt: args.dueAt }
        : { mode: "shareNow" }),
  };

  const data = await graphql<Resp>(apiKey, mutation, { input });
  const post = data.createPost.post;
  if (!post?.id)
    throw new BufferApiError(
      `${data.createPost.message ?? "Refus sans message"} (${data.createPost.__typename})`
    );
  return post;
}

// ─── Suppression ─────────────────────────────────────────────────────────────

const isNotFound = (msg: string) => /not.?found|does not exist|introuvable/i.test(msg);

/**
 * Supprime un post Buffer. Idempotent : un post déjà supprimé (ou introuvable)
 * compte comme supprimé.
 */
export async function bufferDeletePost(apiKey: string, id: string): Promise<void> {
  const mutation = `
    mutation T2SDeletePost($input: DeletePostInput!) {
      deletePost(input: $input) {
        __typename
        ... on DeletePostSuccess { id }
        ... on MutationError { message }
      }
    }
  `;
  type Resp = { deletePost: { __typename: string; id?: string; message?: string } };
  let data: Resp;
  try {
    data = await graphql<Resp>(apiKey, mutation, { input: { id } });
  } catch (err) {
    if (err instanceof BufferApiError && err.kind === "api" && isNotFound(err.message)) return;
    throw err;
  }
  if (data.deletePost.__typename === "DeletePostSuccess") return;
  const message = data.deletePost.message ?? "sans message";
  if (isNotFound(message)) return;
  throw new BufferApiError(`Suppression refusée par Buffer : ${message}`);
}

// ─── Statut ──────────────────────────────────────────────────────────────────

export type BufferPostState = {
  /** missing = post introuvable côté Buffer (supprimé depuis l'interface Buffer ?). */
  status: "scheduled" | "draft" | "published" | "failed" | "missing";
  sentAt: string | null;
  url: string | null;
  error: string | null;
};

/**
 * Enum PostStatus réel : draft | needs_approval | scheduled | sending | sent |
 * error. `needs_approval` et `sending` restent programmés tant qu'ils ne sont
 * pas partis.
 */
const STATUS_MAP: Record<string, BufferPostState["status"]> = {
  draft: "draft",
  needs_approval: "scheduled",
  scheduled: "scheduled",
  sending: "scheduled",
  sent: "published",
  error: "failed",
};

export async function bufferPostStatus(apiKey: string, id: string): Promise<BufferPostState> {
  const query = `
    query T2SPostStatus($input: PostInput!) {
      post(input: $input) { id status sentAt externalLink error { message } }
    }
  `;
  type Resp = {
    post: {
      id: string;
      status: string;
      sentAt: string | null;
      externalLink: string | null;
      error: { message?: string | null } | null;
    } | null;
  };
  let data: Resp;
  try {
    data = await graphql<Resp>(apiKey, query, { input: { id } });
  } catch (err) {
    if (err instanceof BufferApiError && err.kind === "api" && isNotFound(err.message))
      return { status: "missing", sentAt: null, url: null, error: null };
    throw err;
  }
  const p = data.post;
  if (!p) return { status: "missing", sentAt: null, url: null, error: null };
  return {
    status: STATUS_MAP[p.status] ?? "scheduled",
    sentAt: p.sentAt,
    url: p.externalLink,
    error: p.error?.message ?? null,
  };
}

// ─── File d'attente (import des posts programmés dans Buffer) ────────────────

export type BufferQueueAsset = {
  kind: "image" | "video" | "document";
  mimeType: string;
  url: string;
  /** Vignette calculée par Buffer (page 1 d'un PDF, image d'une vidéo). */
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  /** Document seulement. */
  title: string | null;
  pageCount: number | null;
};

export type BufferQueuePost = {
  id: string;
  dueAt: string;
  createdAt: string | null;
  text: string;
  channelId: string;
  service: string;
  /** metadata.type (post, reel, carousel, story...) ; null si non lu. */
  postType: string | null;
  firstComment: string | null;
  assets: BufferQueueAsset[];
};

/**
 * Lecture riche : type de post (réel ou non), premier commentaire, et
 * métadonnées des médias. Noms de types et de champs relevés par
 * introspection du schéma le 02/10/2026 (`CommonPostMetadata.type`,
 * `DocumentAsset.document`...).
 */
const QUEUE_QUERY = `
  query T2SBufferQueue($after: String, $first: Int, $input: PostsInput!) {
    posts(after: $after, first: $first, input: $input) {
      edges { node {
        id status dueAt createdAt text channelId channelService
        metadata {
          ... on CommonPostMetadata { type }
          ... on InstagramPostMetadata { firstComment }
          ... on FacebookPostMetadata { firstComment }
          ... on LinkedInPostMetadata { firstComment }
        }
        assets {
          type mimeType source thumbnail
          ... on ImageAsset { image { width height } }
          ... on VideoAsset { video { width height } }
          ... on DocumentAsset { document { title numPages } }
        }
      } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

/**
 * Repli : la requête éprouvée en production par Uncover, sans metadata. Si
 * Buffer fait évoluer son schéma, une sélection invalide ferait échouer TOUTE
 * la requête riche : on retombe sur celle-ci plutôt que de ne rien importer.
 */
const QUEUE_QUERY_BASIC = `
  query T2SBufferQueueBasic($after: String, $first: Int, $input: PostsInput!) {
    posts(after: $after, first: $first, input: $input) {
      edges { node { id status dueAt createdAt text channelId channelService assets { mimeType source } } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

type QueueNode = {
  id: string;
  status: string;
  dueAt: string | null;
  createdAt: string | null;
  text: string | null;
  channelId: string | null;
  channelService: string | null;
  metadata?: { type?: string | null; firstComment?: string | null } | null;
  assets: Array<{
    type?: string | null;
    mimeType: string | null;
    source: string | null;
    thumbnail?: string | null;
    image?: { width: number; height: number } | null;
    video?: { width: number; height: number } | null;
    document?: { title: string | null; numPages: number } | null;
  }> | null;
};
type QueueResp = {
  posts: { edges: Array<{ node: QueueNode }> | null; pageInfo: { endCursor: string | null; hasNextPage: boolean } } | null;
};

/** Statuts Buffer d'un post encore à venir (cf. STATUS_MAP). */
const PENDING_STATUSES = new Set(["scheduled", "needs_approval", "sending"]);

function assetKind(type: string | null | undefined, mime: string): BufferQueueAsset["kind"] | null {
  if (type === "image" || type === "video" || type === "document") return type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return null;
}

/**
 * Posts PROGRAMMÉS (pas encore partis) de toutes les organisations de la clé,
 * dont la date prévue tombe dans la plage. Filtre sur `dueAt` et non sur
 * startDate/endDate (qui matchent createdAt OU dueAt) ; le statut est filtré
 * ici, jamais dans la requête (cf. en-tête).
 */
export async function bufferQueue(
  apiKey: string,
  range: { start: string; end: string; limit?: number }
): Promise<BufferQueuePost[]> {
  const orgIds = await organizationIds(apiKey);
  if (orgIds.length === 0)
    throw new BufferApiError("La clé Buffer ne donne accès à aucune organisation : aucun post ne peut être lu.");

  const max = Math.min(Math.max(range.limit ?? 500, 1), 1000);
  const out: BufferQueuePost[] = [];
  let rich = true;

  for (const organizationId of orgIds) {
    let after: string | null = null;
    while (out.length < max) {
      const variables = {
        after,
        first: 50,
        input: { organizationId, filter: { dueAt: { start: range.start, end: range.end } } },
      };
      let data: QueueResp;
      try {
        data = await graphql<QueueResp>(apiKey, rich ? QUEUE_QUERY : QUEUE_QUERY_BASIC, variables);
      } catch (err) {
        if (rich && err instanceof BufferApiError && err.kind === "api") {
          rich = false;
          continue;
        }
        throw err;
      }
      const page = data.posts;
      for (const { node } of page?.edges ?? []) {
        if (!PENDING_STATUSES.has(node.status) || !node.dueAt || !node.channelId) continue;
        out.push({
          id: node.id,
          dueAt: node.dueAt,
          createdAt: node.createdAt,
          text: node.text ?? "",
          channelId: node.channelId,
          service: node.channelService ?? "unknown",
          postType: node.metadata?.type ?? null,
          firstComment: node.metadata?.firstComment?.trim() || null,
          assets: (node.assets ?? []).flatMap((a): BufferQueueAsset[] => {
            const mime = (a.mimeType ?? "").toLowerCase();
            const kind = assetKind(a.type, mime);
            if (!kind || !a.source) return [];
            const size = a.image ?? a.video ?? null;
            return [
              {
                kind,
                mimeType: mime,
                url: a.source,
                thumbnail: a.thumbnail || null,
                width: size?.width ?? null,
                height: size?.height ?? null,
                title: a.document?.title ?? null,
                pageCount: a.document?.numPages ?? null,
              },
            ];
          }),
        });
      }
      if (!page?.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
      after = page.pageInfo.endCursor;
    }
  }
  return out;
}

// ─── Offre souscrite ─────────────────────────────────────────────────────────

export type BufferPlan = "free" | "paid";

export type BufferLimits = {
  channels: number;
  scheduledPosts: number;
  members: number;
  postTemplates: number;
};

/**
 * Plafond de posts programmés de l'offre gratuite. L'API ne donne pas le nom
 * de l'offre : on la reconnaît à ses limites (relevées le 02/10/2026 sur trois
 * comptes gratuits : channels 3, scheduledPosts 10, members 0, postTemplates 1).
 */
export const FREE_SCHEDULED_POSTS = 10;

/**
 * Offre de la clé et limites de son organisation. Plusieurs organisations :
 * la plus restrictive l'emporte (un premier commentaire refusé sur l'une
 * suffirait à faire échouer un post).
 */
export async function bufferPlan(apiKey: string): Promise<{ plan: BufferPlan; limits: BufferLimits }> {
  const data = await graphql<{
    account: { organizations: Array<{ limits: BufferLimits }> | null } | null;
  }>(apiKey, "query T2SPlan { account { organizations { limits { channels scheduledPosts members postTemplates } } } }");
  const all = (data.account?.organizations ?? []).map((o) => o.limits);
  if (all.length === 0) throw new BufferApiError("La clé Buffer ne donne accès à aucune organisation.");
  const limits = all.reduce((min, l) => (l.scheduledPosts < min.scheduledPosts ? l : min));
  return { plan: limits.scheduledPosts <= FREE_SCHEDULED_POSTS ? "free" : "paid", limits };
}
