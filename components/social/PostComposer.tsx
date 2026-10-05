"use client";
/**
 * Éditeur d'un post : canaux, format, texte, visuels, date, notification, et
 * aperçu réseau par réseau.
 *
 * Rien ne part vers Buffer sans confirmation explicite dans le pied de
 * l'éditeur (résumé des canaux et de la date ; « PUBLIER » à taper pour une
 * publication immédiate). Le serveur exige de son côté `confirm: true`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  ImagePlus,
  Trash2,
  TriangleAlert,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Input, Spinner, Textarea, cn } from "@/components/ui";
import { useBrand } from "@/components/BrandProvider";
import { imagesToPdf, prepareMedia, type ComposerMedia } from "@/lib/social/client-media";
import { formatLong, fromLocalInput, toLocalInput } from "@/lib/social/dates";
import {
  checkPlan,
  documentTitleFor,
  FIRST_COMMENT_SERVICES,
  type PlanFeatures,
  FORMAT_LABEL,
  MAX_CAROUSEL_IMAGES,
  POST_STATUS_LABEL,
  queueErrors,
  serviceLabel,
  TARGET_STATUS_LABEL,
  TEXT_LIMITS,
} from "@/lib/social/rules";
import type {
  MediaKind,
  PostInput,
  ScheduleMode,
  SocialChannel,
  SocialFormat,
  SocialPost,
  TargetStatus,
} from "@/lib/social/types";
import { AccountAvatar, PostPreview, ServiceBadge, type PreviewAccount } from "./SocialPreview";

/** Pré-remplissage d'un nouveau post (jour cliqué dans le calendrier, duplication). */
export type ComposerDraft = Partial<Omit<PostInput, "media">> & { media?: ComposerMedia[] };

type Props = {
  post: SocialPost | null;
  draft?: ComposerDraft;
  channels: SocialChannel[];
  connected: boolean;
  defaultNotifyEmail: string | null;
  /** Ce que l'offre Buffer de la marque autorise. */
  features: PlanFeatures;
  /** Posts déjà programmés par canal, tous posts confondus (celui-ci compris). */
  queued: Record<string, number>;
  onClose: () => void;
  onSaved: (post: SocialPost) => void;
  onDeleted: (id: string) => void;
  onDuplicate: (post: SocialPost) => void;
};

type Pending = ScheduleMode | "reschedule" | "unschedule" | "delete";

export const STATUS_COLOR: Record<string, "gray" | "green" | "blue" | "amber" | "red"> = {
  draft: "gray",
  pending: "gray",
  buffer_draft: "gray",
  scheduled: "blue",
  published: "green",
  partial: "amber",
  failed: "red",
};

const FORMATS: { value: SocialFormat; hint: string }[] = [
  { value: "post", hint: "Texte + 1 visuel" },
  { value: "reel", hint: "1 vidéo · Instagram, Facebook" },
  { value: "carousel", hint: "Images IG / FB · PDF LinkedIn" },
];

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function accountOf(channel: SocialChannel): PreviewAccount {
  return {
    service: channel.service,
    name: channel.display_name || channel.name || serviceLabel(channel.service),
    avatar: channel.avatar,
  };
}

export function PostComposer({
  post: initialPost,
  draft,
  channels,
  connected,
  defaultNotifyEmail,
  features,
  queued,
  onClose,
  onSaved,
  onDeleted,
  onDuplicate,
}: Props) {
  const brand = useBrand();
  const [post, setPost] = useState<SocialPost | null>(initialPost);
  const [title, setTitle] = useState(initialPost?.title ?? draft?.title ?? "");
  const [documentTitle, setDocumentTitle] = useState(initialPost?.document_title ?? draft?.document_title ?? "");
  const [text, setText] = useState(initialPost?.text ?? draft?.text ?? "");
  const [format, setFormat] = useState<SocialFormat>(initialPost?.format ?? draft?.format ?? "post");
  const [when, setWhen] = useState(toLocalInput(initialPost?.scheduled_at ?? draft?.scheduled_at ?? null));
  const [firstComment, setFirstComment] = useState(initialPost?.first_comment ?? draft?.first_comment ?? "");
  const [notify, setNotify] = useState(initialPost?.notify ?? draft?.notify ?? true);
  const [notifyEmail, setNotifyEmail] = useState(initialPost?.notify_email ?? draft?.notify_email ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPost?.targets.map((t) => t.channel_id) ?? draft?.channel_ids ?? []
  );
  const [media, setMedia] = useState<ComposerMedia[]>(
    (initialPost?.media as ComposerMedia[] | undefined) ?? draft?.media ?? []
  );
  const [uploading, setUploading] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const visualInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const published = post?.targets.some((t) => t.status === "published") ?? false;
  const inBuffer = post?.targets.some((t) => t.status === "scheduled") ?? false;
  const locked = published;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Canaux proposés : actifs et connectés, plus ceux déjà ciblés par le post
  // (même désactivés depuis), pour ne pas les faire disparaître en silence.
  const selectable = channels.filter((c) => (c.enabled && !c.disconnected) || selected.includes(c.id));
  const selectedChannels = selectable.filter((c) => selected.includes(c.id));
  const services = selectedChannels.map((c) => c.service);

  // File Buffer d'un canal, CE post exclu : le reprogrammer libère d'abord sa place.
  const queuedOthers = (channelId: string) =>
    (queued[channelId] ?? 0) -
    (initialPost?.targets.some((t) => t.channel_id === channelId && t.status === "scheduled") ? 1 : 0);
  const queueLimit = features.scheduledPostsPerChannel;

  const plan = useMemo(() => {
    const check = checkPlan({ format, text, firstComment, services, media, features });
    check.errors.push(
      ...queueErrors(
        selectedChannels.map((c) => ({ label: `${serviceLabel(c.service)} (${accountOf(c).name})`, queued: queuedOthers(c.id) })),
        queueLimit
      )
    );
    return check;
  }, [format, text, firstComment, services.join(","), media, features, queued, selected.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const visuals = media.filter((m) => m.kind !== "document");
  const doc = media.find((m) => m.kind === "document");
  const scheduledIso = fromLocalInput(when);

  function body(): PostInput {
    return {
      title: title.trim() || null,
      document_title: documentTitle.trim() || null,
      text,
      format,
      scheduled_at: scheduledIso,
      first_comment: firstComment.trim() || null,
      notify,
      notify_email: notifyEmail.trim() || null,
      channel_ids: selected,
      media: media.map((m, i) => ({
        kind: m.kind,
        position: i,
        storage_path: m.storage_path,
        mime_type: m.mime_type,
        filename: m.filename,
        size_bytes: m.size_bytes,
        width: m.width,
        height: m.height,
        thumbnail_path: m.thumbnail_path,
        page_count: m.page_count,
      })),
    };
  }

  async function save(reschedule = false): Promise<SocialPost> {
    const res = post
      ? await api<{ post: SocialPost; results?: { ok: boolean; error: string | null; service: string }[] }>(
          `/api/social/posts/${post.id}`,
          { method: "PATCH", json: { ...body(), reschedule } }
        )
      : await api<{ post: SocialPost }>("/api/social/posts", { method: "POST", json: body() });
    setPost(res.post);
    return res.post;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setPending(null);
      setTyped("");
    }
  }

  const saveDraft = () => {
    if (inBuffer) return setPending("reschedule");
    run("save", async () => {
      const saved = await save();
      onSaved(saved);
      setNotice("Brouillon enregistré.");
    });
  };

  const sendToBuffer = (mode: ScheduleMode) =>
    run(mode, async () => {
      // Un post déjà programmé : le PATCH le retire de Buffer et le
      // reprogramme lui-même, avec les nouvelles valeurs.
      if (inBuffer && mode === "schedule") {
        const saved = await save(true);
        onSaved(saved);
        return finish(saved);
      }
      const saved = await save();
      const res = await api<{ post: SocialPost; results: { ok: boolean; error: string | null; service: string }[] }>(
        `/api/social/posts/${saved.id}/schedule`,
        { method: "POST", json: { mode, confirm: true } }
      );
      setPost(res.post);
      onSaved(res.post);
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length)
        throw new Error(failed.map((r) => `${serviceLabel(r.service)} : ${r.error}`).join("\n"));
      finish(res.post);
    });

  function finish(saved: SocialPost) {
    const failed = saved.targets.filter((t) => t.status === "failed");
    if (failed.length) {
      setError(failed.map((t) => `${serviceLabel(t.service)} : ${t.error}`).join("\n"));
      return;
    }
    onClose();
  }

  const reschedule = () =>
    run("reschedule", async () => {
      const saved = await save(true);
      onSaved(saved);
      finish(saved);
    });

  const unschedule = () =>
    run("unschedule", async () => {
      const res = await api<{ post: SocialPost }>(`/api/social/posts/${post!.id}/unschedule`, { method: "POST" });
      setPost(res.post);
      onSaved(res.post);
      setNotice("Retiré de Buffer : le post est repassé en brouillon.");
    });

  const remove = () =>
    run("delete", async () => {
      if (post) await api(`/api/social/posts/${post.id}`, { method: "DELETE" });
      if (post) onDeleted(post.id);
      onClose();
    });

  // ─── Médias ────────────────────────────────────────────────────────────────

  async function addFiles(files: File[], expected?: MediaKind[]) {
    for (const file of files) {
      setUploading((u) => [...u, file.name]);
      try {
        const m = await prepareMedia(file, expected);
        setMedia((prev) => {
          if (m.kind === "document") return [...prev.filter((x) => x.kind !== "document"), m];
          // Publication et réel : un seul visuel, le nouveau remplace l'ancien.
          if (format !== "carousel") return [...prev.filter((x) => x.kind === "document"), m];
          return [...prev, m];
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
  }

  const visualKinds: MediaKind[] = format === "reel" ? ["video"] : format === "carousel" ? ["image"] : ["image", "video"];
  const visualAccept =
    format === "reel" ? "video/mp4,video/quicktime" : format === "carousel" ? "image/*" : "image/*,video/mp4,video/quicktime";

  function move(index: number, delta: number) {
    setMedia((prev) => {
      const list = prev.filter((m) => m.kind !== "document");
      const target = index + delta;
      if (target < 0 || target >= list.length) return prev;
      [list[index], list[target]] = [list[target], list[index]];
      return [...list, ...prev.filter((m) => m.kind === "document")];
    });
  }

  const removeMedia = (m: ComposerMedia) => setMedia((prev) => prev.filter((x) => x !== m));

  const generatePdf = () =>
    run("pdf", async () => {
      const images = visuals.filter((m) => m.kind === "image");
      if (images.length < 2) throw new Error("Ajoutez au moins 2 images pour générer le PDF.");
      const blob = await imagesToPdf(images.map((m) => m.url));
      const name = `${(documentTitle.trim() || title.trim() || "carrousel").replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 60) || "carrousel"}.pdf`;
      await addFiles([new File([blob], name, { type: "application/pdf" })], ["document"]);
    });

  // ─── Aperçu ────────────────────────────────────────────────────────────────

  const previewAccounts: { id: string; account: PreviewAccount }[] = selectedChannels.length
    ? selectedChannels.map((c) => ({ id: c.id, account: accountOf(c) }))
    : ["instagram", "facebook", "linkedin"].map((s) => ({
        id: `demo-${s}`,
        account: { service: s, name: brand.name, avatar: null },
      }));
  const current = previewAccounts.find((p) => p.id === previewId) ?? previewAccounts[0];

  const canSend = connected && !locked && plan.errors.length === 0 && uploading.length === 0 && !busy;
  const statusOf = (id: string): TargetStatus | null => post?.targets.find((t) => t.channel_id === id)?.status ?? null;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/40 p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="m-auto flex h-full max-h-[960px] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-bold text-gray-900">{post ? "Modifier le post" : "Nouveau post"}</h2>
          {post && <Badge color={STATUS_COLOR[post.status]}>{POST_STATUS_LABEL[post.status]}</Badge>}
          <button type="button" onClick={onClose} disabled={!!busy} className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* Formulaire */}
          <div className="min-h-0 space-y-6 overflow-y-auto p-5">
            {locked && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                Ce post est publié : il n&apos;est plus modifiable. Dupliquez-le pour le réutiliser.
              </p>
            )}

            {/* Canaux */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Canaux</h3>
              {selectable.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Aucun canal disponible : connectez le compte Buffer de {brand.name} dans l&apos;onglet Connexion.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectable.map((c) => {
                    const on = selected.includes(c.id);
                    const status = statusOf(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={locked}
                        onClick={() => setSelected((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                        className={cn(
                          "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition",
                          on ? "border-brand bg-brand-50 text-gray-900" : "border-gray-200 bg-white text-gray-500 hover:border-brand/50"
                        )}
                      >
                        <span className="relative">
                          <AccountAvatar account={accountOf(c)} size={26} />
                          <ServiceBadge service={c.service} className="absolute -bottom-1 -right-1.5 ring-2 ring-white" />
                        </span>
                        <span className="max-w-[160px] truncate">{accountOf(c).name}</span>
                        {queueLimit && !locked && (
                          <span
                            title={`Posts programmés sur ce canal (offre Buffer : ${queueLimit} au maximum)`}
                            className={cn("text-[11px]", queuedOthers(c.id) >= queueLimit ? "font-semibold text-red-600" : "text-gray-400")}
                          >
                            {queuedOthers(c.id)}/{queueLimit}
                          </span>
                        )}
                        {status && status !== "pending" && (
                          <Badge color={STATUS_COLOR[status]}>{TARGET_STATUS_LABEL[status]}</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Format */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Format</h3>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    disabled={locked}
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      "rounded-lg border p-2.5 text-left transition",
                      format === f.value ? "border-brand bg-brand text-brand-fg" : "border-gray-200 bg-white hover:border-brand/50"
                    )}
                  >
                    <div className="text-sm font-bold">{FORMAT_LABEL[f.value]}</div>
                    <div className={cn("text-xs", format === f.value ? "opacity-80" : "text-gray-400")}>{f.hint}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* Texte */}
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Texte</h3>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[...new Set(services)].map((s) =>
                    TEXT_LIMITS[s] ? (
                      <span key={s} className={cn(text.length > TEXT_LIMITS[s] ? "font-semibold text-red-600" : "text-gray-400")}>
                        {serviceLabel(s)} {text.length}/{TEXT_LIMITS[s]}
                      </span>
                    ) : null
                  )}
                </div>
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={locked}
                rows={8}
                placeholder="Le texte du post. #hashtags et @mentions compris."
                className="font-sans"
              />
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={locked}
                placeholder="Titre interne (calendrier) - facultatif"
              />
              {services.some((s) => FIRST_COMMENT_SERVICES.has(s)) &&
                (features.firstComment || firstComment.trim() ? (
                  <Textarea
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    disabled={locked}
                    rows={2}
                    placeholder="Premier commentaire (Instagram, Facebook, LinkedIn) - facultatif"
                    className="font-sans"
                  />
                ) : (
                  <p className="text-xs text-gray-400">
                    Premier commentaire : réservé aux offres Buffer payantes (offre gratuite détectée pour {brand.name}).
                  </p>
                ))}
            </section>

            {/* Visuels */}
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {format === "reel" ? "Vidéo du réel" : format === "carousel" ? `Images du carrousel (2 à ${MAX_CAROUSEL_IMAGES})` : "Visuel"}
                </h3>
                {format === "carousel" && <span className="text-xs text-gray-400">Instagram, Facebook</span>}
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!locked) addFiles(Array.from(e.dataTransfer.files), visualKinds);
                }}
                className={cn(
                  "rounded-lg border-2 border-dashed p-3 transition",
                  dragging ? "border-brand bg-brand-50" : "border-gray-200"
                )}
              >
                <div className="flex flex-wrap gap-2">
                  {visuals.map((m, i) => (
                    <div key={m.storage_path} className="group relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                      {m.kind === "video" ? (
                        <video src={m.url} poster={m.thumbnail_url ?? undefined} muted className="h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" className="h-full w-full object-cover" />
                      )}
                      {m.kind === "video" && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">Vidéo</span>}
                      {visuals.length > 1 && <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>}
                      {!locked && (
                        <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-0.5 opacity-0 transition group-hover:opacity-100">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-white disabled:opacity-30">
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => removeMedia(m)} className="p-1 text-white">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === visuals.length - 1} className="p-1 text-white disabled:opacity-30">
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {uploading.map((name) => (
                    <div key={name} className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 text-center text-[10px] text-gray-500">
                      <Spinner />
                      <span className="line-clamp-2 break-all">{name}</span>
                    </div>
                  ))}
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => visualInput.current?.click()}
                      className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white text-xs text-gray-500 hover:border-brand hover:text-brand"
                    >
                      <ImagePlus className="h-5 w-5" />
                      {format === "reel" ? "Vidéo" : format === "carousel" ? "Images" : "Image / vidéo"}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Glissez vos fichiers ici.{" "}
                  {format === "reel" ? "MP4, MOV (100 Mo)." : format === "carousel" ? "JPG, PNG, WebP (10 Mo), dans l'ordre du carrousel." : "JPG, PNG, WebP (10 Mo) ou MP4, MOV (100 Mo)."}
                </p>
                <input
                  ref={visualInput}
                  type="file"
                  accept={visualAccept}
                  multiple={format === "carousel"}
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []), visualKinds);
                    e.target.value = "";
                  }}
                />
              </div>

              {(format === "carousel" || doc) && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <ServiceBadge service="linkedin" />
                    <h4 className="text-sm font-semibold text-gray-900">PDF du carrousel LinkedIn</h4>
                  </div>
                  {doc ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {doc.thumbnail_url ? <img src={doc.thumbnail_url} alt="" className="h-20 w-16 rounded border border-gray-200 object-cover" /> : <FileText className="h-10 w-10 text-gray-400" />}
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium text-gray-900">{doc.filename}</div>
                        <div className="text-xs text-gray-500">
                          {doc.page_count ?? "?"} page{(doc.page_count ?? 0) > 1 ? "s" : ""}
                          {doc.size_bytes ? ` · ${formatSize(doc.size_bytes)}` : ""}
                        </div>
                      </div>
                      {!locked && (
                        <button type="button" onClick={() => removeMedia(doc)} className="ml-auto rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ) : (
                    !locked && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => pdfInput.current?.click()} disabled={!!busy}>
                          <Upload className="h-4 w-4" /> Importer un PDF
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={generatePdf}
                          disabled={!!busy || visuals.filter((m) => m.kind === "image").length < 2}
                          title="Une page par image, dans l'ordre du carrousel"
                        >
                          {busy === "pdf" ? <Spinner /> : <WandSparkles className="h-4 w-4" />} Générer depuis les images
                        </Button>
                      </div>
                    )
                  )}
                  <Input
                    value={documentTitle}
                    onChange={(e) => setDocumentTitle(e.target.value)}
                    disabled={locked}
                    maxLength={200}
                    className="mt-3"
                    placeholder={
                      doc
                        ? `Titre du document sur LinkedIn (par défaut : ${documentTitleFor({ document_title: null, title }, doc)})`
                        : "Titre du document sur LinkedIn - facultatif"
                    }
                  />
                  <input
                    ref={pdfInput}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []), ["document"]);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
            </section>

            {/* Date et notification */}
            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Date de publication</h3>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={locked} />
                {scheduledIso && <p className="mt-1 text-xs text-gray-500 first-letter:uppercase">{formatLong(scheduledIso)}</p>}
              </div>
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <Bell className="h-4 w-4" /> Notification
                </h3>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={locked} />
                  M&apos;avertir par email à la publication
                </label>
                {notify && (
                  <Input
                    className="mt-2"
                    type="email"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    disabled={locked}
                    placeholder={defaultNotifyEmail ? `Par défaut : ${defaultNotifyEmail}` : "Adresse de notification"}
                  />
                )}
              </div>
            </section>

            {/* Statut par canal */}
            {post && post.targets.some((t) => t.status !== "pending") && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Suivi Buffer</h3>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {post.targets.map((t) => {
                    const c = channels.find((x) => x.id === t.channel_id);
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <ServiceBadge service={t.service} />
                        <span className="font-medium text-gray-800">{c ? accountOf(c).name : serviceLabel(t.service)}</span>
                        <Badge color={STATUS_COLOR[t.status]}>{TARGET_STATUS_LABEL[t.status]}</Badge>
                        {t.published_url && (
                          <a href={t.published_url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-brand hover:underline">
                            Voir <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {t.error && <p className="w-full whitespace-pre-wrap text-xs text-red-600">{t.error}</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Contrôles */}
            {!locked && (plan.errors.length > 0 || plan.warnings.length > 0) && (
              <section className="space-y-1 text-sm">
                {plan.errors.map((e) => (
                  <p key={e} className="flex gap-1.5 text-red-700">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {e}
                  </p>
                ))}
                {plan.warnings.map((w) => (
                  <p key={w} className="flex gap-1.5 text-amber-700">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                  </p>
                ))}
              </section>
            )}
          </div>

          {/* Aperçu */}
          <div className="hidden min-h-0 flex-col border-l border-gray-200 bg-gray-50 lg:flex">
            <div className="flex gap-1 overflow-x-auto border-b border-gray-200 px-3 pt-3">
              {previewAccounts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreviewId(p.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-semibold",
                    p.id === current.id ? "border-gray-200 bg-white text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
                  )}
                >
                  <ServiceBadge service={p.account.service} />
                  <span className="max-w-[110px] truncate">{selectedChannels.length ? p.account.name : serviceLabel(p.account.service)}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <PostPreview
                account={current.account}
                format={format}
                text={text}
                firstComment={features.firstComment ? firstComment : null}
                media={media}
                scheduledAt={scheduledIso}
                title={title}
                documentTitle={documentTitle}
              />
              {!selectedChannels.length && (
                <p className="mt-3 text-center text-xs text-gray-400">Aperçu indicatif : choisissez des canaux pour voir leur rendu.</p>
              )}
            </div>
          </div>
        </div>

        {/* Pied : messages, confirmations, actions */}
        <div className="space-y-3 border-t border-gray-200 px-5 py-3">
          {error && <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && (
            <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              <CircleCheck className="h-4 w-4" /> {notice}
            </p>
          )}
          {pending ? (
            <ConfirmBar
              pending={pending}
              channels={selectedChannels}
              scheduledIso={scheduledIso}
              typed={typed}
              setTyped={setTyped}
              busy={!!busy}
              onCancel={() => {
                setPending(null);
                setTyped("");
              }}
              onConfirm={() => {
                if (pending === "reschedule") return reschedule();
                if (pending === "unschedule") return unschedule();
                if (pending === "delete") return remove();
                return sendToBuffer(pending);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {post && (
                <Button type="button" variant="ghost" onClick={() => setPending("delete")} disabled={!!busy} className="text-red-600">
                  <Trash2 className="h-4 w-4" /> Supprimer
                </Button>
              )}
              {post && (
                <Button type="button" variant="ghost" onClick={() => onDuplicate(post)} disabled={!!busy}>
                  <Copy className="h-4 w-4" /> Dupliquer
                </Button>
              )}
              {!locked && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {inBuffer && (
                    <Button type="button" variant="outline" onClick={() => setPending("unschedule")} disabled={!!busy}>
                      Déprogrammer
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={saveDraft} disabled={!!busy || uploading.length > 0}>
                    {busy === "save" && <Spinner />} {inBuffer ? "Enregistrer et reprogrammer" : "Enregistrer le brouillon"}
                  </Button>
                  {!inBuffer && (
                    <>
                      <Button type="button" variant="outline" onClick={() => setPending("buffer_draft")} disabled={!canSend} title="Crée le post en brouillon dans Buffer, sans le publier">
                        Brouillon Buffer
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setPending("now")} disabled={!canSend}>
                        Publier maintenant
                      </Button>
                      <Button type="button" onClick={() => setPending("schedule")} disabled={!canSend || !scheduledIso}>
                        Programmer
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {!connected && !locked && (
            <p className="text-xs text-gray-500">Connectez Buffer (onglet Connexion) pour programmer. Les brouillons restent enregistrables.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Résumé de ce qui va partir, et bouton de confirmation. */
function ConfirmBar({
  pending,
  channels,
  scheduledIso,
  typed,
  setTyped,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  channels: SocialChannel[];
  scheduledIso: string | null;
  typed: string;
  setTyped: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const list = channels.map((c) => `${serviceLabel(c.service)} (${accountOf(c).name})`).join(", ");
  const date = scheduledIso ? formatLong(scheduledIso) : "";
  const message: Record<Pending, string> = {
    schedule: `Programmer sur ${list}, le ${date} ?`,
    now: `Publier MAINTENANT sur ${list} ? La publication est immédiate et visible de tous. Tapez PUBLIER pour confirmer.`,
    buffer_draft: `Créer ce post en brouillon dans Buffer (${list}) ? Rien ne sera publié : vous pourrez le relire dans Buffer.`,
    reschedule: `Ce post est programmé dans Buffer. L'enregistrer le retire de Buffer et le reprogramme avec les nouvelles valeurs (${date}).`,
    unschedule: "Retirer ce post de Buffer ? Il repasse en brouillon et ne sera pas publié.",
    delete: "Supprimer ce post ? Ce qui est encore programmé est retiré de Buffer. Une publication déjà en ligne y reste.",
  };
  const needsTyping = pending === "now";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
      <p className="min-w-0 flex-1 text-sm text-amber-900 first-letter:uppercase">{message[pending]}</p>
      {needsTyping && <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="PUBLIER" className="w-32" autoFocus />}
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
        Annuler
      </Button>
      <Button
        type="button"
        variant={pending === "delete" || pending === "now" ? "danger" : "primary"}
        onClick={onConfirm}
        disabled={busy || (needsTyping && typed !== "PUBLIER")}
      >
        {busy && <Spinner />} Confirmer
      </Button>
    </div>
  );
}
