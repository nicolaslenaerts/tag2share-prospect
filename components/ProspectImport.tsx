"use client";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Badge, Spinner } from "@/components/ui";
import {
  parseCsv,
  autoMap,
  IMPORT_FIELDS,
  type CsvTable,
  type ImportField,
} from "@/lib/csv";
import type { ImportReport, ImportRow } from "@/lib/prospect-import";

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
});

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
  const withEmail = rows.filter((r) => (r.email || "").includes("@")).length;
  const ready = !!table && rows.length > 0 && nameMapped && !!segmentId && !busy;

  function reset() {
    setRaw("");
    setTable(null);
    setFilename("");
    setReport(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
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
      for (let i = 0; i < total; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const r = await api<{ report: ImportReport }>("/api/prospects/import", {
          method: "POST",
          json: {
            segmentId,
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

          {/* Segment cible + lancement */}
          <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
            <label className="text-sm">
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
            <Button onClick={run} disabled={!ready}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  {progress ? `${progress.done}/${progress.total}` : null}
                </span>
              ) : (
                `Importer ${rows.length} ligne${rows.length > 1 ? "s" : ""}`
              )}
            </Button>
            {segments.length === 0 && (
              <p className="text-sm text-gray-500">
                Aucun segment disponible : validez-en un à l'étape 1.
              </p>
            )}
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
