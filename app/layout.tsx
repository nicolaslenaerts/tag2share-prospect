import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { BrandProvider } from "@/components/BrandProvider";
import { BRAND_COOKIE } from "@/lib/brand-context";
import { getBrandOrDefault } from "@/lib/brands";
import { brandStyleAttr } from "@/lib/brands/theme";

/** Marque active côté serveur, depuis le cookie de préférence. */
async function currentBrand() {
  const store = await cookies();
  return getBrandOrDefault(store.get(BRAND_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = await currentBrand();
  return {
    title: `${brand.name} - Prospection`,
    description: `Trouver et contacter des business pour ${brand.name}`,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await currentBrand();
  return (
    // La palette de la marque est posée en variables CSS ici : Tailwind y fait
    // référence (voir tailwind.config.ts), ce qui permet de changer de marque
    // sans recompiler.
    <html lang="fr" style={brandStyleAttr(brand)}>
      <body className="font-sans min-h-screen">
        <BrandProvider slug={brand.slug}>{children}</BrandProvider>
      </body>
    </html>
  );
}
