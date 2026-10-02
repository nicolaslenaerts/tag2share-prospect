"use client";
/**
 * Vue liste : posts filtrés par état, à venir dans l'ordre chronologique,
 * passés du plus récent au plus ancien.
 */
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, cn } from "@/components/ui";
import { formatShort } from "@/lib/social/dates";
import { FORMAT_LABEL, POST_STATUS_LABEL, postLabel, serviceLabel } from "@/lib/social/rules";
import type { SocialChannel, SocialPost } from "@/lib/social/types";
import { accountOf, STATUS_COLOR } from "./PostComposer";
import { AccountAvatar, ServiceBadge } from "./SocialPreview";

type Filter = "upcoming" | "drafts" | "published" | "failed" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "upcoming", label: "À venir" },
  { value: "drafts", label: "Brouillons" },
  { value: "published", label: "Publiés" },
  { value: "failed", label: "Échecs" },
  { value: "all", label: "Tous" },
];

function matches(post: SocialPost, filter: Filter): boolean {
  switch (filter) {
    case "upcoming":
      return post.status === "scheduled";
    case "drafts":
      return post.status === "draft";
    case "published":
      return post.status === "published" || post.status === "partial";
    case "failed":
      return post.status === "failed" || post.targets.some((t) => t.status === "failed");
    default:
      return true;
  }
}

function sortFor(filter: Filter) {
  const time = (p: SocialPost) => (p.scheduled_at ? new Date(p.scheduled_at).getTime() : Infinity);
  return filter === "upcoming" || filter === "drafts"
    ? (a: SocialPost, b: SocialPost) => time(a) - time(b)
    : (a: SocialPost, b: SocialPost) => (time(b) === Infinity ? -1 : time(a) === Infinity ? 1 : time(b) - time(a));
}

export function ListView({
  posts,
  channels,
  onOpen,
}: {
  posts: SocialPost[];
  channels: SocialChannel[];
  onOpen: (post: SocialPost) => void;
}) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const list = posts.filter((p) => matches(p, filter)).sort(sortFor(filter));
  const count = (f: Filter) => posts.filter((p) => matches(p, f)).length;
  const channelById = new Map(channels.map((c) => [c.id, c]));

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 p-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
              filter === f.value ? "bg-brand text-brand-fg" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {f.label} <span className="opacity-60">{count(f.value)}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-500">Aucun post dans cette vue.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map((p) => {
            const first = p.media.find((m) => m.kind === "image") ?? p.media[0];
            const thumb = first ? (first.kind === "image" ? first.url : first.thumbnail_url) : null;
            const errors = p.targets.filter((t) => t.status === "failed" && t.error);
            return (
              <li key={p.id}>
                {/* div et non button : la ligne contient des liens vers les publications. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(p)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(p)}
                  className="flex w-full cursor-pointer gap-4 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="w-32 shrink-0 text-sm">
                    <div className="font-semibold text-gray-900 first-letter:uppercase">{p.scheduled_at ? formatShort(p.scheduled_at) : "Sans date"}</div>
                    <div className="mt-1">
                      <Badge color={STATUS_COLOR[p.status]}>{POST_STATUS_LABEL[p.status]}</Badge>
                    </div>
                  </div>
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-gray-900">{postLabel(p)}</span>
                      <Badge>{FORMAT_LABEL[p.format]}</Badge>
                    </div>
                    {p.title && p.text && <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{p.text}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {p.targets.map((t) => {
                        const c = channelById.get(t.channel_id);
                        return (
                          <span key={t.id} className="flex items-center gap-1 text-xs text-gray-600">
                            <span className="relative">
                              {c ? <AccountAvatar account={accountOf(c)} size={18} /> : null}
                              <ServiceBadge service={t.service} className={c ? "absolute -bottom-1 -right-1.5 h-3 min-w-3 text-[6px]" : ""} />
                            </span>
                            <span className="ml-1 max-w-[120px] truncate">{c ? accountOf(c).name : serviceLabel(t.service)}</span>
                            {t.published_url && (
                              <a
                                href={t.published_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-brand hover:underline"
                                aria-label="Voir la publication"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </span>
                        );
                      })}
                    </div>
                    {errors.map((t) => (
                      <p key={t.id} className="mt-1 line-clamp-2 text-xs text-red-600">
                        {serviceLabel(t.service)} : {t.error}
                      </p>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
