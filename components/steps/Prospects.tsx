"use client";
import { useEffect, useMemo, useState } from "react";
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
  suppressed?: boolean;
  suppression_reason?: string | null;
};

// Libellé du badge de suppression selon la raison.
const SUPPRESSION_LABEL: Record<string, string> = {
  unsubscribe: "⛔ désinscrit",
  bounce: "✗ adresse invalide",
  complaint: "⚠ plainte spam",
  manual: "⛔ exclu",
};
function suppressionLabel(reason?: string | null) {
  return SUPPRESSION_LABEL[reason || ""] || "⛔ exclu";
}

// Groupe de filtres en pastilles (un seul choix actif).
function PillGroup<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-gray-600">{label} :</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={
              "rounded-full px-3 py-1 text-xs font-medium " +
              (value === o.key
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// En-tête de colonne triable.
function SortTh({
  label, k, sortKey, sortDir, onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey | null;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className="p-3 cursor-pointer select-none hover:text-gray-700"
      onClick={() => onSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? "text-brand" : "text-gray-300"}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}

type SortKey = "name" | "segments" | "phone" | "contact_name" | "email" | "status";

// Valeur de tri par colonne (les nulls partent en fin de liste).
function sortValue(p: Prospect, key: SortKey): string | number {
  switch (key) {
    case "segments":
      return p.segments?.length ?? 0;
    case "status":
      // Ordre logique : trouvé < enrichi, puis contacté/exclu en bonus.
      return `${p.status}${p.emailed ? "1" : "0"}${p.suppressed ? "1" : "0"}`;
    default:
      return (p[key] || "") as string;
  }
}

export function Prospects({ onNext }: { onNext: () => void }) {
  const [list, setList] = useState<Prospect[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [fEnriched, setFEnriched] = useState<"all" | "yes" | "no">("all");
  const [fEmail, setFEmail] = useState<"all" | "yes" | "no">("all");

  const filtered = useMemo(() => {
    return list.filter((p) => {
      if (fEnriched === "yes" && p.status !== "enriched") return false;
      if (fEnriched === "no" && p.status === "enriched") return false;
      const hasEmail = !!(p.email && p.email.trim());
      if (fEmail === "yes" && !hasEmail) return false;
      if (fEmail === "no" && hasEmail) return false;
      return true;
    });
  }, [list, fEnriched, fEmail]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      const sa = String(va);
      const sb = String(vb);
      if (!sa && sb) return 1; // vides en fin, quel que soit le sens
      if (sa && !sb) return -1;
      return sa.localeCompare(sb, "fr", { sensitivity: "base" }) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

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
  // Sélectionne/désélectionne tous les prospects actuellement visibles (filtrés).
  function toggleAll() {
    const ids = filtered.map((p) => p.id);
    setSel((s) => {
      const allSelected = ids.length > 0 && ids.every((id) => s.has(id));
      const n = new Set(s);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => sel.has(p.id));

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

  // Ajoute l'email du prospect à la liste de suppression (ne sera plus contacté).
  async function exclude(p: Prospect) {
    if (!p.email) return;
    if (!confirm(`Exclure ${p.email} ? Cette adresse ne sera plus jamais contactée.`)) return;
    await api("/api/suppressions", {
      method: "POST",
      json: { email: p.email, reason: "manual" },
    });
    setList((l) =>
      l.map((x) =>
        x.id === p.id ? { ...x, suppressed: true, suppression_reason: "manual" } : x
      )
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">
              3. Prospects (
              {filtered.length === list.length
                ? list.length
                : `${filtered.length}/${list.length}`}
              )
            </h2>
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

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <PillGroup
            label="Enrichissement"
            value={fEnriched}
            onChange={setFEnriched}
            options={[
              { key: "all", label: "Tous" },
              { key: "yes", label: "Enrichis" },
              { key: "no", label: "Non enrichis" },
            ]}
          />
          <PillGroup
            label="Email"
            value={fEmail}
            onChange={setFEmail}
            options={[
              { key: "all", label: "Tous" },
              { key: "yes", label: "Avec email" },
              { key: "no", label: "Sans email" },
            ]}
          />
        </div>
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
        ) : sorted.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">
            Aucun prospect ne correspond aux filtres.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <SortTh label="Business" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Segments" k="segments" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Téléphone" k="phone" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Contact" k="contact_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Email" k="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Statut" k="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
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
                        {p.suppressed && (
                          <span title="Ne sera jamais recontacté (liste de suppression)">
                            <Badge color="red">{suppressionLabel(p.suppression_reason)}</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        {p.email && !p.suppressed && (
                          <Button
                            variant="ghost"
                            className="text-red-600"
                            title="Exclure cette adresse (liste de suppression)"
                            onClick={() => exclude(p)}
                          >
                            Exclure
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          title="Retirer ce prospect"
                          onClick={() => remove(p.id)}
                        >
                          ✕
                        </Button>
                      </div>
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
