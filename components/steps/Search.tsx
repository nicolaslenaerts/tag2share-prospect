"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";

type Segment = {
  id: string; label: string; product: string; search_terms: string[];
  prospect_count?: number;
};
type SearchLog = {
  id: string; segment_id: string;
  country?: string; city?: string; zone?: string;
  found_count: number; new_count: number; created_at: string;
};

export function Search({ onNext }: { onNext: () => void }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [country, setCountry] = useState("Belgique");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(20);
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("");
  const [results, setResults] = useState<
    Record<string, { count: number; newCount: number; zone: string }>
  >({});
  const [history, setHistory] = useState<SearchLog[]>([]);
  const [error, setError] = useState("");

  function loadSegments() {
    api<{ segments: Segment[] }>("/api/segments").then((r) => setSegments(r.segments));
  }
  function loadHistory() {
    api<{ searches: SearchLog[] }>("/api/prospects/search").then((r) =>
      setHistory(r.searches)
    );
  }
  useEffect(() => {
    loadSegments();
    loadHistory();
  }, []);

  async function run(seg: Segment) {
    setBusy(seg.id);
    setError("");
    setPhase("Recherche Google Places…");
    try {
      const r = await api<{
        count: number; newCount: number; zone: string; prospects: { id: string }[];
      }>("/api/prospects/search", {
        method: "POST",
        json: { segmentId: seg.id, country, city: city || undefined, maxResults },
      });
      setResults((x) => ({
        ...x,
        [seg.id]: { count: r.count, newCount: r.newCount, zone: r.zone },
      }));
      loadHistory();
      loadSegments();

      if (autoEnrich && r.prospects?.length) {
        setPhase(`Enrichissement de ${r.prospects.length} sites (email, contact, logo)…`);
        await api("/api/prospects/enrich", {
          method: "POST",
          json: { ids: r.prospects.map((p) => p.id) },
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setPhase("");
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-1 text-lg font-bold">2. Rechercher des business</h2>
        <p className="mb-4 text-sm text-gray-500">
          Réglez pays / ville / max, puis cliquez « Rechercher » sur un segment : ces
          réglages s'appliquent à cette recherche. Les doublons sont écartés et les résultats
          s'<b>ajoutent</b> à l'étape 3 (relancer avec une autre ville complète la liste, ne la
          remplace pas).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">Pays</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option>Belgique</option>
              <option>France</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">
              Ville / zone (optionnel)
            </span>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="ex: Bruxelles, Liège, Paris…"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">Max par segment</span>
            <Input
              type="number"
              value={maxResults}
              min={1}
              max={60}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-24"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoEnrich}
              onChange={(e) => setAutoEnrich(e.target.checked)}
            />
            Enrichir automatiquement (email, contact, logo)
          </label>
        </div>
        {phase && (
          <p className="mt-3 flex items-center gap-2 text-sm text-brand-700">
            <Spinner /> {phase}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">Segments</h3>
          <Button onClick={onNext}>Voir les prospects →</Button>
        </div>
        {segments.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucun segment. Revenez à l'étape 1 pour en valider.
          </p>
        ) : (
          <ul className="space-y-2">
            {segments.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
              >
                <div>
                  <span className="font-semibold">{s.label}</span>{" "}
                  <Badge color="blue">{s.product}</Badge>{" "}
                  <Badge color="gray">{s.prospect_count ?? 0} prospects au total</Badge>{" "}
                  {results[s.id] != null && (
                    <Badge color="green">
                      {results[s.id].count} trouvés · {results[s.id].newCount} nouveaux (
                      {results[s.id].zone})
                    </Badge>
                  )}
                  <SegmentHistory logs={history.filter((h) => h.segment_id === s.id)} />
                </div>
                <Button onClick={() => run(s)} disabled={busy === s.id}>
                  {busy === s.id ? <Spinner /> : "Rechercher"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Détail du journal des recherches d'un segment (repliable). */
function SegmentHistory({ logs }: { logs: SearchLog[] }) {
  if (logs.length === 0) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("fr-BE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-gray-400 hover:text-gray-600">
        {logs.length} recherche{logs.length > 1 ? "s" : ""} effectuée
        {logs.length > 1 ? "s" : ""} - voir le détail
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="text-left text-gray-400">
            <tr>
              <th className="py-1 pr-4 font-medium">Date & heure</th>
              <th className="py-1 pr-4 font-medium">Pays</th>
              <th className="py-1 pr-4 font-medium">Ville / zone</th>
              <th className="py-1 pr-4 font-medium text-right">Résultats</th>
              <th className="py-1 font-medium text-right">Nouveaux</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="py-1 pr-4 whitespace-nowrap">{fmt(l.created_at)}</td>
                <td className="py-1 pr-4">{l.country || "-"}</td>
                <td className="py-1 pr-4">{l.city || l.zone || "toutes zones"}</td>
                <td className="py-1 pr-4 text-right">{l.found_count}</td>
                <td className="py-1 text-right font-medium text-green-700">{l.new_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
