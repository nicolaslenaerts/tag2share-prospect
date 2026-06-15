"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";

type Suppression = {
  email: string;
  reason: string;
  detail?: string | null;
  created_at: string;
};

const REASON_LABEL: Record<string, string> = {
  unsubscribe: "Désinscrit",
  bounce: "Adresse invalide (bounce)",
  complaint: "Plainte spam",
  manual: "Exclu manuellement",
};
const REASON_COLOR: Record<string, "gray" | "red" | "amber"> = {
  unsubscribe: "red",
  bounce: "amber",
  complaint: "red",
  manual: "gray",
};

export function Suppressions() {
  const [list, setList] = useState<Suppression[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (reason) params.set("reason", reason);
    if (q) params.set("q", q);
    const r = await api<{ suppressions: Suppression[]; counts: Record<string, number>; total: number }>(
      `/api/suppressions?${params.toString()}`
    );
    setList(r.suppressions);
    setCounts(r.counts);
    setTotal(r.total);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  async function add() {
    if (!newEmail.includes("@")) return;
    await api("/api/suppressions", { method: "POST", json: { email: newEmail, reason: "manual" } });
    setNewEmail("");
    setMsg("Ajouté à la liste de suppression.");
    load();
  }
  async function remove(email: string) {
    if (!confirm(`Retirer ${email} de la liste ? Il pourra de nouveau être contacté.`)) return;
    await api("/api/suppressions", { method: "DELETE", json: { email } });
    setMsg(`${email} retiré.`);
    load();
  }

  const filters = [
    { key: "", label: `Tout (${total})` },
    { key: "unsubscribe", label: `Désinscrits (${counts.unsubscribe ?? 0})` },
    { key: "bounce", label: `Bounces (${counts.bounce ?? 0})` },
    { key: "complaint", label: `Plaintes (${counts.complaint ?? 0})` },
    { key: "manual", label: `Manuels (${counts.manual ?? 0})` },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Liste de suppression ({total})</h2>
            <p className="text-sm text-gray-500">
              Emails désinscrits, en erreur (bounce) ou signalés en spam. Ils ne sont jamais
              (re)contactés.
            </p>
          </div>
          <Link href="/" className="text-sm font-semibold text-brand underline">
            ← Retour à la prospection
          </Link>
        </div>
        {msg && <p className="mt-3 text-sm text-brand-700">{msg}</p>}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setReason(f.key)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium " +
                (reason === f.key ? "bg-brand text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")
              }
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Rechercher un email…"
              className="w-56"
            />
            <Button variant="outline" onClick={load}>
              Rechercher
            </Button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <span className="text-xs font-medium text-gray-600">Exclure manuellement :</span>
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="email@exemple.com"
            className="w-64"
          />
          <Button variant="outline" onClick={add} disabled={!newEmail.includes("@")}>
            Ajouter
          </Button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">Aucune adresse dans cette vue.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-3">Email</th>
                  <th className="p-3">Raison</th>
                  <th className="p-3">Date</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.email} className="border-t border-gray-100">
                    <td className="p-3 font-medium">{s.email}</td>
                    <td className="p-3">
                      <Badge color={REASON_COLOR[s.reason] || "gray"}>
                        {REASON_LABEL[s.reason] || s.reason}
                      </Badge>
                    </td>
                    <td className="p-3 text-gray-500 whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString("fr-BE", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" onClick={() => remove(s.email)}>
                        Retirer
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
