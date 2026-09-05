"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Badge, Spinner } from "@/components/ui";
import {
  parseCsv,
  autoMap,
  IMPORT_FIELDS,
  type CsvTable,
  type ImportField,
} from "@/lib/csv";
import type { ImportReport, ImportRow, SegmentTally } from "@/lib/prospect-import";
import { labelKey, segmentLabelFromCategory } from "@/lib/segment-matching";
import type { SegmentResolution } from "@/app/api/segments/resolve/route";

type Segment = { id: string; label: string };

/** Taille des lots envoyés au serveur (doit rester <= MAX_ROWS de la route). */
const CHUNK = 500;

const DELIMITER_OPTIONS = [
  { value: "", label: "Détection automatique" },
  { value: ";", label: "Point-virgule ( ; )" },
  { value: ",", label: "Virgule ( , )" },
  { value: "\t", label: "Tabulation" },
  { value: "|", label: "Barre verticale ( | )" },
];

/**
 * Excel écrit encore beaucoup de CSV en Windows-1252 : décodés en UTF-8, les
 * accents deviennent des caractères de remplacement. On tente l'UTF-8, et on
 * bascule sur Windows-1252 si le résultat contient des U+FFFD.
 */
async function readTextSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return utf8;
  }
}

const emptyReport = (): ImportReport => ({
  received: 0,
  created: 0,
  merged: 0,
  duplicates: 0,
  droppedEmails: 0,
  skipped: [],
  segments: [],
});

/** Fusionne les compteurs par segment de plusieurs lots. */
function mergeTallies(into: SegmentTally[], from: SegmentTally[]) {
  for (const t of from) {
    const hit = into.find((x) => x.id === t.id);
    if (hit) {
      hit.created += t.created;
      hit.merged += t.merged;
    } else into.push({ ...t });
  }
}

/** Valeurs spéciales du plan, distinctes d'un id de segment (uuid). */
const CREATE = "__new__";
const SKIP = "__skip__";

/** Une valeur distincte de la colonne catégorie, et son poids dans le fichier. */
type Bucket = { key: string; label: string; count: number };

export function ProspectImport({
  segments,
  onDone,
}: {
  segments: Segment[];
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [raw, setRaw] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, number>>(
    {} as Record<ImportField, number>
  );
  const [segmentId, setSegmentId] = useState("");
  const [mode, setMode] = useState<"single" | "category">("single");
  /** Cible choisie pour chaque catégorie : id de segment, CREATE ou SKIP. */
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [planBusy, setPlanBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");

  /** (Re)parse le texte courant et réinitialise le mapping automatique. */
  function build(text: string, d: string, header: boolean) {
    const t = parseCsv(text, { delimiter: d || undefined, hasHeader: header });
    setTable(t);
    setMapping(autoMap(t.headers));
    setReport(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setReport(null);
    setFilename(file.name);
    try {
      const text = await readTextSmart(file);
      setRaw(text);
      build(text, delimiter, hasHeader);
    } catch (e) {
      setError(`Lecture impossible : ${(e as Error).message}`);
    }
  }

  function changeDelimiter(d: string) {
    setDelimiter(d);
    if (raw) build(raw, d, hasHeader);
  }
  function changeHeader(h: boolean) {
    setHasHeader(h);
    if (raw) build(raw, delimiter, h);
  }

  function setField(field: ImportField, col: number) {
    setMapping((m) => {
      const next = { ...m, [field]: col };
      // Une colonne ne peut alimenter qu'un seul champ : on libère l'ancien.
      if (col >= 0)
        for (const k of Object.keys(next) as ImportField[])
          if (k !== field && next[k] === col) next[k] = -1;
      return next;
    });
  }

  /** Lignes du fichier converties en objets prospect selon le mapping. */
  const rows = useMemo<ImportRow[]>(() => {
    if (!table) return [];
    return table.rows.map((r) => {
      const o: ImportRow = {};
      for (const f of IMPORT_FIELDS) {
        const i = mapping[f.key];
        if (i >= 0) (o as any)[f.key] = r[i] ?? "";
      }
      return o;
    });
  }, [table, mapping]);

  const nameMapped = (mapping.name ?? -1) >= 0;
  const categoryMapped = (mapping.category ?? -1) >= 0;
  const withEmail = rows.filter((r) => (r.email || "").includes("@")).length;

  /**
   * Valeurs distinctes de la colonne catégorie, regroupées par clé de
   * rapprochement : « Coiffeur » et « coiffeurs » forment UN seul groupe, donc
   * un seul segment. Le groupe de clé "" rassemble les lignes sans catégorie.
   */
  const buckets = useMemo<Bucket[]>(() => {
    if (!categoryMapped) return [];
    const map = new Map<string, Bucket>();
    for (const r of rows) {
      const raw = (r.category || "").trim();
      const key = labelKey(raw);
      const hit = map.get(key);
      if (hit) hit.count++;
      else
        map.set(key, {
          key,
          label: key ? segmentLabelFromCategory(raw) : "Sans catégorie",
          count: 1,
        });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows, categoryMapped]);

  /** Signature des groupes : évite de relancer la résolution à chaque rendu. */
  const bucketSig = buckets.map((b) => b.key).join("|");

  /**
   * Proposition de plan : chaque catégorie est pré-rattachée au segment
   * existant qui lui correspond (voir lib/segment-matching), sinon marquée
   * « à créer ». Aucune écriture ici : `create: false`.
   */
  useEffect(() => {
    if (mode !== "category" || buckets.length === 0) return;
    let cancelled = false;
    const labels = buckets.filter((b) => b.key).map((b) => b.label);
    setPlanBusy(true);
    api<{ resolutions: SegmentResolution[] }>("/api/segments/resolve", {
      method: "POST",
      json: { labels, create: false },
    })
      .then((r) => {
        if (cancelled) return;
        const byKey = new Map(r.resolutions.map((x) => [x.key, x]));
        const next: Record<string, string> = {};
        for (const b of buckets) {
          if (!b.key) {
            // Les lignes sans catégorie ne sont rattachées nulle part par
            // défaut : les verser au hasard dans un segment serait pire que
            // de les laisser de côté explicitement.
            next[b.key] = SKIP;
            continue;
          }
          next[b.key] = byKey.get(b.key)?.segmentId ?? CREATE;
        }
        setPlan(next);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setPlanBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bucketSig]);

  /** Groupes effectivement importés (les autres sont ignorés). */
  const planned = buckets.filter((b) => (plan[b.key] ?? SKIP) !== SKIP);
  const toCreateCount = planned.filter((b) => plan[b.key] === CREATE).length;
  const plannedRows = planned.reduce((n, b) => n + b.count, 0);

  const targetReady =
    mode === "single" ? !!segmentId : planned.length > 0 && !planBusy;
  const ready = !!table && rows.length > 0 && nameMapped && targetReady && !busy;

  function reset() {
    setRaw("");
    setTable(null);
    setFilename("");
    setReport(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * Construit la cible de chaque ligne AVANT la boucle de lots : les segments
   * manquants sont créés une seule fois, sinon chaque lot en recréerait un
   * jeu complet.
   */
  async function resolveTargets(): Promise<Record<string, string> | null> {
    if (mode === "single") return null;
    const toCreate = planned.filter((b) => plan[b.key] === CREATE);
    const created = new Map<string, string>();
    if (toCreate.length) {
      const r = await api<{ resolutions: SegmentResolution[] }>("/api/segments/resolve", {
        method: "POST",
        json: { labels: toCreate.map((b) => b.label), create: true },
      });
      for (const x of r.resolutions) if (x.segmentId) created.set(x.key, x.segmentId);
    }
    const map: Record<string, string> = {};
    for (const b of planned) {
      const choice = plan[b.key];
      const id = choice === CREATE ? created.get(b.key) : choice;
      if (id) map[b.key] = id;
    }
    return map;
  }

  async function run() {
    if (!ready) return;
    setBusy(true);
    setError("");
    setReport(null);
    const total = rows.length;
    setProgress({ done: 0, total });

    // Agrégat de tous les lots : le serveur traite au maximum CHUNK lignes et
    // relit le vivier à chaque lot, donc un doublon réparti sur deux lots est
    // bien détecté (le lot précédent est déjà écrit en base).
    const sum = emptyReport();
    try {
      const segmentMap = await resolveTargets();
      for (let i = 0; i < total; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const r = await api<{ report: ImportReport }>("/api/prospects/import", {
          method: "POST",
          json: {
            // Un seul segment, ou une cible par catégorie. Les lignes dont la
            // catégorie n'est dans aucun des deux sont signalées par le
            // serveur dans `skipped`.
            segmentId: segmentMap ? undefined : segmentId,
            segmentMap: segmentMap ?? undefined,
            rows: slice,
            filename,
            // Index réel dans le fichier, pour que le rapport pointe la bonne ligne.
            offset: i + (hasHeader ? 1 : 0),
          },
        });
        sum.received += r.report.received;
        sum.created += r.report.created;
        sum.merged += r.report.merged;
        sum.duplicates += r.report.duplicates;
        sum.droppedEmails += r.report.droppedEmails;
        sum.skipped.push(...r.report.skipped);
        mergeTallies(sum.segments, r.report.segments ?? []);
        if (r.report.warning) sum.warning = r.report.warning;
        setProgress({ done: Math.min(i + CHUNK, total), total });
      }
      setReport(sum);
      onDone();
    } catch (e) {
      setError(
        `Import interrompu : ${(e as Error).message}. Les lignes déjà traitées sont enregistrées ; relancez sur le reste du fichier.`
      );
      if (sum.created || sum.merged) {
        setReport(sum);
        onDone();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Importer un fichier CSV</h3>
        <a
          href="/modele-prospects.csv"
          download
          className="text-sm text-brand underline"
        >
          Télécharger un modèle
        </a>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Alternative à la recherche Google : chargez votre propre liste. Les colonnes
        sont reconnues automatiquement, et les business déjà présents dans le vivier
        sont <b>complétés</b> plutôt que dupliqués. Séparateur, guillemets et accents
        Excel sont gérés.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full cursor-pointer rounded-lg border border-dashed border-gray-300 p-3 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-fg hover:border-brand"
      />

      {table && (
        <div className="mt-4 space-y-4">
          {/* Lecture du fichier */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
            <div className="text-sm">
              <div className="font-semibold">{filename}</div>
              <div className="text-xs text-gray-500">
                {table.rows.length} ligne{table.rows.length > 1 ? "s" : ""} ·{" "}
                {table.headers.length} colonne{table.headers.length > 1 ? "s" : ""}
              </div>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Séparateur
              </span>
              <select
                value={delimiter}
                onChange={(e) => changeDelimiter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {DELIMITER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => changeHeader(e.target.checked)}
              />
              La première ligne contient les en-têtes
            </label>
            <Button variant="ghost" className="ml-auto" onClick={reset}>
              Changer de fichier
            </Button>
          </div>

          {/* Correspondance colonnes -> champs */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-700">
              Correspondance des colonnes
            </h4>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f) => (
                <label key={f.key} className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    {f.label}
                    {f.required && <span className="text-red-600"> *</span>}
                  </span>
                  <select
                    value={mapping[f.key] ?? -1}
                    onChange={(e) => setField(f.key, Number(e.target.value))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${
                      f.required && (mapping[f.key] ?? -1) < 0
                        ? "border-red-300 bg-red-50"
                        : "border-gray-300"
                    }`}
                  >
                    <option value={-1}>— ignorer —</option>
                    {table.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!nameMapped && (
              <p className="mt-2 text-sm text-red-600">
                Le nom du business est obligatoire : choisissez la colonne correspondante.
              </p>
            )}
          </div>

          {/* Aperçu */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-700">
              Aperçu ({Math.min(5, rows.length)} première
              {Math.min(5, rows.length) > 1 ? "s" : ""} ligne
              {Math.min(5, rows.length) > 1 ? "s" : ""})
            </h4>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left uppercase text-gray-500">
                  <tr>
                    {IMPORT_FIELDS.filter((f) => (mapping[f.key] ?? -1) >= 0).map((f) => (
                      <th key={f.key} className="whitespace-nowrap p-2 font-medium">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {IMPORT_FIELDS.filter((f) => (mapping[f.key] ?? -1) >= 0).map((f) => (
                        <td key={f.key} className="max-w-[16rem] truncate p-2 text-gray-700">
                          {(r as any)[f.key] || (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {withEmail} ligne{withEmail > 1 ? "s" : ""} sur {rows.length} comporte
              {withEmail > 1 ? "nt" : ""} un email. Les autres pourront être enrichies
              depuis leur site web à l'étape 3.
            </p>
          </div>

          {/* Rattachement + lancement */}
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={mode === "single"}
                  onChange={() => setMode("single")}
                />
                Tout rattacher à un seul segment
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  categoryMapped ? "text-gray-700" : "text-gray-400"
                }`}
              >
                <input
                  type="radio"
                  checked={mode === "category"}
                  disabled={!categoryMapped}
                  onChange={() => setMode("category")}
                />
                Un segment par catégorie
                {!categoryMapped && (
                  <span className="text-xs">(mappez la colonne catégorie)</span>
                )}
              </label>
            </div>

            {mode === "single" ? (
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Rattacher au segment <span className="text-red-600">*</span>
                </span>
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className="min-w-[16rem] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">— choisir un segment —</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-700">
                    Plan de rattachement ({buckets.filter((b) => b.key).length} catégorie
                    {buckets.filter((b) => b.key).length > 1 ? "s" : ""})
                  </h4>
                  {planBusy && <Spinner />}
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                      <tr>
                        <th className="p-2 font-medium">Catégorie du fichier</th>
                        <th className="p-2 font-medium">Lignes</th>
                        <th className="p-2 font-medium">Segment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((b) => {
                        const choice = plan[b.key] ?? SKIP;
                        return (
                          <tr key={b.key || "__empty__"} className="border-t border-gray-100">
                            <td className="p-2">
                              {b.key ? (
                                b.label
                              ) : (
                                <span className="italic text-gray-500">Sans catégorie</span>
                              )}
                            </td>
                            <td className="p-2 tabular-nums text-gray-500">{b.count}</td>
                            <td className="p-2">
                              <select
                                value={choice}
                                onChange={(e) =>
                                  setPlan((x) => ({ ...x, [b.key]: e.target.value }))
                                }
                                className={`w-full min-w-[14rem] rounded-lg border px-2 py-1.5 text-sm ${
                                  choice === SKIP
                                    ? "border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-gray-300"
                                }`}
                              >
                                {b.key && (
                                  <option value={CREATE}>
                                    + Créer le segment « {b.label} »
                                  </option>
                                )}
                                {segments.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                                <option value={SKIP}>— ne pas importer —</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {plannedRows} ligne{plannedRows > 1 ? "s" : ""} sur {rows.length} seront
                  importées
                  {toCreateCount > 0 && (
                    <>
                      , dont {toCreateCount} nouveau{toCreateCount > 1 ? "x" : ""} segment
                      {toCreateCount > 1 ? "s" : ""} à créer
                    </>
                  )}
                  . Les segments créés ici reprennent le produit par défaut de la marque :
                  ajustez-les à l'étape 1 avant de rédiger leurs emails.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={run} disabled={!ready}>
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    {progress ? `${progress.done}/${progress.total}` : null}
                  </span>
                ) : (
                  `Importer ${mode === "category" ? plannedRows : rows.length} ligne${
                    (mode === "category" ? plannedRows : rows.length) > 1 ? "s" : ""
                  }`
                )}
              </Button>
              {segments.length === 0 && mode === "single" && (
                <p className="text-sm text-gray-500">
                  Aucun segment disponible : validez-en un à l'étape 1, ou importez par
                  catégorie pour les créer depuis le fichier.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {report && <ImportSummary report={report} />}
    </Card>
  );
}

/** Compte rendu lisible d'un import terminé. */
function ImportSummary({ report }: { report: ImportReport }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="mb-2 text-sm font-semibold text-gray-700">Import terminé</h4>
      <div className="flex flex-wrap gap-2">
        <Badge color="green">{report.created} nouveaux prospects</Badge>
        <Badge color="blue">{report.merged} déjà dans le vivier</Badge>
        {report.duplicates > 0 && (
          <Badge color="gray">{report.duplicates} doublons dans le fichier</Badge>
        )}
        <p className="mt-2 text-xs text-gray-500">
        Les prospects déjà dans le vivier ont été rattachés au segment, et leurs
        champs vides complétés par le fichier. Aucune donnée existante n'a été
        écrasée.
      </p>
      {report.droppedEmails > 0 && (
          <Badge color="amber">{report.droppedEmails} emails écartés</Badge>
        )}
        {report.skipped.length > 0 && (
          <Badge color="red">{report.skipped.length} lignes ignorées</Badge>
        )}
      </div>
      {report.segments.length > 1 && (
        <div className="mt-3">
          <h5 className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Répartition par segment
          </h5>
          <ul className="space-y-0.5 text-xs text-gray-600">
            {report.segments
              .slice()
              .sort((a, b) => b.created + b.merged - (a.created + a.merged))
              .map((t) => (
                <li key={t.id}>
                  <b>{t.label}</b> : {t.created} nouveau{t.created > 1 ? "x" : ""}
                  {t.merged > 0 && `, ${t.merged} déjà dans le vivier`}
                </li>
              ))}
          </ul>
        </div>
      )}
      {report.droppedEmails > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Emails écartés : format invalide ou adresse automatique (no-reply@…). Le
          business a tout de même été importé.
        </p>
      )}
      {report.warning && (
        <p className="mt-2 text-xs text-amber-700">{report.warning}</p>
      )}
      {report.skipped.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Voir les lignes ignorées
          </summary>
          <ul className="mt-2 space-y-0.5 text-gray-600">
            {report.skipped.slice(0, 50).map((s, i) => (
              <li key={i}>
                Ligne {s.line} : {s.reason}
              </li>
            ))}
            {report.skipped.length > 50 && (
              <li className="text-gray-400">
                … et {report.skipped.length - 50} autres
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
