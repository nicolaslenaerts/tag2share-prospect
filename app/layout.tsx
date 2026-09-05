import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { BrandProvider } from "@/components/BrandProvider";
import { BRAND_COOKIE } from "@/lib/brand-cookie";
import { DEFAULT_BRAND } from "@/lib/brands";
import { normalizeDomain } from "@/lib/brands/schema";
import { brandOptions, loadBrandRecords, type BrandRecord } from "@/lib/brands/store";
import { brandStyleAttr } from "@/lib/brands/theme";

/**
 * Marque active côté serveur.
 *
 * Même chaîne de résolution que les routes API (lib/brand-context.ts), rejouée
 * ici parce qu'un composant serveur ne reçoit pas d'objet Request : cookie de
 * préférence, puis DOMAINE de la requête, puis marque par défaut. Un accès à
 * marketing.horodo.be affiche donc Horodo sans qu'on ait à cliquer.
 */
async function currentBrand(): Promise<BrandRecord> {
  const records = await loadBrandRecords();
  const store = await cookies();
  const slug = store.get(BRAND_COOKIE)?.value?.trim().toLowerCase();
  const byCookie = slug ? records.find((r) => r.brand.slug === slug) : undefined;
  if (byCookie) return byCookie;

  const h = await headers();
  const host = normalizeDomain(
    (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0]
  );
  const byHost = host
    ? records.find((r) => r.brand.appUrl && normalizeDomain(r.brand.appUrl) === host)
    : undefined;

  return (
    byHost ??
    records.find((r) => r.brand.slug === DEFAULT_BRAND.slug) ?? {
      brand: DEFAULT_BRAND,
      source: "code",
      active: true,
    }
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await currentBrand();
  return {
    title: `${brand.name} - Prospection`,
    description: `Trouver et contacter des business pour ${brand.name}`,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [record, options] = await Promise.all([currentBrand(), brandOptions()]);
  return (
    // La palette de la marque est posée en variables CSS ici : Tailwind y fait
    // référence (voir tailwind.config.ts), ce qui permet de changer de marque
    // sans recompiler.
    <html lang="fr" style={brandStyleAttr(record.brand)}>
      <body className="font-sans min-h-screen">
        {/* La configuration complète est sérialisée jusqu'au client : depuis que
            des marques vivent en base, le navigateur ne peut plus résoudre un
            slug tout seul. */}
        <BrandProvider brand={record.brand} active={record.active} options={options}>
          {children}
        </BrandProvider>
      </body>
    </html>
  );
}
