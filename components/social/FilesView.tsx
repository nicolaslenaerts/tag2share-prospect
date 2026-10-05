"use client";
/**
 * Fichiers du stockage de la marque active (bucket `social-media`), avec les
 * posts qui les utilisent, et leur suppression.
 *
 * Un fichier d'un post encore dans Buffer n'est pas supprimable : Buffer le
 * télécharge au moment de publier (règle appliquée aussi par le serveur,
 * lib/social/files.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, ExternalLink, File, FileText, Film, Lock, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Spinner, cn } from "@/components/ui";
import { formatShort } from "@/lib/social/dates";
import type { DeleteResult, FilesTotals, StoredFile } from "@/lib/social/files";
import { FORMAT_LABEL, POST_STATUS_LABEL } from "@/lib/social/rules";
import { STATUS_COLOR } from "./PostComposer";

type Filter = "all" | "orphan" | "attached" | "locked";

const FILTERS: { value: Filter; label: string; hint: string }[] = [
  { value: "all", label: "Tous", hint: "" },
  { value: "orphan", label: "Orphelins", hint: "Rattachés à aucun post" },
  { value: "attached", label: "Utilisés", hint: "Brouillons ou posts publiés" },
  { value: "locked", label: "Dans Buffer", hint: "Posts programmés : non supprimables" },
];

const KIND_LABEL: Record<StoredFile["kind"], string> = { image: "Image", video: "Vidéo", document: "PDF", other: "Fichier" };

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace(".", ",")} Go`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const weight = (f: StoredFile) => f.size + f.thumbnail_size;

function Preview({ file }: { file: StoredFile }) {
  if (file.preview_url)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={file.preview_url} alt="" loading="lazy" className="h-full w-full object-cover" />
    );
  const Icon = file.kind === "video" ? Film : file.kind === "document" ? FileText : File;
  return <Icon className="h-6 w-6 text-gray-400" />;
}

export function FilesView({
  onOpenPost,
  onChanged,
}: {
  onOpenPost: (postId: string) => void;
  /** Des médias ont été retirés de posts : la liste des posts est à recharger. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ files: StoredFile[]; totals: FilesTotals } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Sélection d'avant un clic sur la corbeille d'une ligne, rendue à l'annulation.
  const savedSelection = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<{ files: StoredFile[]; totals: FilesTotals }>("/api/social/files"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const files = data?.files ?? [];
  const shown = files.filter((f) => filter === "all" || f.state === filter);
  const chosen = files.filter((f) => selected.has(f.path));
  const chosenAttached = chosen.filter((f) => f.state === "attached");
  const count = (state: Filter) => (state === "all" ? files.length : files.filter((f) => f.state === state).length);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const selectShown = () => setSelected(new Set(shown.filter((f) => f.state !== "locked").map((f) => f.path)));

  const askDelete = (paths: string[], fromRow = false) => {
    savedSelection.current = fromRow ? selected : null;
    setSelected(new Set(paths));
    setConfirming(true);
    setError(null);
    setNotice(null);
  };

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DeleteResult>("/api/social/files", {
        method: "DELETE",
        json: { paths: chosen.map((f) => f.path), detach: true },
      });
      if (res.deleted.length) {
        const freed = files.filter((f) => res.deleted.includes(f.path)).reduce((n, f) => n + weight(f), 0);
        setNotice(
          `${plural(res.deleted.length, "fichier supprimé", "fichiers supprimés")} (${formatBytes(freed)} libérés)` +
            (res.detachedFrom.length ? `, retirés de ${plural(res.detachedFrom.length, "post", "posts")}.` : ".")
        );
      }
      if (res.refused.length) setError(res.refused.map((r) => `${r.path.split("/").pop()} : ${r.reason}`).join("\n"));
      if (res.detachedFrom.length) onChanged();
      savedSelection.current = null;
      setSelected(new Set());
      setConfirming(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* En-tête : totaux, filtres, actions groupées */}
      <div className="space-y-3 border-b border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">Fichiers</h2>
          {data && (
            <span className="text-sm text-gray-500">
              {plural(data.totals.count, "fichier", "fichiers")} · {formatBytes(data.totals.bytes)}
              {data.totals.orphans > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-amber-700">{plural(data.totals.orphans, "orphelin", "orphelins")}</span> (
                  {formatBytes(data.totals.orphanBytes)})
                </>
              )}
            </span>
          )}
          <Button variant="ghost" className="ml-auto" onClick={load} disabled={loading || busy}>
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Actualiser
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              title={f.hint}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                filter === f.value ? "bg-brand text-brand-fg" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              {f.label} <span className="opacity-60">{count(f.value)}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {shown.some((f) => f.state !== "locked") && (
              <Button variant="ghost" onClick={selected.size ? () => setSelected(new Set()) : selectShown} disabled={busy}>
                {selected.size ? "Tout désélectionner" : "Tout sélectionner"}
              </Button>
            )}
            <Button variant="danger" onClick={() => askDelete([...selected])} disabled={!selected.size || busy}>
              <Trash2 className="h-4 w-4" /> Supprimer{selected.size ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>

        {confirming && chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
            <p className="min-w-0 flex-1 text-sm text-red-900">
              Supprimer définitivement {plural(chosen.length, "fichier", "fichiers")} ({formatBytes(chosen.reduce((n, f) => n + weight(f), 0))}) ?
              {chosenAttached.length > 0 &&
                ` ${plural(chosenAttached.length, "est utilisé", "sont utilisés")} par des brouillons ou des posts publiés : ${
                  chosenAttached.length > 1 ? "ils en seront retirés" : "il en sera retiré"
                }.`}{" "}
              Cette action est irréversible.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                if (savedSelection.current) setSelected(savedSelection.current);
                savedSelection.current = null;
                setConfirming(false);
              }}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy && <Spinner />} Supprimer
            </Button>
          </div>
        )}
        {error && (
          <p className="flex gap-2 whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {notice && (
          <p className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            <CircleCheck className="h-4 w-4 shrink-0" /> {notice}
          </p>
        )}
      </div>

      {/* Liste */}
      {loading && !data ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Spinner /> Lecture du stockage…
        </p>
      ) : shown.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-500">Aucun fichier dans cette vue.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((f) => {
            const locked = f.state === "locked";
            return (
              <li key={f.path} className={cn("flex items-center gap-3 px-4 py-2.5", selected.has(f.path) && "bg-red-50/40")}>
                <input
                  type="checkbox"
                  checked={selected.has(f.path)}
                  disabled={locked || busy}
                  onChange={() => toggle(f.path)}
                  aria-label={`Sélectionner ${f.name}`}
                  title={locked ? "Utilisé par un post programmé dans Buffer" : undefined}
                />
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                >
                  <Preview file={f} />
                </a>
                <div className="w-64 min-w-0 shrink-0">
                  <div className="truncate text-sm font-medium text-gray-900" title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {KIND_LABEL[f.kind]} · {formatBytes(weight(f))}
                    {f.created_at && <> · {formatShort(f.created_at)}</>}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {f.posts.length === 0 ? (
                    <Badge color="amber">Orphelin</Badge>
                  ) : (
                    f.posts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onOpenPost(p.id)}
                        className="flex max-w-xs items-center gap-1.5 rounded-full border border-gray-200 py-0.5 pl-1 pr-2.5 text-xs text-gray-700 hover:border-brand/50"
                        title={`${FORMAT_LABEL[p.format]}${p.scheduled_at ? ` · ${formatShort(p.scheduled_at)}` : ""}`}
                      >
                        <Badge color={STATUS_COLOR[p.status]}>{POST_STATUS_LABEL[p.status]}</Badge>
                        <span className="truncate">{p.label}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Ouvrir le fichier"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {locked ? (
                    <span
                      className="rounded p-1.5 text-gray-300"
                      title="Utilisé par un post programmé dans Buffer : Buffer le téléchargera au moment de publier. Déprogrammez d'abord le post."
                    >
                      <Lock className="h-4 w-4" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => askDelete([f.path], true)}
                      disabled={busy}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Supprimer ${f.name}`}
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
