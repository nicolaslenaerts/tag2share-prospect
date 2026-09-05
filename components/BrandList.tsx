"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { useBrand } from "@/components/BrandProvider";

type Readiness = { ok: boolean; blockers: string[]; warnings: string[] };

type Row = {
  slug: string;
  source: "code" | "db";
  active: boolean;
  editable: boolean;
  name: string;
  monogram: string;
  appUrl: string | null;
  productCount: number;
  updatedAt: string | null;
  errors: { path: string; message: string }[] | null;
  readiness: Readiness | null;
};

/**
 * Registre des marques. Deux origines volontairement distinguées à l'écran :
 * une marque déclarée en code ne se modifie que dans le dépôt, et le faire
 * croire modifiable ici serait pire que de ne pas l'afficher du tout.
 */
export function BrandList() {
  const current = useBrand();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    setError("");
    try {
      const r = await api<{ brands: Row[] }>("/api/brands");
      setRows(r.brands);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(row: Row) {
    setBusy(row.slug);
    setError("");
    try {
      await api(`/api/brands/${row.slug}`, {
        method: "PATCH",
        json: { active: !row.active },
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!rows) {
    return (
      <Card className="p-5">{error ? <p className="text-sm text-red-600">{error}</p> : <Spinner />}</Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-500">
          Une marque = une identité visuelle, un catalogue, un domaine d&apos;envoi et un
          positionnement pour l&apos;IA.
        </p>
        <Link href="/marques/nouvelle" className="ml-auto">
          <Button>Nouvelle marque</Button>
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.slug} className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-600">
                {row.monogram}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-900">{row.name}</span>
                  <code className="text-xs text-gray-400">{row.slug}</code>
                  {row.slug === current.slug && <Badge color="blue">marque affichée</Badge>}
                  {row.source === "code" ? (
                    <Badge>déclarée en code</Badge>
                  ) : row.active ? (
                    <Badge color="green">active</Badge>
                  ) : (
                    <Badge color="amber">brouillon</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {row.productCount} produit{row.productCount > 1 ? "s" : ""}
                  {row.appUrl ? ` · liens publics sur ${row.appUrl.replace(/^https?:\/\//, "")}` : " · liens publics sur le domaine commun"}
                </p>

                {row.errors && (
                  <p className="mt-2 text-xs text-red-600">
                    Configuration invalide, cette marque est ignorée par l&apos;application :{" "}
                    {row.errors.map((e) => e.message).join(" ")}
                  </p>
                )}

                {row.source === "db" && !row.active && row.readiness && !row.readiness.ok && (
                  <ul className="mt-2 space-y-1 text-xs text-amber-700">
                    {row.readiness.blockers.map((b) => (
                      <li key={b}>· {b}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {row.editable ? (
                  <>
                    <Link href={`/marques/${row.slug}`}>
                      <Button variant="outline">Modifier</Button>
                    </Link>
                    <Button
                      variant={row.active ? "ghost" : "primary"}
                      onClick={() => toggle(row)}
                      disabled={
                        busy === row.slug || (!row.active && !(row.readiness?.ok ?? false))
                      }
                      title={
                        !row.active && !(row.readiness?.ok ?? false)
                          ? "Des points bloquants restent à traiter avant l'activation."
                          : undefined
                      }
                    >
                      {busy === row.slug ? <Spinner /> : row.active ? "Désactiver" : "Activer"}
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">lib/brands/{row.slug}.ts</span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
