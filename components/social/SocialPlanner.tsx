"use client";
/**
 * Planificateur réseaux sociaux de la marque active : calendrier, liste,
 * connexion Buffer, et éditeur de post.
 *
 * À l'ouverture, demande au serveur de rafraîchir les statuts des posts échus
 * (POST /api/social/sync) : sans cron, c'est ce passage qui fait avancer les
 * statuts et partir les emails de notification.
 *
 * « Importer depuis Buffer » récupère les posts programmés directement dans
 * Buffer (lecture seule chez Buffer). Lancé aussi automatiquement à la
 * première connexion d'une clé.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CircleCheck, Download, FolderOpen, List, Plug, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Spinner, cn } from "@/components/ui";
import { useBrand } from "@/components/BrandProvider";
import type { ComposerMedia } from "@/lib/social/client-media";
import { defaultSlot, startOfMonth } from "@/lib/social/dates";
import { planFeatures } from "@/lib/social/rules";
import type { ImportSummary } from "@/lib/social/import";
import type { ConnectionView, SocialPost } from "@/lib/social/types";
import { CalendarView } from "./CalendarView";
import { ConnectionPanel } from "./ConnectionPanel";
import { FilesView } from "./FilesView";
import { ListView } from "./ListView";
import { PostComposer, type ComposerDraft } from "./PostComposer";

type Tab = "calendar" | "list" | "files" | "connection";

const TABS: { value: Tab; label: string; icon: typeof List }[] = [
  { value: "calendar", label: "Calendrier", icon: CalendarDays },
  { value: "list", label: "Liste", icon: List },
  { value: "files", label: "Fichiers", icon: FolderOpen },
  { value: "connection", label: "Connexion", icon: Plug },
];

type Editor = { post: SocialPost | null; draft?: ComposerDraft; key: number };

/** Appels successifs au plus : chaque appel importe ce que son budget de temps permet. */
const MAX_IMPORT_CALLS = 10;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function importMessage(s: ImportSummary, brandName: string): string {
  if (s.found === 0 && s.otherChannels === 0) return "Import Buffer : aucun post programmé dans les 6 prochains mois.";
  const parts: string[] = [];
  if (s.imported)
    parts.push(
      plural(s.imported, "post importé", "posts importés") +
        (s.importedChannels > s.imported ? ` (${s.importedChannels} publications Buffer regroupées)` : "")
    );
  if (s.updated) parts.push(plural(s.updated, "post mis à jour", "posts mis à jour"));
  if (s.known) parts.push(plural(s.known, "déjà présent", "déjà présents"));
  let msg = `Import Buffer : ${parts.join(", ") || "rien de nouveau"}.`;
  if (s.otherChannels)
    msg += ` ${plural(s.otherChannels, "post ignoré", "posts ignorés")} : canaux non utilisés par ${brandName}.`;
  if (s.recent) msg += ` ${plural(s.recent, "post créé", "posts créés")} il y a moins de 5 minutes : repris au prochain import.`;
  if (s.deferred) msg += ` Il en reste ${s.deferred} : relancez l'import.`;
  return msg;
}

export function SocialPlanner() {
  const brand = useBrand();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("calendar");
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);

  const loadPosts = useCallback(async () => {
    const { posts } = await api<{ posts: SocialPost[] }>("/api/social/posts");
    setPosts(posts);
    return posts;
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await api<{ checked: number; errors: string[] }>("/api/social/sync", { method: "POST" });
      if (res.checked > 0) await loadPosts();
      if (res.errors.length) setError(`Suivi Buffer : ${res.errors[0]}`);
    } catch {
      // Le suivi est un bonus à l'affichage : son échec ne doit pas masquer la page.
    } finally {
      setSyncing(false);
    }
  }, [loadPosts]);

  const runImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const calls: ImportSummary[] = [];
      for (let i = 0; i < MAX_IMPORT_CALLS; i++) {
        const s = await api<ImportSummary>("/api/social/import", { method: "POST" });
        calls.push(s);
        if (s.deferred === 0 || s.imported === 0) break;
      }
      // Les appels suivants relisent la même file : ce qui était déjà là avant
      // l'import se compte au premier appel, les créations s'additionnent.
      const total: ImportSummary | null = calls.length
        ? {
            ...calls[0],
            imported: calls.reduce((n, c) => n + c.imported, 0),
            importedChannels: calls.reduce((n, c) => n + c.importedChannels, 0),
            deferred: calls[calls.length - 1].deferred,
            mediaErrors: calls.flatMap((c) => c.mediaErrors),
          }
        : null;
      await loadPosts();
      // L'import a aussi actualisé les canaux.
      setConnection(await api<ConnectionView>("/api/social/connection"));
      if (total) {
        setNotice(importMessage(total, brand.name));
        if (total.mediaErrors.length)
          setError(`Médias non recopiés (les posts restent intacts dans Buffer) :\n${total.mediaErrors.join("\n")}`);
      }
    } catch (e) {
      setError(`Import Buffer : ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }, [brand.name, loadPosts]);

  /** Première connexion d'une clé : on récupère d'office ce qui est déjà programmé. */
  const onConnectionChange = (view: ConnectionView) => {
    const firstConnection = !connection?.connected && view.connected;
    setConnection(view);
    if (firstConnection) runImport();
  };

  useEffect(() => {
    (async () => {
      try {
        const view = await api<ConnectionView>("/api/social/connection");
        setConnection(view);
        if (!view.ready) return;
        if (!view.connected) setTab("connection");
        const loaded = await loadPosts();
        const wanted = params.get("post");
        const target = wanted && loaded.find((p) => p.id === wanted);
        if (target) setEditor({ post: target, key: Date.now() });
        if (view.connected) sync();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // Chargement initial uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usable = (connection?.channels ?? []).filter((c) => c.enabled && !c.disconnected);
  const features = planFeatures(connection?.plan, connection?.limits);

  // File Buffer par canal : posts encore programmés, date future. Même compte
  // que le contrôle serveur avant programmation (queuedPerChannel).
  const queued: Record<string, number> = {};
  const now = Date.now();
  for (const p of posts) {
    if (!p.scheduled_at || Date.parse(p.scheduled_at) <= now) continue;
    for (const t of p.targets) if (t.status === "scheduled") queued[t.channel_id] = (queued[t.channel_id] ?? 0) + 1;
  }

  const openNew = (day?: Date) =>
    setEditor({
      post: null,
      draft: { scheduled_at: defaultSlot(day).toISOString(), channel_ids: usable.map((c) => c.id) },
      key: Date.now(),
    });

  const duplicate = (post: SocialPost) =>
    setEditor({
      post: null,
      draft: {
        title: post.title ? `${post.title} (copie)` : null,
        text: post.text,
        format: post.format,
        first_comment: post.first_comment,
        notify: post.notify,
        notify_email: post.notify_email,
        scheduled_at: defaultSlot().toISOString(),
        channel_ids: post.targets.map((t) => t.channel_id).filter((id) => usable.some((c) => c.id === id)),
        media: post.media as ComposerMedia[],
      },
      key: Date.now(),
    });

  const upsert = (post: SocialPost) =>
    setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev.map((p) => (p.id === post.id ? post : p)) : [...prev, post]));

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  const closeEditor = () => {
    setEditor(null);
    if (params.get("post")) router.replace("/social");
  };

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner /> Chargement…
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition",
                tab === t.value ? "bg-brand text-brand-fg" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        {connection?.ready && (
          <div className="ml-auto flex items-center gap-2">
            {connection.connected && (
              <>
                <Button variant="ghost" onClick={sync} disabled={syncing} title="Interroger Buffer pour les posts échus">
                  {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Statuts
                </Button>
                <Button
                  variant="outline"
                  onClick={runImport}
                  disabled={importing}
                  title="Récupérer les posts programmés directement dans Buffer (rien n'est modifié chez Buffer)"
                >
                  {importing ? <Spinner /> : <Download className="h-4 w-4" />}
                  {importing ? "Import en cours…" : "Importer depuis Buffer"}
                </Button>
              </>
            )}
            <Button onClick={() => openNew()}>
              <Plus className="h-4 w-4" /> Nouveau post
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:underline">
            Fermer
          </button>
        </p>
      )}

      {notice && (
        <p className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-green-700 hover:underline">
            Fermer
          </button>
        </p>
      )}

      {connection?.ready && !connection.connected && tab !== "connection" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Aucun compte Buffer connecté pour {brand.name}.{" "}
          <button type="button" onClick={() => setTab("connection")} className="font-semibold underline">
            Connecter Buffer
          </button>
        </p>
      )}

      {connection && tab === "connection" && <ConnectionPanel connection={connection} onChange={onConnectionChange} />}

      {connection && !connection.ready && tab !== "connection" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Migration à appliquer : exécutez <code>supabase/migrations/0018_social_buffer.sql</code> dans l&apos;éditeur SQL de Supabase.
        </p>
      )}

      {connection?.ready && tab === "calendar" && (
        <CalendarView
          month={month}
          posts={posts}
          onMonthChange={setMonth}
          onOpen={(post) => setEditor({ post, key: Date.now() })}
          onNew={openNew}
        />
      )}

      {connection?.ready && tab === "list" && (
        <ListView
          posts={posts}
          channels={connection.channels}
          onOpen={(post) => setEditor({ post, key: Date.now() })}
          onDeleted={removePost}
        />
      )}

      {connection?.ready && tab === "files" && (
        <FilesView
          onOpenPost={(id) => {
            const post = posts.find((p) => p.id === id);
            if (post) setEditor({ post, key: Date.now() });
          }}
          onChanged={loadPosts}
        />
      )}

      {editor && connection && (
        <PostComposer
          key={editor.key}
          post={editor.post}
          draft={editor.draft}
          channels={connection.channels}
          connected={connection.connected}
          defaultNotifyEmail={connection.notifyEmail || connection.defaultNotifyEmail}
          features={features}
          queued={queued}
          onClose={closeEditor}
          onSaved={upsert}
          onDeleted={removePost}
          onDuplicate={duplicate}
        />
      )}
    </div>
  );
}
