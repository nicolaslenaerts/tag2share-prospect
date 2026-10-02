"use client";
/**
 * Connexion Buffer de la marque active : clé API personnelle, canaux
 * utilisables, adresse de notification, et rappel du cron.
 */
import { useState } from "react";
import { ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { useBrand } from "@/components/BrandProvider";
import { formatShort } from "@/lib/social/dates";
import { serviceLabel } from "@/lib/social/rules";
import type { ConnectionView, SocialChannel } from "@/lib/social/types";
import { accountOf } from "./PostComposer";
import { AccountAvatar, ServiceBadge } from "./SocialPreview";

export function ConnectionPanel({
  connection,
  onChange,
}: {
  connection: ConnectionView;
  onChange: (c: ConnectionView) => void;
}) {
  const brand = useBrand();
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(connection.notifyEmail ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    }
  }

  const connect = () =>
    run("connect", async () => {
      const view = await api<ConnectionView>("/api/social/connection", { method: "PUT", json: { apiKey } });
      setApiKey("");
      setReplacing(false);
      onChange(view);
      setNotice(`Buffer connecté : ${view.channels.length} canal(aux) trouvé(s).`);
    });

  const disconnect = () => {
    if (!window.confirm(`Déconnecter Buffer pour ${brand.name} ? Les posts déjà programmés restent dans Buffer et partiront quand même.`)) return;
    run("disconnect", async () => onChange(await api<ConnectionView>("/api/social/connection", { method: "DELETE" })));
  };

  const refresh = () =>
    run("refresh", async () => {
      const { channels } = await api<{ channels: SocialChannel[] }>("/api/social/channels", { method: "POST" });
      onChange({ ...connection, channels, channelsSyncedAt: new Date().toISOString() });
      setNotice("Canaux actualisés.");
    });

  const toggle = (c: SocialChannel) =>
    run(`toggle-${c.id}`, async () => {
      const { channels } = await api<{ channels: SocialChannel[] }>("/api/social/channels", {
        method: "PATCH",
        json: { id: c.id, enabled: !c.enabled },
      });
      onChange({ ...connection, channels });
    });

  const saveNotify = () =>
    run("notify", async () => {
      onChange(await api<ConnectionView>("/api/social/connection", { method: "PUT", json: { notifyEmail } }));
      setNotice("Adresse de notification enregistrée.");
    });

  if (!connection.ready)
    return (
      <Card className="p-5 text-sm text-gray-700">
        <p className="font-semibold text-gray-900">Migration à appliquer</p>
        <p className="mt-1">
          Exécutez <code className="rounded bg-gray-100 px-1">supabase/migrations/0018_social_buffer.sql</code> dans l&apos;éditeur SQL de
          Supabase, puis rechargez la page.
        </p>
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Compte Buffer de {brand.name}</h2>
          <p className="mt-1 text-sm text-gray-500">
            Chaque marque utilise sa propre clé API Buffer. Elle est chiffrée avant d&apos;être enregistrée et ne repasse jamais par le
            navigateur.
          </p>
        </div>

        {!connection.encryptionReady && (
          <p className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            SOCIAL_ENCRYPTION_KEY manquante côté serveur. Générez-la avec « openssl rand -hex 32 » et ajoutez-la aux variables
            d&apos;environnement.
          </p>
        )}

        {connection.connected && !replacing ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="green">Connecté</Badge>
              <span className="font-medium text-gray-900">{connection.accountEmail ?? "Compte Buffer"}</span>
              {connection.keyHint && <span className="text-gray-400">clé ••••{connection.keyHint}</span>}
            </div>
            {connection.connectedAt && <p className="text-xs text-gray-400">Depuis le {formatShort(connection.connectedAt)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReplacing(true)} disabled={!!busy}>
                Remplacer la clé
              </Button>
              <Button variant="ghost" onClick={disconnect} disabled={!!busy} className="text-red-600">
                {busy === "disconnect" && <Spinner />} Déconnecter
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Collez la clé API personnelle Buffer"
            />
            <p className="text-xs text-gray-500">
              Dans Buffer : Settings → API → Create API key. Disponible sur toutes les offres, gratuite comprise.{" "}
              <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                Ouvrir Buffer <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <div className="flex gap-2">
              <Button onClick={connect} disabled={!apiKey.trim() || !!busy || !connection.encryptionReady}>
                {busy === "connect" && <Spinner />} {connection.connected ? "Enregistrer la nouvelle clé" : "Connecter Buffer"}
              </Button>
              {replacing && (
                <Button variant="ghost" onClick={() => setReplacing(false)}>
                  Annuler
                </Button>
              )}
            </div>
          </div>
        )}

        {connection.connected && (
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900">Notifications de publication</h3>
            <p className="text-xs text-gray-500">
              Un email part à cette adresse quand un post est publié (ou en échec). Vide : adresse de test de la marque
              {connection.defaultNotifyEmail ? ` (${connection.defaultNotifyEmail})` : ""}.
            </p>
            <div className="flex gap-2">
              <Input type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder={connection.defaultNotifyEmail ?? "vous@exemple.com"} />
              <Button variant="outline" onClick={saveNotify} disabled={!!busy || notifyEmail === (connection.notifyEmail ?? "")}>
                {busy === "notify" && <Spinner />} Enregistrer
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              Le suivi automatique passe par le cron <code className="rounded bg-gray-100 px-1">/api/cron/social-status</code> (voir
              README). À défaut, les statuts se mettent à jour à l&apos;ouverture de cette page.
            </p>
          </div>
        )}

        {error && <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      </Card>

      {connection.connected && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">Canaux</h2>
            {connection.channelsSyncedAt && (
              <span className="text-xs text-gray-400">actualisés le {formatShort(connection.channelsSyncedAt)}</span>
            )}
            <Button variant="ghost" className="ml-auto" onClick={refresh} disabled={!!busy}>
              {busy === "refresh" ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Actualiser
            </Button>
          </div>
          {connection.channels.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aucun canal : connectez vos comptes Instagram, Facebook et LinkedIn dans Buffer, puis actualisez.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {connection.channels.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className="relative">
                    <AccountAvatar account={accountOf(c)} size={32} />
                    <ServiceBadge service={c.service} className="absolute -bottom-1 -right-1.5 ring-2 ring-white" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate font-medium text-gray-900">{accountOf(c).name}</div>
                    <div className="text-xs text-gray-500">{serviceLabel(c.service)}</div>
                  </div>
                  {c.disconnected ? (
                    <Badge color="red">Déconnecté dans Buffer</Badge>
                  ) : (
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={c.enabled} onChange={() => toggle(c)} disabled={!!busy} />
                      Utilisé par {brand.name}
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Décochez un canal qu&apos;une même clé Buffer partagerait avec une autre marque : il ne sera plus proposé ici.
          </p>
        </Card>
      )}
    </div>
  );
}
