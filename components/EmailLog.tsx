"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Input, Badge, Spinner } from "@/components/ui";

type EmailRow = {
  id: string;
  to_email: string;
  prospect_name?: string | null;
  campaign_name?: string | null;
  segment_label?: string | null;
  product_name?: string | null;
  subject?: string | null;
  status: string;
  event?: string | null;
  event_at?: string | null;
  error?: string | null;
  created_at: string;
};

type Resp = {
  emails: EmailRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const EVENT_LABEL: Record<string, string> = {
  delivered: "Délivré",
  opened: "Ouvert",
  clicked: "Cliqué",
  bounced: "Bounce",
  complained: "Plainte",
};
const EVENT_COLOR: Record<string, "gray" | "green" | "blue" | "amber" | "red"> = {
  delivered: "blue",
  opened: "green",
  clicked: "green",
  bounced: "amber",
  complained: "red",
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function EmailLog() {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const r = await api<Resp>(`/api/email-log?${params.toString()}`);
    setData(r);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  // Recherche / changement de filtre : revenir en page 1.
  function search() {
    if (page !== 1) setPage(1);
    else load();
  }
  function setStatusFilter(s: string) {
    setStatus(s);
    setPage(1);
  }

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const filters = [
    { key: "", label: "Tout" },
    { key: "sent", label: "Envoyés" },
    { key: "failed", label: "Échecs" },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Emails envoyés ({total})</h2>
            <p className="text-sm text-gray-500">
              Journal de tous les emails réellement envoyés aux prospects, avec le produit mis en
              avant et le suivi de délivrabilité.
            </p>
          </div>
          <Link href="/" className="text-sm font-semibold text-brand underline">
            ← Retour à la prospection
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium " +
                (status === f.key
                  ? "bg-brand text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200")
              }
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Email, business, campagne, sujet…"
              className="w-64"
            />
            <Button variant="outline" onClick={search}>
              Rechercher
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Spinner />
          </div>
        ) : !data || data.emails.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">Aucun email dans cette vue.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Destinataire</th>
                    <th className="p-3">Campagne</th>
                    <th className="p-3">Produit</th>
                    <th className="p-3">Sujet</th>
                    <th className="p-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {data.emails.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100 align-top">
                      <td className="p-3 whitespace-nowrap text-gray-500">
                        {fmtDate(e.created_at)}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{e.to_email}</div>
                        {e.prospect_name && (
                          <div className="text-xs text-gray-500">{e.prospect_name}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div>{e.campaign_name || "—"}</div>
                        {e.segment_label && (
                          <div className="text-xs text-gray-400">{e.segment_label}</div>
                        )}
                      </td>
                      <td className="p-3 text-gray-600">{e.product_name || "—"}</td>
                      <td className="p-3 max-w-xs truncate" title={e.subject || ""}>
                        {e.subject || "—"}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {e.status === "failed" ? (
                          <Badge color="red">Échec</Badge>
                        ) : e.event ? (
                          <Badge color={EVENT_COLOR[e.event] || "gray"}>
                            {EVENT_LABEL[e.event] || e.event}
                          </Badge>
                        ) : (
                          <Badge color="gray">Envoyé</Badge>
                        )}
                        {e.status === "failed" && e.error && (
                          <div className="mt-1 text-xs text-red-500">{e.error}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Page {data.page} / {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                >
                  ← Précédent
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={data.page >= totalPages}
                >
                  Suivant →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
