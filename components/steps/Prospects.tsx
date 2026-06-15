"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";

type SegmentRef = { id: string; label: string; product?: string };
type Prospect = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  country?: string;
  website?: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  logo_url?: string;
  rating?: number;
  reviews_count?: number;
  status: string;
  segments?: SegmentRef[];
  emailed?: boolean;
  emailed_at?: string | null;
  emailed_campaigns?: string[];
};

export function Prospects({ onNext }: { onNext: () => void }) {
  const [list, setList] = useState<Prospect[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const r = await api<{ prospects: Prospect[] }>("/api/prospects");
    setList(r.prospects);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((s) => (s.size === list.length ? new Set() : new Set(list.map((p) => p.id))));
  }

  async function enrich() {
    if (sel.size === 0) return;
    setEnriching(true);
    setError("");
    try {
      await api("/api/prospects/enrich", { method: "POST", json: { ids: [...sel] } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnriching(false);
    }
  }

  // Met à jour la valeur affichée immédiatement (input contrôlé)
  function setField(id: string, field: string, value: string) {
    setList((l) => l.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }
  // Persiste en base (au blur)
  async function saveField(id: string, field: string, value: string) {
    await api("/api/prospects", { method: "PATCH", json: { id, [field]: value } });
  }

  async function remove(id: string) {
    await api("/api/prospects", { method: "DELETE", json: { id } });
    setList((l) => l.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">3. Prospects ({list.length})</h2>
            <p className="text-sm text-gray-500">
              Sélectionnez puis « Enrichir » pour extraire email, contact et logo depuis
              leur site. Vous pouvez corriger chaque champ.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={enrich} disabled={enriching || sel.size === 0}>
              {enriching ? <Spinner /> : `Enrichir (${sel.size})`}
            </Button>
            <Button onClick={onNext}>Créer une campagne →</Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">
            Aucun prospect. Lancez une recherche à l'étape 2.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-3">
                    <input
                      type="checkbox"
                      checked={sel.size === list.length && list.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="p-3">Business</th>
                  <th className="p-3">Segments</th>
                  <th className="p-3">Téléphone</th>
                  <th className="p-3">Contact</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Statut</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 align-top">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={sel.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {p.logo_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.logo_url}
                            alt=""
                            className="h-8 w-8 rounded object-contain"
                          />
                        )}
                        <div>
                          <div className="font-semibold">{p.name}</div>
                          <div className="text-xs text-gray-400">
                            {[p.category, p.city, p.country].filter(Boolean).join(" · ")}
                          </div>
                          {p.website && (
                            <a
                              href={p.website}
                              target="_blank"
                              className="text-xs text-brand underline"
                            >
                              site web
                            </a>
                          )}
                          {p.rating != null && (
                            <span className="ml-2 text-xs text-amber-600">
                              ★ {p.rating} ({p.reviews_count})
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(p.segments ?? []).length === 0 ? (
                          <span className="text-xs text-gray-300">-</span>
                        ) : (
                          (p.segments ?? []).map((s) => (
                            <Badge key={s.id} color={(p.segments?.length ?? 0) > 1 ? "amber" : "blue"}>
                              {s.label}
                            </Badge>
                          ))
                        )}
                      </div>
                      {(p.segments?.length ?? 0) > 1 && (
                        <div className="mt-1 text-[11px] text-amber-600">
                          ⚠ présent dans {p.segments!.length} segments
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs text-gray-600 whitespace-nowrap">
                      {p.phone || "-"}
                    </td>
                    <td className="p-3">
                      <Input
                        value={p.contact_name || ""}
                        placeholder="-"
                        className="w-36 text-xs"
                        onChange={(e) => setField(p.id, "contact_name", e.target.value)}
                        onBlur={(e) => saveField(p.id, "contact_name", e.target.value)}
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        value={p.email || ""}
                        placeholder="-"
                        className="w-52 text-xs"
                        onChange={(e) => setField(p.id, "email", e.target.value)}
                        onBlur={(e) => saveField(p.id, "email", e.target.value)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1">
                        {p.status === "enriched" ? (
                          <Badge color="green">enrichi</Badge>
                        ) : (
                          <Badge>trouvé</Badge>
                        )}
                        {p.emailed && (
                          <span
                            title={
                              "Mail envoyé" +
                              (p.emailed_at
                                ? " le " + new Date(p.emailed_at).toLocaleDateString("fr-BE")
                                : "") +
                              (p.emailed_campaigns?.length
                                ? " · " + p.emailed_campaigns.join(", ")
                                : "")
                            }
                          >
                            <Badge color="amber">✉ déjà contacté</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <Button variant="ghost" onClick={() => remove(p.id)}>
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
