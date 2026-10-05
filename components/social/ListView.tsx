"use client";
/**
 * Vue liste : posts filtrés par état, à venir dans l'ordre chronologique,
 * passés du plus récent au plus ancien.
 *
 * Les brouillons se suppriment d'ici, un par un (corbeille de la ligne) ou
 * par sélection, sans ouvrir l'éditeur. Même route que l'éditeur : un
 * brouillon créé dans Buffer y est d'abord retiré.
 */
import { useState } from "react";
import { ExternalLink, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Spinner, cn } from "@/components/ui";
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

/**
 * Supprimable depuis la liste, sans passer par l'éditeur. Les autres posts
 * (programmés, publiés, en échec) restent à supprimer depuis leur détail.
 */
function deletableFromList(post: SocialPost): boolean {
  return post.status === "draft";
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

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
  onDeleted,
}: {
  posts: SocialPost[];
  channels: SocialChannel[];
  onOpen: (post: SocialPost) => void;
  onDeleted: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Posts dont la suppression attend confirmation : la ligne cliquée ou la sélection.
  const [toDelete, setToDelete] = useState<SocialPost[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = posts.filter((p) => matches(p, filter)).sort(sortFor(filter));
  const count = (f: Filter) => posts.filter((p) => matches(p, f)).length;
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const deletable = list.filter(deletableFromList);
  // Seule la sélection visible compte : rien de caché ne part avec.
  const chosen = deletable.filter((p) => selected.has(p.id));

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setSelected(new Set());
    setToDelete(null);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const askDelete = (targets: SocialPost[]) => {
    setToDelete(targets);
    setError(null);
  };

  /** Une requête par post, l'une après l'autre : chaque retrait Buffer compte dans le quota. */
  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const p of toDelete) {
      try {
        await api(`/api/social/posts/${p.id}`, { method: "DELETE" });
        onDeleted(p.id);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      } catch (e) {
        failures.push(`${postLabel(p, 40)} : ${(e as Error).message}`);
      }
    }
    if (failures.length) setError(failures.join("\n"));
    setToDelete(null);
    setBusy(false);
  }

  const inBuffer = (toDelete ?? []).filter((p) => p.targets.some((t) => t.status === "buffer_draft")).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 p-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => changeFilter(f.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
              filter === f.value ? "bg-brand text-brand-fg" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {f.label} <span className="opacity-60">{count(f.value)}</span>
          </button>
        ))}
        {deletable.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setSelected(chosen.length ? new Set() : new Set(deletable.map((p) => p.id)))}
              disabled={busy}
            >
              {chosen.length ? "Tout désélectionner" : "Sélectionner les brouillons"}
            </Button>
            <Button variant="danger" onClick={() => askDelete(chosen)} disabled={!chosen.length || busy}>
              <Trash2 className="h-4 w-4" /> Supprimer{chosen.length ? ` (${chosen.length})` : ""}
            </Button>
          </div>
        )}
      </div>

      {(!!toDelete?.length || !!error) && (
        <div className="space-y-2 border-b border-gray-200 p-3">
          {toDelete && toDelete.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
              <p className="min-w-0 flex-1 text-sm text-red-900">
                {toDelete.length === 1
                  ? `Supprimer le brouillon « ${postLabel(toDelete[0], 60)} » ?`
                  : `Supprimer définitivement ${plural(toDelete.length, "brouillon", "brouillons")} ?`}
                {inBuffer > 0 &&
                  ` ${toDelete.length === 1 ? "Il" : inBuffer} ${inBuffer > 1 ? "sont" : "est"} aussi en brouillon dans Buffer : ${
                    inBuffer > 1 ? "ils y seront retirés" : "il y sera retiré"
                  }.`}{" "}
                Cette action est irréversible.
              </p>
              <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busy}>
                Annuler
              </Button>
              <Button variant="danger" onClick={remove} disabled={busy}>
                {busy && <Spinner />} Supprimer
              </Button>
            </div>
          )}
          {error && (
            <p className="flex gap-2 whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-red-500 hover:underline">
                Fermer
              </button>
            </p>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-500">Aucun post dans cette vue.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map((p) => {
            const first = p.media.find((m) => m.kind === "image") ?? p.media[0];
            const thumb = first ? (first.kind === "image" ? first.url : first.thumbnail_url) : null;
            const errors = p.targets.filter((t) => t.status === "failed" && t.error);
            const removable = deletableFromList(p);
            return (
              <li key={p.id}>
                {/* div et non button : la ligne contient des liens et des contrôles. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(p)}
                  // Seulement la ligne elle-même : Espace sur la case à cocher ne doit pas ouvrir l'éditeur.
                  onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && onOpen(p)}
                  className={cn(
                    "flex w-full cursor-pointer gap-4 px-4 py-3 text-left hover:bg-gray-50",
                    selected.has(p.id) && removable && "bg-red-50/40"
                  )}
                >
                  {deletable.length > 0 && (
                    <div className="flex w-4 shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                      {removable && (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          disabled={busy}
                          onChange={() => toggle(p.id)}
                          aria-label={`Sélectionner ${postLabel(p, 40)}`}
                        />
                      )}
                    </div>
                  )}
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
                  {removable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        askDelete([p]);
                      }}
                      disabled={busy}
                      className="self-center rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Supprimer ${postLabel(p, 40)}`}
                      title="Supprimer ce brouillon"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
