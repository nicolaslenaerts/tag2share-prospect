"use client";
/**
 * Aperçus des posts tels qu'ils apparaîtront sur chaque réseau.
 *
 * Fidèles sur ce qui change la lecture : ce que montre le fil avant le
 * « plus » (125 caractères sur Instagram, environ 3 lignes sur LinkedIn),
 * le ratio réel des visuels (Instagram borne entre 4:5 et 1.91:1), la
 * mosaïque Facebook, le lecteur de document LinkedIn page par page.
 * Approximatifs sur le reste (typographie, compteurs).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Ellipsis,
  FileText,
  Globe,
  Heart,
  MessageCircle,
  Play,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { cn } from "@/components/ui";
import { pdfPages } from "@/lib/social/client-media";
import { formatShort } from "@/lib/social/dates";
import { documentTitleFor, mediaForTarget, REEL_SERVICES, SERVICE_STYLE, serviceLabel } from "@/lib/social/rules";
import type { SocialFormat, SocialMedia } from "@/lib/social/types";

export type PreviewMedia = Pick<
  SocialMedia,
  "kind" | "position" | "url" | "thumbnail_url" | "thumbnail_path" | "width" | "height" | "page_count" | "filename"
>;

export type PreviewAccount = {
  service: string;
  name: string;
  avatar: string | null;
};

type PreviewProps = {
  account: PreviewAccount;
  format: SocialFormat;
  text: string;
  firstComment: string | null;
  media: PreviewMedia[];
  scheduledAt: string | null;
  title: string | null;
  documentTitle: string | null;
};

// ─── Briques communes ────────────────────────────────────────────────────────

export function ServiceBadge({ service, className }: { service: string; className?: string }) {
  const style = SERVICE_STYLE[service] ?? { bg: "bg-gray-500", letter: service.slice(0, 2).toUpperCase() };
  return (
    <span
      title={serviceLabel(service)}
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-bold leading-none text-white",
        style.bg,
        className
      )}
    >
      {style.letter}
    </span>
  );
}

export function AccountAvatar({ account, size = 32, square }: { account: PreviewAccount; size?: number; square?: boolean }) {
  const initials = account.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return account.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={account.avatar}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-cover", square ? "rounded-md" : "rounded-full")}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={cn("flex shrink-0 items-center justify-center bg-brand font-bold text-brand-fg", square ? "rounded-md" : "rounded-full")}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

/** Colore hashtags, mentions et liens, comme les réseaux le font. */
function RichText({ text, linkClass }: { text: string; linkClass: string }) {
  const parts = text.split(/((?:https?:\/\/|www\.)\S+|#[\p{L}\p{N}_]+|@[\w.]+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        /^(https?:\/\/|www\.|#|@)/.test(p) ? (
          <span key={i} className={linkClass}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/** Texte tronqué comme dans le fil, avec le lien « plus » du réseau. */
function ExpandableText({
  text,
  limit,
  maxLines,
  moreLabel,
  linkClass,
  prefix,
}: {
  text: string;
  limit: number;
  maxLines?: number;
  moreLabel: string;
  linkClass: string;
  prefix?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const tooManyLines = maxLines !== undefined && lines.length > maxLines;
  const truncated = !open && (text.length > limit || tooManyLines);
  let shown = text;
  if (truncated) {
    shown = tooManyLines ? lines.slice(0, maxLines).join("\n") : text;
    shown = shown.slice(0, limit).trimEnd();
  }
  return (
    <div className="whitespace-pre-wrap break-words">
      {prefix}
      <RichText text={shown} linkClass={linkClass} />
      {truncated && (
        <button type="button" onClick={() => setOpen(true)} className="text-gray-500 hover:underline">
          …{moreLabel}
        </button>
      )}
    </div>
  );
}

function clampRatio(m: PreviewMedia | undefined, min: number, max: number, fallback = 1): number {
  if (!m?.width || !m?.height) return fallback;
  return Math.min(max, Math.max(min, m.width / m.height));
}

function MediaView({ m, className, cover = true }: { m: PreviewMedia; className?: string; cover?: boolean }) {
  if (m.kind === "video")
    return (
      <video
        src={m.url}
        poster={m.thumbnail_url ?? undefined}
        controls
        muted
        playsInline
        preload="metadata"
        className={cn("h-full w-full bg-black", cover ? "object-cover" : "object-contain", className)}
      />
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={m.thumbnail_url && m.kind === "document" ? m.thumbnail_url : m.url} alt="" className={cn("h-full w-full", cover ? "object-cover" : "object-contain", className)} />;
}

/** Carrousel à glisser (flèches + points), ratio fixé par le premier visuel. */
function Carousel({
  items,
  ratio,
  dots = "below",
}: {
  items: PreviewMedia[];
  ratio: number;
  dots?: "below" | "overlay";
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex((i) => Math.min(i, Math.max(items.length - 1, 0))), [items.length]);
  if (items.length === 0) return null;
  const go = (d: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + d)));
  return (
    <div>
      <div className="relative overflow-hidden bg-gray-100" style={{ aspectRatio: String(ratio) }}>
        <div
          className="flex h-full transition-transform duration-300"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {items.map((m, i) => (
            <div key={`${m.url}-${i}`} className="h-full w-full shrink-0">
              <MediaView m={m} />
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <>
            <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              {index + 1}/{items.length}
            </span>
            {index > 0 && (
              <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1 shadow">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {index < items.length - 1 && (
              <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1 shadow">
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
      {items.length > 1 && dots === "below" && (
        <div className="mt-2 flex justify-center gap-1">
          {items.map((_, i) => (
            <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === index ? "bg-[#0095f6]" : "bg-gray-300")} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoMedia({ label }: { label: string }) {
  return (
    <div className="flex aspect-square items-center justify-center bg-gray-100 px-6 text-center text-xs text-gray-400">
      {label}
    </div>
  );
}

const when = (iso: string | null) => (iso ? formatShort(iso) : "Date à définir");

// ─── Instagram ───────────────────────────────────────────────────────────────

function InstagramPreview({ account, format, text, firstComment, media, scheduledAt }: PreviewProps) {
  const isReel = format === "reel";
  const handle = account.name.replace(/\s+/g, "").toLowerCase();
  const caption = (
    <ExpandableText
      text={text}
      limit={125}
      maxLines={2}
      moreLabel=" plus"
      linkClass="text-[#00376b]"
      prefix={<span className="mr-1 font-semibold">{handle}</span>}
    />
  );

  if (isReel) {
    return (
      <div className="relative mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl bg-black text-white" style={{ aspectRatio: "9 / 16" }}>
        {media[0] ? <MediaView m={media[0]} /> : <NoMedia label="Ajoutez une vidéo pour le réel" />}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 text-sm font-semibold">
          <span>Reels</span>
          <Clapperboard className="h-4 w-4" />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 text-[13px]">
          <div className="mb-2 flex items-center gap-2">
            <AccountAvatar account={account} size={26} />
            <span className="font-semibold">{handle}</span>
            <span className="rounded border border-white/70 px-1.5 text-[11px]">Suivre</span>
          </div>
          <div className="line-clamp-2 whitespace-pre-wrap">{text}</div>
        </div>
        <div className="pointer-events-none absolute bottom-24 right-2 flex flex-col items-center gap-4">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
        </div>
      </div>
    );
  }

  const ratio = clampRatio(media[0], 0.8, 1.91);
  return (
    <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-xl border border-gray-200 bg-white text-[14px] text-gray-900">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
          <span className="block rounded-full bg-white p-[1.5px]">
            <AccountAvatar account={account} size={28} />
          </span>
        </span>
        <span className="font-semibold">{handle}</span>
        <Ellipsis className="ml-auto h-5 w-5" />
      </div>
      {media.length ? <Carousel items={media} ratio={ratio} /> : <NoMedia label="Instagram exige un visuel" />}
      <div className="flex items-center gap-4 px-3 pb-1 pt-2.5">
        <Heart className="h-6 w-6" />
        <MessageCircle className="h-6 w-6" />
        <Send className="h-6 w-6" />
        <Bookmark className="ml-auto h-6 w-6" />
      </div>
      <div className="space-y-1 px-3 pb-3">
        {text && caption}
        {firstComment?.trim() && (
          <div className="text-gray-500">
            <span className="mr-1 font-semibold text-gray-900">{handle}</span>
            {firstComment}
          </div>
        )}
        <div className="text-[11px] uppercase tracking-wide text-gray-400">{when(scheduledAt)}</div>
      </div>
    </div>
  );
}

// ─── Facebook ────────────────────────────────────────────────────────────────

/** Mosaïque Facebook : 1 grand visuel, ou une grille de 2 à 5 cases (+N). */
function FacebookGrid({ media }: { media: PreviewMedia[] }) {
  if (media.length === 1)
    return (
      <div className="bg-gray-100" style={{ aspectRatio: String(clampRatio(media[0], 0.8, 1.91)) }}>
        <MediaView m={media[0]} />
      </div>
    );
  const shown = media.slice(0, 5);
  const extra = media.length - shown.length;
  const cell = (m: PreviewMedia, i: number, className: string) => (
    <div key={i} className={cn("relative overflow-hidden bg-gray-100", className)}>
      <MediaView m={m} />
      {i === shown.length - 1 && extra > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">+{extra}</span>
      )}
    </div>
  );
  if (shown.length === 2) return <div className="grid grid-cols-2 gap-0.5">{shown.map((m, i) => cell(m, i, "aspect-square"))}</div>;
  if (shown.length === 3)
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {cell(shown[0], 0, "col-span-2 aspect-[2/1]")}
        {shown.slice(1).map((m, i) => cell(m, i + 1, "aspect-square"))}
      </div>
    );
  if (shown.length === 4) return <div className="grid grid-cols-2 gap-0.5">{shown.map((m, i) => cell(m, i, "aspect-square"))}</div>;
  return (
    <div className="grid grid-cols-6 gap-0.5">
      {shown.slice(0, 2).map((m, i) => cell(m, i, "col-span-3 aspect-square"))}
      {shown.slice(2).map((m, i) => cell(m, i + 2, "col-span-2 aspect-square"))}
    </div>
  );
}

function FacebookPreview({ account, format, text, firstComment, media, scheduledAt }: PreviewProps) {
  const isReel = format === "reel";
  return (
    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-gray-200 bg-white text-[15px] text-[#050505]">
      <div className="flex items-center gap-2 px-3 pt-3">
        <AccountAvatar account={account} size={40} />
        <div className="leading-tight">
          <div className="font-semibold">{account.name}</div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            {isReel ? "Reel · " : ""}
            {when(scheduledAt)} · <Globe className="h-3 w-3" />
          </div>
        </div>
        <Ellipsis className="ml-auto h-5 w-5 text-gray-500" />
      </div>
      {text && (
        <div className="px-3 py-2">
          <ExpandableText text={text} limit={250} maxLines={5} moreLabel=" Voir plus" linkClass="text-[#385898]" />
        </div>
      )}
      {isReel ? (
        <div className="mx-auto bg-black" style={{ aspectRatio: "9 / 16", maxHeight: 520 }}>
          {media[0] ? <MediaView m={media[0]} cover={false} /> : <NoMedia label="Ajoutez une vidéo pour le réel" />}
        </div>
      ) : (
        media.length > 0 && <FacebookGrid media={media} />
      )}
      <div className="mx-3 flex justify-around border-t border-gray-200 py-1.5 text-sm font-medium text-gray-600">
        <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" /> J&apos;aime</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> Commenter</span>
        <span className="flex items-center gap-1.5"><Share2 className="h-4 w-4" /> Partager</span>
      </div>
      {firstComment?.trim() && (
        <div className="flex gap-2 px-3 pb-3">
          <AccountAvatar account={account} size={28} />
          <div className="rounded-2xl bg-gray-100 px-3 py-1.5 text-[13px]">
            <div className="font-semibold">{account.name}</div>
            {firstComment}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

/** Lecteur de document LinkedIn : pages du PDF rendues une à une. */
function LinkedInDocument({ doc, title }: { doc: PreviewMedia; title: string }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setFailed(false);
    setIndex(0);
    pdfPages(doc.url, 30)
      .then((p) => !cancelled && setPages(p))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc.url]);

  const total = doc.page_count ?? pages?.length ?? 1;
  const ratio = doc.width && doc.height ? doc.width / doc.height : 4 / 5;
  const src = pages?.[index] ?? doc.thumbnail_url ?? undefined;
  return (
    <div className="border-y border-gray-200">
      <div className="flex items-center gap-1.5 bg-[#1d2226] px-3 py-1.5 text-xs text-white">
        <FileText className="h-3.5 w-3.5" />
        <span className="truncate font-semibold">{title}</span>
        <span className="text-white/70">· {total} page{total > 1 ? "s" : ""}</span>
      </div>
      <div className="relative bg-gray-100" style={{ aspectRatio: String(ratio) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : null}
        {!pages && !failed && (
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">Chargement des pages…</span>
        )}
        {pages && pages.length > 1 && (
          <>
            {index > 0 && (
              <button type="button" onClick={() => setIndex(index - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {index < pages.length - 1 && (
              <button type="button" onClick={() => setIndex(index + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white">
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
              {index + 1} / {pages.length}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LinkedInPreview({ account, format, text, firstComment, media, scheduledAt, title, documentTitle }: PreviewProps) {
  const doc = media.find((m) => m.kind === "document");
  return (
    <div className="mx-auto w-full max-w-[460px] overflow-hidden rounded-lg border border-gray-200 bg-white text-[14px] text-[rgba(0,0,0,0.9)]">
      <div className="flex items-start gap-2 px-3 pt-3">
        <AccountAvatar account={account} size={48} square />
        <div className="leading-tight">
          <div className="font-semibold">{account.name}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            {when(scheduledAt)} · <Globe className="h-3 w-3" />
          </div>
        </div>
        <Ellipsis className="ml-auto h-5 w-5 text-gray-500" />
      </div>
      {text && (
        <div className="px-3 py-2">
          <ExpandableText text={text} limit={210} maxLines={3} moreLabel="voir plus" linkClass="font-semibold text-[#0a66c2]" />
        </div>
      )}
      {doc ? (
        <LinkedInDocument doc={doc} title={documentTitleFor({ document_title: documentTitle, title }, doc)} />
      ) : format === "carousel" ? (
        <NoMedia label="Ajoutez le PDF du carrousel LinkedIn" />
      ) : media.length === 1 ? (
        <div className="bg-gray-100" style={{ aspectRatio: String(clampRatio(media[0], 1 / 2.4, 2.4)) }}>
          <MediaView m={media[0]} cover={media[0].kind !== "video"} />
        </div>
      ) : null}
      <div className="mx-3 flex justify-around border-t border-gray-200 py-1.5 text-[13px] font-semibold text-gray-600">
        <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" /> J&apos;aime</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" /> Commenter</span>
        <span className="flex items-center gap-1"><Repeat2 className="h-4 w-4" /> Republier</span>
        <span className="flex items-center gap-1"><Send className="h-4 w-4" /> Envoyer</span>
      </div>
      {firstComment?.trim() && (
        <div className="flex gap-2 px-3 pb-3">
          <AccountAvatar account={account} size={32} square />
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-[13px]">
            <div className="font-semibold">{account.name}</div>
            {firstComment}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Autres réseaux ──────────────────────────────────────────────────────────

function GenericPreview({ account, text, media, scheduledAt }: PreviewProps) {
  return (
    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
      <div className="flex items-center gap-2 px-3 pt-3">
        <AccountAvatar account={account} size={36} />
        <div className="leading-tight">
          <div className="font-semibold">{account.name}</div>
          <div className="text-xs text-gray-500">
            {serviceLabel(account.service)} · {when(scheduledAt)}
          </div>
        </div>
      </div>
      {text && <div className="whitespace-pre-wrap break-words px-3 py-2">{text}</div>}
      {media.length > 0 && <Carousel items={media} ratio={clampRatio(media[0], 0.8, 1.91)} dots="overlay" />}
    </div>
  );
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

/**
 * Aperçu d'un post pour un compte. Applique la même sélection de médias que
 * la publication (`mediaForTarget`) : ce qui est montré est ce qui partira.
 */
export function PostPreview(props: Omit<PreviewProps, "media"> & { media: PreviewMedia[] }) {
  const media = useMemo(
    () => mediaForTarget(props.format, props.account.service, props.media),
    [props.format, props.account.service, props.media]
  );
  const p = { ...props, media };
  const reelHint =
    props.format === "reel" && !REEL_SERVICES.has(props.account.service)
      ? `${serviceLabel(props.account.service)} n'a pas de format réel : la vidéo y part en publication classique.`
      : null;
  return (
    <div className="space-y-2">
      {reelHint && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <Play className="h-3.5 w-3.5" /> {reelHint}
        </p>
      )}
      {props.account.service === "instagram" ? (
        <InstagramPreview {...p} />
      ) : props.account.service === "facebook" ? (
        <FacebookPreview {...p} />
      ) : props.account.service === "linkedin" ? (
        <LinkedInPreview {...p} />
      ) : (
        <GenericPreview {...p} />
      )}
    </div>
  );
}
