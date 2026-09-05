"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";
import { useBrand } from "@/components/BrandProvider";

type Settings = {
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  test_email: string | null;
  updated_at?: string;
};
type Effective = {
  from: string;
  fromEmail: string;
  replyTo: string;
  testEmail?: string;
  dailyCap: number;
  delayMs: number;
  fromSource: "settings" | "env" | "code";
};
type Payload = {
  settings: Settings;
  effective: Effective;
  defaults: Settings;
};

const SOURCE_LABEL: Record<Effective["fromSource"], string> = {
  settings: "saisie dans cette page",
  env: "variable d'environnement",
  code: "défaut du code",
};

/**
 * Édition de l'identité d'expédition de la marque active.
 * Un champ laissé vide efface la valeur enregistrée : on retombe alors sur la
 * variable d'environnement, puis sur le défaut déclaré dans lib/brands/.
 */
export function BrandSettings() {
  const brand = useBrand();
  const [data, setData] = useState<Payload | null>(null);
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function fill(p: Payload) {
    setData(p);
    setFromName(p.settings.from_name ?? "");
    setFromEmail(p.settings.from_email ?? "");
    setReplyTo(p.settings.reply_to ?? "");
    setTestEmail(p.settings.test_email ?? "");
  }

  async function load() {
    setError("");
    try {
      fill(await api<Payload>("/api/brand-settings"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Rechargé au changement de marque : le sélecteur recharge la page, mais on
  // reste correct si un jour il change de marque sans rechargement.
  useEffect(() => {
    load();
  }, [brand.slug]);

  async function save() {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const r = await api<Payload>("/api/brand-settings", {
        method: "PATCH",
        json: {
          from_name: fromName,
          from_email: fromEmail,
          reply_to: replyTo,
          test_email: testEmail,
        },
      });
      fill({ ...r, defaults: data!.defaults });
      setMsg("Identité d'expédition enregistrée.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <Card className="p-5">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Spinner />}
      </Card>
    );
  }

  const eff = data.effective;
  const dirty =
    fromName !== (data.settings.from_name ?? "") ||
    fromEmail !== (data.settings.from_email ?? "") ||
    replyTo !== (data.settings.reply_to ?? "") ||
    testEmail !== (data.settings.test_email ?? "");

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="font-bold">Identité d&apos;expédition</h2>
          <Badge color="blue">{brand.name}</Badge>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Adresse utilisée pour les envois de cette marque. La clé API Resend est
          commune à toutes les marques : seule l&apos;adresse change ici.{" "}
          <b>Le domaine de l&apos;adresse d&apos;envoi doit être vérifié chez Resend</b>,
          sinon les envois échoueront.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">
              Nom affiché de l&apos;expéditeur
            </span>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder={data.defaults.from_name ?? "Prénom de la marque"}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">
              Adresse d&apos;envoi
            </span>
            <Input
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder={data.defaults.from_email ?? "contact@reach.exemple.com"}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">
              Adresse de réponse
            </span>
            <Input
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder={data.defaults.reply_to ?? "contact@exemple.com"}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Où arrivent les réponses des prospects (souvent différente du domaine
              d&apos;envoi).
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">
              Adresse de test
            </span>
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder={data.defaults.test_email ?? "vous@exemple.com"}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Destinataire des emails de test de cette marque.
            </span>
          </label>
        </div>

        <p className="mt-3 text-[11px] text-gray-400">
          Champ laissé vide = on retombe sur la variable d&apos;environnement, puis sur
          le défaut déclaré dans <code>lib/brands/{brand.slug}.ts</code>.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner /> : "Enregistrer"}
          </Button>
          {dirty && <span className="text-xs text-amber-600">Modifications non enregistrées</span>}
          {msg && <span className="text-sm text-brand-700">{msg}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 font-bold">Ce qui s&apos;appliquera à l&apos;envoi</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium text-gray-600">En-tête From</dt>
          <dd className="font-mono text-gray-800">
            {eff.from}{" "}
            <Badge color={eff.fromSource === "settings" ? "green" : "gray"}>
              {SOURCE_LABEL[eff.fromSource]}
            </Badge>
          </dd>
          <dt className="font-medium text-gray-600">Reply-To</dt>
          <dd className="font-mono text-gray-800">{eff.replyTo}</dd>
          <dt className="font-medium text-gray-600">Emails de test</dt>
          <dd className="font-mono text-gray-800">
            {eff.testEmail || <span className="text-red-600">non configurée</span>}
          </dd>
          <dt className="font-medium text-gray-600">Plafond quotidien</dt>
          <dd className="text-gray-800">
            {eff.dailyCap === 0 ? "illimité" : `${eff.dailyCap} emails/jour`} · délai{" "}
            {eff.delayMs} ms
            <span className="ml-1 text-[11px] text-gray-400">
              (déclaré dans le code, propre à cette marque)
            </span>
          </dd>
        </dl>
      </Card>
    </div>
  );
}
