"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";
import { PRODUCT_LIST, normalizeProductKey } from "@/lib/products";

type Suggested = {
  label: string;
  rationale: string;
  product: string;
  search_terms: string[];
  _selected?: boolean;
};
type ProductKey = "keyring" | "card" | "stand";
type Segment = {
  id: string;
  label: string;
  rationale?: string;
  product?: string;
  search_terms: string[];
  email_subject?: string;
  email_body?: string;
};

export function Segments({ onNext }: { onNext: () => void }) {
  const [country, setCountry] = useState("Belgique");
  const [product, setProduct] = useState<ProductKey>("stand");
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggested[]>([]);
  const [saved, setSaved] = useState<Segment[]>([]);
  const [error, setError] = useState("");

  async function loadSaved() {
    const r = await api<{ segments: Segment[] }>("/api/segments");
    setSaved(r.segments);
  }
  useEffect(() => {
    loadSaved();
  }, []);

  async function suggest() {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ segments: Suggested[] }>("/api/segments/suggest", {
        method: "POST",
        json: { country, product, hint, count: 8 },
      });
      setSuggestions(
        r.segments.map((s) => ({ ...s, product: normalizeProductKey(s.product) || product, _selected: true }))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    const chosen = suggestions.filter((s) => s._selected);
    if (!chosen.length) return;
    await api("/api/segments", { method: "POST", json: { segments: chosen } });
    setSuggestions([]);
    await loadSaved();
  }

  async function remove(id: string) {
    await api("/api/segments", { method: "DELETE", json: { id } });
    await loadSaved();
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-1 text-lg font-bold">1. Quels business cibler ?</h2>
        <p className="mb-4 text-sm text-gray-500">
          Choisissez le <b>produit à mettre en avant</b> : Gemini propose alors les types de
          business qui en ont le plus besoin. L'email, lui, se rédige à l'étape{" "}
          <b>Campagne</b> (et peut viser plusieurs segments).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-600">Produit à vendre</span>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value as ProductKey)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {PRODUCT_LIST.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
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
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium text-gray-600">Précision (optionnel)</span>
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="ex: commerces de proximité, restauration…"
            />
          </label>
          <Button onClick={suggest} disabled={loading}>
            {loading ? <Spinner /> : "Proposer des types"}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      {suggestions.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold">
              Business pour : {PRODUCT_LIST.find((p) => p.key === product)?.name}
            </h3>
            <Button onClick={saveSelected}>
              Valider la sélection ({suggestions.filter((s) => s._selected).length})
            </Button>
          </div>
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-gray-100 p-3">
                <input
                  type="checkbox"
                  checked={!!s._selected}
                  onChange={(e) =>
                    setSuggestions((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, _selected: e.target.checked } : x))
                    )
                  }
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-semibold">{s.label}</div>
                  <p className="text-sm text-gray-500">{s.rationale}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Recherches : {s.search_terms.join(", ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">Segments validés ({saved.length})</h3>
          {saved.length > 0 && <Button onClick={onNext}>Étape suivante →</Button>}
        </div>
        {saved.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun segment validé pour l'instant.</p>
        ) : (
          <div className="space-y-3">
            {saved.map((s) => (
              <SavedSegment key={s.id} seg={s} onChange={loadSaved} onRemove={() => remove(s.id)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SavedSegment({
  seg,
  onChange,
  onRemove,
}: {
  seg: Segment;
  onChange: () => void;
  onRemove: () => void;
}) {
  const [product, setProduct] = useState(normalizeProductKey(seg.product));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function saveProduct(next: string) {
    setProduct(next as any);
    setSaving(true);
    await api("/api/segments", { method: "PATCH", json: { id: seg.id, product: next } });
    setSaving(false);
    setMsg("Produit enregistré.");
    onChange();
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{seg.label}</span>{" "}
          <Badge color="blue">{PRODUCT_LIST.find((p) => p.key === product)?.name}</Badge>
          <p className="text-xs text-gray-400">{seg.search_terms?.join(", ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500">
            Produit mis en avant
            <select
              value={product}
              onChange={(e) => saveProduct(e.target.value)}
              disabled={saving}
              className="ml-2 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              {PRODUCT_LIST.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={onRemove}>
            ✕
          </Button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-brand-700">{msg}</p>}
    </div>
  );
}
