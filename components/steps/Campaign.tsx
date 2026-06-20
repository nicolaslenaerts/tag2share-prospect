"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Textarea, Badge, Spinner, cn } from "@/components/ui";
import {
  MERGE_FIELDS,
  renderMerge,
  mergeDataFromProspect,
  DEFAULT_TAGLINE,
  buildRecipientEmail,
  slugify,
  requiredProspectFields,
} from "@/lib/email";
import { getProduct, normalizeProductKey, PRODUCT_LIST } from "@/lib/products";

type Segment = { id: string; label?: string; product?: string };
type Campaign = {
  id: string; name: string; subject: string; body_html: string; status: string;
  email_tagline?: string | null;
  product?: string | null; // produit cible (override) ; null = produit du segment
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
  segment_id?: string; segments?: Segment[];
};
type Prospect = {
  id: string; name: string; email?: string; contact_name?: string; city?: string;
  country?: string; category?: string; website?: string; logo_url?: string; status: string;
  segment?: Segment;
  segments?: Segment[];
  emailed?: boolean; emailed_at?: string | null; emailed_campaigns?: string[]; emailed_products?: string[];
  suppressed?: boolean;
};
type Recipient = {
  id: string; status: string; to_email?: string; custom_subject?: string;
  custom_html?: string; sent_at?: string; error?: string; prospect: Prospect;
  suppressed?: boolean; suppression_reason?: string | null;
  emailed?: boolean; emailed_at?: string | null;
  emailed_campaigns?: string[]; emailed_products?: string[];
};

const SUPPRESSION_LABEL: Record<string, string> = {
  unsubscribe: "⛔ désinscrit",
  bounce: "✗ adresse invalide",
  complaint: "⚠ plainte spam",
  manual: "⛔ exclu",
};
function suppressionLabel(reason?: string | null) {
  return SUPPRESSION_LABEL[reason || ""] || "⛔ exclu";
}

export function Campaign() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [current, setCurrent] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  async function loadCampaigns() {
    const r = await api<{ campaigns: Campaign[] }>("/api/campaigns");
    setCampaigns(r.campaigns);
  }
  async function openCampaign(c: Campaign) {
    // Ajout auto des nouveaux prospects éligibles des segments ciblés (idempotent).
    let added = 0;
    try {
      const sync = await api<{ added: number }>(`/api/campaigns/${c.id}/sync`, {
        method: "POST",
      });
      added = sync.added ?? 0;
    } catch {
      /* la synchro est best-effort : on ouvre la campagne même si elle échoue */
    }
    const r = await api<{ campaign: Campaign; recipients: Recipient[] }>(
      `/api/campaigns/${c.id}`
    );
    setCurrent(r.campaign);
    setRecipients(r.recipients);
    if (added > 0)
      setMsg(
        `${added} nouveau${added > 1 ? "x" : ""} prospect${added > 1 ? "s" : ""} ` +
          `du/des segment(s) ajouté${added > 1 ? "s" : ""} automatiquement (en brouillon).`
      );
  }
  useEffect(() => {
    loadCampaigns();
    api<{ prospects: Prospect[] }>("/api/prospects").then((r) => setProspects(r.prospects));
    api<{ segments: Segment[] }>("/api/segments").then((r) => setSegments(r.segments));
  }, []);

  function toggleSegment(id: string) {
    setNewSegmentIds((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function createCampaign() {
    if (newSegmentIds.size === 0) return;
    const labels = segments
      .filter((s) => newSegmentIds.has(s.id))
      .map((s) => s.label)
      .filter(Boolean);
    const name = prompt(
      "Nom de la campagne ?",
      `${labels.join(" + ") || "Prospection"} - ${new Date().toLocaleDateString("fr-BE")}`
    );
    if (!name) return;
    const r = await api<{ campaign: Campaign }>("/api/campaigns", {
      method: "POST",
      json: { name, segment_ids: [...newSegmentIds] },
    });
    setNewSegmentIds(new Set());
    await loadCampaigns();
    openCampaign(r.campaign);
  }

  if (!current) {
    return (
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">4. Campagnes email</h2>
        </div>
        <p className="mb-2 text-xs text-gray-400">
          Une campagne peut viser <b>plusieurs segments</b> : tous leurs prospects seront
          proposés. L'email se rédige ici (au niveau de la campagne) ; le produit mis en avant
          s'adapte automatiquement au segment de chaque prospect.
        </p>
        <div className="mb-4 rounded-lg border border-gray-200 p-3">
          <div className="mb-2 text-sm font-medium text-gray-600">
            Segments ciblés ({newSegmentIds.size})
          </div>
          {segments.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun segment. Validez-en à l'étape 1.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {segments.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 rounded border border-gray-100 px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={newSegmentIds.has(s.id)}
                    onChange={() => toggleSegment(s.id)}
                  />
                  <span className="truncate">{s.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button onClick={createCampaign} disabled={newSegmentIds.size === 0}>
              + Nouvelle campagne
            </Button>
          </div>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune campagne. Créez-en une.</p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
              >
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-semibold">{c.name}</span>{" "}
                  {(c.segments ?? []).map((s) => (
                    <Badge key={s.id} color="blue">{s.label}</Badge>
                  ))}{" "}
                  <Badge>{c.status}</Badge>
                </div>
                <Button variant="outline" onClick={() => openCampaign(c)}>
                  Ouvrir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <CampaignEditor
      campaign={current}
      recipients={recipients}
      prospects={prospects}
      allSegments={segments}
      onBack={() => {
        setCurrent(null);
        loadCampaigns();
      }}
      reload={() => openCampaign(current)}
      msg={msg}
      setMsg={setMsg}
    />
  );
}

function CampaignEditor({
  campaign, recipients, prospects, allSegments, onBack, reload, msg, setMsg,
}: {
  campaign: Campaign; recipients: Recipient[]; prospects: Prospect[];
  allSegments: Segment[];
  onBack: () => void; reload: () => void; msg: string; setMsg: (s: string) => void;
}) {
  const [subject, setSubject] = useState(campaign.subject);
  const [body, setBody] = useState(campaign.body_html);
  const [tagline, setTagline] = useState(campaign.email_tagline ?? DEFAULT_TAGLINE);
  const [product, setProduct] = useState(campaign.product ?? "");
  const [utmSource, setUtmSource] = useState(campaign.utm_source ?? "");
  const [utmMedium, setUtmMedium] = useState(campaign.utm_medium ?? "");
  const [utmCampaign, setUtmCampaign] = useState(campaign.utm_campaign ?? "");
  const [saving, setSaving] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [improving, setImproving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function draft() {
    setDrafting(true);
    try {
      const labels = (campaign.segments ?? []).map((s) => s.label).filter(Boolean);
      const r = await api<{ subject: string; body: string }>(
        "/api/campaigns/draft-email",
        { method: "POST", json: { labels, instruction: instruction || undefined } }
      );
      setSubject(r.subject);
      setBody(r.body);
      setMsg("Email rédigé par l'IA. Vérifiez l'aperçu puis enregistrez le template.");
    } catch (e) {
      setMsg("Erreur IA : " + (e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function improve() {
    if (!instruction.trim()) return;
    setImproving(true);
    try {
      const r = await api<{ subject: string; body: string }>(
        "/api/campaigns/improve-email",
        { method: "POST", json: { subject, body, instruction } }
      );
      setSubject(r.subject);
      setBody(r.body);
      setMsg("Email amélioré par l'IA. Vérifiez l'aperçu puis enregistrez le template.");
    } catch (e) {
      setMsg("Erreur IA : " + (e as Error).message);
    } finally {
      setImproving(false);
    }
  }

  const sample =
    recipients[0]?.prospect ||
    prospects[0] || { name: "Le Petit Café", city: "Bruxelles", contact_name: "Marie Dupont" };
  // Aperçu : produit cible de la campagne s'il est défini, sinon produit du segment de l'exemple.
  const data = mergeDataFromProspect(
    sample as any,
    undefined,
    product || (sample as any).segment?.product
  );

  async function saveTemplate() {
    setSaving(true);
    await api(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      json: {
        subject,
        body_html: body,
        email_tagline: tagline,
        product: product || null, // "" → null = produit du segment
        utm_source: utmSource.trim() || null, // "" → null = défaut "email"
        utm_medium: utmMedium.trim() || null, // "" → null = défaut "prospection"
        utm_campaign: utmCampaign.trim() || null, // "" → null = slug du nom
      },
    });
    setSaving(false);
    setMsg("Template enregistré.");
    reload();
  }

  async function deleteCampaign() {
    const sent = recipients.filter((r) => r.status === "sent").length;
    const note = sent
      ? `\n\n${sent} prospect(s) ont déjà été contactés : leur historique d'envoi est conservé (journal des emails) même après suppression.`
      : "";
    if (
      !confirm(
        `Supprimer définitivement la campagne « ${campaign.name} » ?${note}`
      )
    )
      return;
    await api(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
    onBack();
  }

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + " " + token);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setBody((b) => b.slice(0, start) + token + b.slice(end));
  }

  // Prospects proposés : rattachés à AU MOINS UN segment de la campagne,
  // et disposant de TOUTES les infos utilisées par l'email (variables {{...}}
  // du template, hors variables produit qui viennent du segment).
  const segIds = (campaign.segments ?? []).map((s) => s.id);
  const reqFields = requiredProspectFields(subject, body);
  const inTargetSegments = (p: Prospect) =>
    segIds.length === 0 || (p.segments ?? []).some((s) => segIds.includes(s.id));
  const hasAllFields = (p: Prospect) =>
    reqFields.every((f) => {
      const v = (p as any)[f];
      return v != null && String(v).trim() !== "";
    });
  const base = prospects.filter(
    (p) =>
      p.email &&
      !p.suppressed && // jamais les désinscrits / bounces / plaintes
      !recipients.some((r) => r.prospect.id === p.id) &&
      inTargetSegments(p)
  );
  const eligible = base.filter(hasAllFields);
  const incompleteCount = base.length - eligible.length;

  async function addRecipients(ids: string[]) {
    if (!ids.length) return;
    await api(`/api/campaigns/${campaign.id}/recipients`, {
      method: "POST",
      json: { prospectIds: ids },
    });
    reload();
  }

  async function addSegment(segmentId: string) {
    if (!segmentId) return;
    await api(`/api/campaigns/${campaign.id}/segments`, {
      method: "POST",
      json: { segmentId },
    });
    reload();
  }
  async function removeSegment(segmentId: string) {
    await api(`/api/campaigns/${campaign.id}/segments`, {
      method: "DELETE",
      json: { segmentId },
    });
    reload();
  }

  const campaignSegments = campaign.segments ?? [];
  const addableSegments = allSegments.filter(
    (s) => !campaignSegments.some((cs) => cs.id === s.id)
  );

  // Produits proposés pour le test = ceux des segments de la campagne (sinon tous).
  const productKeys = Array.from(
    new Set(campaignSegments.map((s) => normalizeProductKey(s.product)))
  );
  const testProducts =
    productKeys.length > 0
      ? productKeys.map((k) => getProduct(k))
      : PRODUCT_LIST;

  // Envoyables : approuvés et jamais contactés (le serveur re-vérifie de toute façon).
  const approved = recipients.filter(
    (r) => r.status === "approved" && !isAlreadyContacted(r)
  );

  async function sendAll() {
    if (approved.length === 0) return;
    const typed = prompt(
      `⚠️ Envoi RÉEL à ${approved.length} prospect(s).\nTapez ENVOYER pour confirmer.`
    );
    if (typed !== "ENVOYER") {
      setMsg("Envoi annulé.");
      return;
    }
    const r = await api<{ results: any[]; sent: number; capped: boolean }>(
      `/api/campaigns/${campaign.id}/send`,
      {
        method: "POST",
        json: { recipientIds: approved.map((x) => x.id), confirm: true },
      }
    );
    const skipped = r.results.filter((x) => x.skipped || x.error).length;
    let m = `${r.sent} email(s) envoyé(s).`;
    if (skipped) m += ` ${skipped} ignoré(s) (désinscrits, invalides ou non envoyés).`;
    if (r.capped) m += " Plafond quotidien atteint : relancez demain pour le reste.";
    setMsg(m);
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Campagnes
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{campaign.name}</h2>
          {(campaign.segments ?? []).map((s) => (
            <Badge key={s.id} color="blue">{s.label}</Badge>
          ))}
        </div>
        <Badge color="blue">
          {recipients.filter((r) => r.status !== "excluded").length} destinataires
        </Badge>
      </div>

      {msg && (
        <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>
      )}

      <Card className="p-5">
        <h3 className="mb-2 font-bold">Segments ciblés</h3>
        <div className="flex flex-wrap items-center gap-2">
          {campaignSegments.length === 0 ? (
            <span className="text-sm text-gray-400">Aucun segment.</span>
          ) : (
            campaignSegments.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
              >
                {s.label}
                <button
                  onClick={() => removeSegment(s.id)}
                  className="ml-0.5 rounded-full px-1 text-blue-500 hover:bg-blue-200"
                  title="Retirer ce segment"
                >
                  ✕
                </button>
              </span>
            ))
          )}
          {addableSegments.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && addSegment(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">+ Ajouter un segment…</option>
              {addableSegments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Les prospects de tous ces segments deviennent éligibles. Le produit mis en avant
          s'adapte au segment d'origine de chaque prospect.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-1 font-bold">Email de la campagne</h3>
          <p className="mb-3 text-xs text-gray-400">
            L'email envoyé à tous les destinataires (sauf adaptation individuelle). Les
            variables {"{{product_*}}"} suivent le produit cible ci-dessous.
          </p>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Produit cible
          </label>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="mb-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="">Auto (produit du segment de chaque prospect)</option>
            {PRODUCT_LIST.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.price})
              </option>
            ))}
          </select>
          <p className="mb-3 text-[11px] text-gray-400">
            Choisissez un produit pour l'imposer à <b>toute la campagne</b>, ou laissez sur
            « Auto » pour que chaque prospect voie le produit de son segment. Pensez à
            enregistrer le template.
          </p>
          <label className="mb-1 block text-xs font-medium text-gray-600">Sujet</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="mb-1 mt-3 block text-xs font-medium text-gray-600">
            Accroche sous le logo
          </label>
          <Input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Laisser vide pour masquer le bandeau"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Bandeau bleu affiché sous le logo dans l'email. Vide = pas de bandeau.
          </p>

          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Paramètres UTM (liens tag2share.com)
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                placeholder="source (défaut : email)"
              />
              <Input
                value={utmMedium}
                onChange={(e) => setUtmMedium(e.target.value)}
                placeholder="medium (défaut : prospection)"
              />
              <Input
                value={utmCampaign}
                onChange={(e) => setUtmCampaign(e.target.value)}
                placeholder={`campaign (défaut : ${slugify(campaign.name)})`}
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              Ajoutés automatiquement à chaque lien tag2share.com de l'email
              (<code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code> ;
              <code>utm_content</code> = produit mis en avant). Laisser vide pour les valeurs
              par défaut.
            </p>
          </div>

          <label className="mb-1 mt-3 block text-xs font-medium text-gray-600">
            Corps (HTML, variables {"{{...}}"})
          </label>
          <div className="mb-2 flex flex-wrap gap-1">
            {MERGE_FIELDS.map((f) => (
              <button
                key={f.token}
                onClick={() => insertToken(f.token)}
                className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs hover:bg-gray-100"
                title={f.label}
              >
                {f.token}
              </button>
            ))}
          </div>
          <Textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
          />

          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Rédiger / améliorer avec l'IA
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !improving && instruction.trim()) improve();
                }}
                placeholder="ex : plus court et chaleureux, ajoute une accroche sur les avis Google…"
                className="min-w-[12rem] flex-1"
              />
              <Button
                variant="outline"
                onClick={improve}
                disabled={improving || drafting || !instruction.trim()}
                title="Retravaille l'email actuel en gardant variables, liens et structure"
              >
                {improving ? <Spinner /> : "Améliorer"}
              </Button>
              <Button
                variant="ghost"
                onClick={draft}
                disabled={drafting || improving}
                title="Rédige un nouvel email à partir des segments ciblés (l'instruction sert de consigne)"
              >
                {drafting ? <Spinner /> : "Rédiger (IA)"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              <b>Améliorer</b> retravaille l'email actuel (garde vos variables, liens et
              boutons). <b>Rédiger</b> en génère un nouveau à partir des segments ciblés. Le
              résultat remplace le sujet/corps : vérifiez l'aperçu puis enregistrez.
            </p>
          </div>

          <div className="mt-3">
            <Button onClick={saveTemplate} disabled={saving}>
              {saving ? <Spinner /> : "Enregistrer le template"}
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-2 font-bold">Aperçu (exemple : {sample.name})</h3>
          <div className="mb-2 rounded bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-400">Sujet : </span>
            {renderMerge(subject, data)}
          </div>
          {tagline.trim() && (
            <div
              className="rounded-t border border-gray-100 px-3 py-2 text-center text-xs font-semibold text-white"
              style={{ background: "rgb(20,74,102)" }}
            >
              {tagline}
            </div>
          )}
          <div
            className={cn(
              "prose prose-sm max-w-none border border-gray-100 p-4",
              tagline.trim() ? "rounded-b border-t-0" : "rounded"
            )}
            dangerouslySetInnerHTML={{ __html: renderMerge(body, data) }}
          />
        </Card>
      </div>

      <AddRecipients
        eligible={eligible}
        segmentIds={segIds}
        incompleteCount={incompleteCount}
        requiredFields={reqFields}
        onAdd={addRecipients}
      />

      <RecipientList
        campaign={campaign}
        recipients={recipients}
        reload={reload}
        setMsg={setMsg}
      />

      <TestSend
        campaignId={campaign.id}
        reqFields={reqFields}
        products={testProducts.map((p) => ({ key: p.key, name: p.name }))}
        setMsg={setMsg}
      />

      <Card className="flex items-center justify-between p-5">
        <div>
          <h3 className="font-bold">Envoi final</h3>
          <p className="text-sm text-gray-500">
            Seuls les destinataires <b>approuvés</b> ({approved.length}) seront envoyés.
            Confirmation explicite requise.
          </p>
        </div>
        <Button variant="danger" onClick={sendAll} disabled={approved.length === 0}>
          Envoyer aux {approved.length} approuvés
        </Button>
      </Card>

      <Card className="flex items-center justify-between p-5">
        <div>
          <h3 className="font-bold">Supprimer la campagne</h3>
          <p className="text-sm text-gray-500">
            Retire la campagne et ses destinataires. L'historique des prospects déjà
            contactés (journal des emails) est <b>conservé</b>.
          </p>
        </div>
        <Button variant="danger" onClick={deleteCampaign}>
          Supprimer
        </Button>
      </Card>
    </div>
  );
}

function AddRecipients({
  eligible, segmentIds, incompleteCount, requiredFields: reqFields, onAdd,
}: {
  eligible: Prospect[];
  segmentIds: string[];
  incompleteCount: number;
  requiredFields: string[];
  onAdd: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (eligible.length === 0 && incompleteCount === 0) return null;
  const allSelected = eligible.length > 0 && sel.size === eligible.length;
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(eligible.map((p) => p.id)));
  }
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">Ajouter des destinataires (avec email)</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={toggleAll} disabled={eligible.length === 0}>
            {allSelected ? "Tout désélectionner" : `Tout sélectionner (${eligible.length})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onAdd([...sel]);
              setSel(new Set());
            }}
            disabled={sel.size === 0}
          >
            Ajouter ({sel.size})
          </Button>
        </div>
      </div>
      <p className="mb-1 text-xs text-gray-400">
        <span className="text-amber-600">✉ déjà contacté</span> = un mail lui a déjà été
        envoyé (toutes campagnes) · <span className="text-amber-600">autre segment</span> = le
        prospect appartient aussi à un autre segment.
      </p>
      {incompleteCount > 0 && (
        <p className="mb-2 text-xs text-gray-400">
          {incompleteCount} prospect{incompleteCount > 1 ? "s" : ""} du segment masqué
          {incompleteCount > 1 ? "s" : ""} : informations manquantes pour l'email
          {reqFields.length ? ` (requis : ${reqFields.join(", ")})` : ""}.
        </p>
      )}
      <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {eligible.map((p) => {
          const others = (p.segments ?? []).filter((s) => !segmentIds.includes(s.id));
          return (
            <label
              key={p.id}
              className="flex items-center gap-2 rounded border border-gray-100 px-2 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={sel.has(p.id)}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                    return n;
                  })
                }
              />
              <span className="min-w-0 flex-1 truncate">
                {p.name} <span className="text-gray-400">· {p.email}</span>
              </span>
              {p.emailed && (
                <span
                  title={
                    "Déjà contacté" +
                    (p.emailed_at
                      ? " le " + new Date(p.emailed_at).toLocaleDateString("fr-BE")
                      : "") +
                    (p.emailed_campaigns?.length ? " · " + p.emailed_campaigns.join(", ") : "") +
                    (p.emailed_products?.length ? " · produit : " + p.emailed_products.join(", ") : "")
                  }
                >
                  <Badge color="amber">✉ déjà contacté</Badge>
                </span>
              )}
              {others.length > 0 && (
                <span title={"Aussi dans : " + others.map((s) => s.label).join(", ")}>
                  <Badge color="amber">+{others.length} segment{others.length > 1 ? "s" : ""}</Badge>
                </span>
              )}
            </label>
          );
        })}
      </div>
    </Card>
  );
}

// Valeurs d'exemple par défaut pour le test.
const SAMPLE: Record<string, string> = {
  name: "Le Petit Café",
  contact_name: "Marie Dupont",
  city: "Bruxelles",
  country: "Belgique",
  category: "Café",
  address: "Rue de la Loi 1",
  phone: "+32 2 000 00 00",
  website: "https://exemple.com",
  email: "client@exemple.com",
  logo_url: "",
};
const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  MERGE_FIELDS.map((f) => [f.token.replace(/[{}]/g, "").trim(), f.label])
);

/** Envoi d'un email de test au niveau campagne, avec données de fusion saisies. */
function TestSend({
  campaignId, reqFields, products, setMsg,
}: {
  campaignId: string;
  reqFields: string[];
  products: { key: string; name: string }[];
  setMsg: (s: string) => void;
}) {
  const [testEmail, setTestEmail] = useState("");
  const [product, setProduct] = useState(products[0]?.key || "keyring");
  const [sending, setSending] = useState(false);
  const [data, setData] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of reqFields) init[f] = SAMPLE[f] ?? "";
    return init;
  });

  // Garde un champ pour chaque variable requise du template.
  const fields = reqFields.length ? reqFields : ["name", "contact_name", "city"];

  async function send() {
    setSending(true);
    try {
      const res = await api<{ to: string }>(`/api/campaigns/${campaignId}/test`, {
        method: "POST",
        json: { testEmail: testEmail || undefined, data, product },
      });
      setMsg(`Email de test envoyé à ${res.to}.`);
    } catch (e) {
      setMsg("Erreur test : " + (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="mb-1 font-bold">Envoyer un email de test</h3>
      <p className="mb-3 text-xs text-gray-400">
        Vérifiez le rendu avant l'envoi de masse : saisissez une adresse et les données de
        fusion à simuler. L'email part uniquement vers cette adresse, jamais vers un prospect.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium text-gray-600">
          Adresse de test
          <Input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="vous@exemple.com (défaut : TEST_EMAIL)"
            className="mt-1"
          />
        </label>
        {products.length > 1 && (
          <label className="text-xs font-medium text-gray-600">
            Produit à simuler
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {products.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.map((f) => (
          <label key={f} className="text-xs font-medium text-gray-600">
            {FIELD_LABELS[f] || f} <span className="text-gray-400">({`{{${f}}}`})</span>
            <Input
              value={data[f] ?? ""}
              onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))}
              className="mt-1"
            />
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Button variant="outline" onClick={send} disabled={sending}>
          {sending ? <Spinner /> : "Envoyer le test"}
        </Button>
      </div>
    </Card>
  );
}

// Destinataire déjà contacté : soit marqué par l'envoi (status), soit repéré via
// le journal des envois (emailed, toutes campagnes). On exclut les états terminaux
// de CETTE campagne (envoyé/échoué) qui restent dans leurs propres groupes.
function isAlreadyContacted(r: Recipient): boolean {
  if (r.status === "already_contacted") return true;
  return !!r.emailed && r.status !== "sent" && r.status !== "failed";
}

// Regroupement des destinataires par état. L'ordre définit l'affichage des sections.
// Les `match` sont mutuellement exclusifs : un destinataire « déjà contacté » ne
// réapparaît pas dans « À approuver » ou « Approuvés ».
const RECIPIENT_GROUPS: {
  key: string;
  label: string;
  color: any;
  match: (r: Recipient) => boolean;
  defaultCollapsed?: boolean;
}[] = [
  {
    key: "todo",
    label: "À approuver",
    color: "gray",
    match: (r) => (r.status === "draft" || r.status === "test_sent") && !isAlreadyContacted(r),
  },
  {
    key: "already_contacted",
    label: "Destinataires déjà contactés",
    color: "amber",
    match: isAlreadyContacted,
  },
  {
    key: "approved",
    label: "Approuvés",
    color: "blue",
    match: (r) => r.status === "approved" && !isAlreadyContacted(r),
  },
  {
    key: "sent",
    label: "Déjà envoyés",
    color: "green",
    match: (r) => r.status === "sent",
    defaultCollapsed: true,
  },
  {
    key: "failed",
    label: "Échecs d'envoi",
    color: "red",
    match: (r) => r.status === "failed",
  },
];

function RecipientList({
  campaign, recipients, reload, setMsg,
}: {
  campaign: Campaign;
  recipients: Recipient[]; reload: () => void; setMsg: (s: string) => void;
}) {
  const campaignId = campaign.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(RECIPIENT_GROUPS.filter((g) => g.defaultCollapsed).map((g) => g.key))
  );
  function toggleGroup(key: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function patch(recipientId: string, fields: any) {
    await api(`/api/campaigns/${campaignId}/recipients`, {
      method: "PATCH",
      json: { recipientId, ...fields },
    });
    reload();
  }
  async function sendTest(r: Recipient, testEmail: string) {
    try {
      const res = await api<{ to: string }>(`/api/campaigns/${campaignId}/send-test`, {
        method: "POST",
        json: { recipientId: r.id, testEmail: testEmail || undefined },
      });
      setMsg(`Email de test envoyé à ${res.to}.`);
      reload();
    } catch (e) {
      setMsg("Erreur test : " + (e as Error).message);
    }
  }
  async function remove(r: Recipient) {
    const who = r.prospect.name || r.to_email || r.prospect.email || "ce contact";
    if (!confirm(`Retirer ${who} de cette campagne ?`)) return;
    // Exclusion douce (pas une suppression) : la synchro auto ne le ré-ajoutera pas.
    await api(`/api/campaigns/${campaignId}/recipients`, {
      method: "PATCH",
      json: { recipientId: r.id, status: "excluded" },
    });
    setMsg("Contact retiré de la campagne.");
    reload();
  }

  // Destinataires visibles : on masque les exclus (« retirés » via exclusion douce).
  const visible = recipients.filter((r) => r.status !== "excluded");

  // Approuvables : ni déjà approuvés, ni envoyés/échoués, ni exclus, ni supprimés,
  // ni déjà contactés (jamais re-contacter une adresse déjà jointe).
  const approvable = visible.filter(
    (r) =>
      r.status !== "approved" &&
      r.status !== "sent" &&
      r.status !== "failed" &&
      !r.suppressed &&
      !isAlreadyContacted(r)
  );
  async function approveAll() {
    if (approvable.length === 0) return;
    await api(`/api/campaigns/${campaignId}/recipients`, {
      method: "PATCH",
      json: { recipientIds: approvable.map((r) => r.id), status: "approved" },
    });
    setMsg(`${approvable.length} destinataire(s) approuvé(s).`);
    reload();
  }

  if (visible.length === 0)
    return (
      <Card className="p-5 text-sm text-gray-400">
        Aucun destinataire. Ajoutez des prospects ci-dessus.
      </Card>
    );

  // Répartition dans les groupes (ordre défini par RECIPIENT_GROUPS). Tout statut
  // visible non couvert tombe dans un groupe « Autres » de secours.
  const grouped = RECIPIENT_GROUPS.map((g) => ({
    ...g,
    items: visible.filter(g.match),
  }));
  const covered = new Set(grouped.flatMap((g) => g.items.map((r) => r.id)));
  const others = visible.filter((r) => !covered.has(r.id));
  const sections = others.length
    ? [...grouped, { key: "other", label: "Autres", color: "gray" as any, items: others }]
    : grouped;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 p-3">
        <h3 className="font-bold">Destinataires ({visible.length})</h3>
        <Button onClick={approveAll} disabled={approvable.length === 0}>
          Tout approuver ({approvable.length})
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="p-3">Business</th>
            <th className="p-3">Email</th>
            <th className="p-3">Statut</th>
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((g) => {
            if (g.items.length === 0) return null;
            const isCollapsed = collapsed.has(g.key);
            return (
              <GroupRows key={g.key}>
                <tr
                  className="cursor-pointer border-t border-gray-200 bg-gray-50/80 hover:bg-gray-100"
                  onClick={() => toggleGroup(g.key)}
                >
                  <td colSpan={4} className="px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-600">
                      <span className="text-gray-400">{isCollapsed ? "▸" : "▾"}</span>
                      <Badge color={g.color}>{g.label}</Badge>
                      <span className="text-gray-400">({g.items.length})</span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed &&
                  g.items.map((r) => (
                    <RecipientRow
                      key={r.id}
                      r={r}
                      campaign={campaign}
                      open={openId === r.id}
                      onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                      patch={patch}
                      sendTest={sendTest}
                      remove={remove}
                    />
                  ))}
              </GroupRows>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// Conteneur logique pour un groupe de lignes (header + lignes). React tolère un
// fragment comme enfant de <tbody>, ce wrapper sert juste à porter une key stable.
function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function statusColor(s: string): any {
  return (
    {
      draft: "gray",
      test_sent: "amber",
      approved: "blue",
      sent: "green",
      failed: "red",
      already_contacted: "amber",
    }[s] || "gray"
  );
}

function RecipientRow({
  r, campaign, open, onToggle, patch, sendTest, remove,
}: {
  r: Recipient; campaign: Campaign; open: boolean; onToggle: () => void;
  patch: (id: string, fields: any) => void;
  sendTest: (r: Recipient, testEmail: string) => void;
  remove: (r: Recipient) => void;
}) {
  const [testEmail, setTestEmail] = useState("");
  const [cs, setCs] = useState(r.custom_subject || "");
  const [ch, setCh] = useState(r.custom_html || "");
  // Produit affiché = produit cible de la campagne s'il est défini, sinon segment d'origine (comme à l'envoi).
  const product = getProduct(campaign.product || r.prospect.segment?.product);
  // Email déjà traité (envoyé, échoué) ou adresse déjà contactée ailleurs : plus
  // d'édition/test/approbation, seulement un aperçu.
  const contacted = isAlreadyContacted(r);
  const locked = r.status === "sent" || r.status === "failed" || contacted;

  // Aperçu du mail tel qu'il (sera) envoyé — rendu identique à l'envoi réel,
  // hors lien de désinscription signé (placeholder en aperçu).
  const preview = buildRecipientEmail({
    campaign,
    recipient: { custom_subject: r.custom_subject, custom_html: r.custom_html },
    prospect: r.prospect,
    segment: r.prospect.segment,
    unsubscribeUrl: "#",
  });

  return (
    <>
      <tr className="border-t border-gray-100">
        <td className="p-3 font-medium">
          {r.prospect.name}
          <div className="mt-0.5">
            <Badge color="blue">{product.name}</Badge>
          </div>
        </td>
        <td className="p-3 text-gray-500">{r.to_email || r.prospect.email || "-"}</td>
        <td className="p-3">
          <div className="flex flex-col gap-1">
            <Badge color={statusColor(r.status)}>{r.status}</Badge>
            {r.suppressed && (
              <span title="Ne sera pas envoyé (liste de suppression)">
                <Badge color="red">{suppressionLabel(r.suppression_reason)}</Badge>
              </span>
            )}
            {contacted && !r.suppressed && (
              <span
                title={
                  "Déjà contacté — ne sera pas renvoyé" +
                  (r.emailed_at
                    ? " · le " + new Date(r.emailed_at).toLocaleDateString("fr-BE")
                    : "") +
                  (r.emailed_campaigns?.length
                    ? " · " + r.emailed_campaigns.join(", ")
                    : "")
                }
              >
                <Badge color="amber">↩ déjà contacté</Badge>
              </span>
            )}
          </div>
        </td>
        <td className="p-3">
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" onClick={onToggle}>
              {open ? "Fermer" : locked ? "Aperçu" : "Adapter"}
            </Button>
            {!locked && (
              <>
                <Button
                  variant="outline"
                  onClick={() => sendTest(r, testEmail)}
                  title="Envoie un test à votre adresse"
                >
                  Test
                </Button>
                {r.suppressed ? (
                  r.status === "approved" ? (
                    <Button variant="ghost" onClick={() => patch(r.id, { status: "draft" })}>
                      Désapprouver
                    </Button>
                  ) : null
                ) : r.status !== "approved" ? (
                  <Button onClick={() => patch(r.id, { status: "approved" })}>Approuver</Button>
                ) : (
                  <Button variant="ghost" onClick={() => patch(r.id, { status: "draft" })}>
                    Désapprouver
                  </Button>
                )}
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => remove(r)}
              className="text-red-600"
              title="Retirer ce contact de la campagne"
            >
              Retirer
            </Button>
          </div>
        </td>
      </tr>
      {open && locked && (
        <tr className="bg-gray-50">
          <td colSpan={4} className="p-4">
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-gray-500">Sujet : </span>
                <span className="font-medium">{preview.subject}</span>
              </div>
              <iframe
                title={`Aperçu email ${r.prospect.name}`}
                srcDoc={preview.html}
                className="w-full rounded-lg border border-gray-200 bg-white"
                style={{ height: 480 }}
              />
              {r.error && <p className="text-sm text-red-600">Erreur : {r.error}</p>}
            </div>
          </td>
        </tr>
      )}
      {open && !locked && (
        <tr className="bg-gray-50">
          <td colSpan={4} className="p-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Email de test (vide = votre adresse configurée)
                </label>
                <Input
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className="max-w-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Sujet personnalisé (vide = template campagne)
                </label>
                <Input value={cs} onChange={(e) => setCs(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Corps personnalisé (vide = email du segment {product.name})
                </label>
                <Textarea
                  value={ch}
                  onChange={(e) => setCh(e.target.value)}
                  rows={8}
                  placeholder="Laisser vide pour utiliser le template de la campagne"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    patch(r.id, {
                      custom_subject: cs || null,
                      custom_html: ch || null,
                      to_email: r.to_email || r.prospect.email,
                    })
                  }
                >
                  Enregistrer l'adaptation
                </Button>
              </div>
              {r.error && <p className="text-sm text-red-600">Erreur : {r.error}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
