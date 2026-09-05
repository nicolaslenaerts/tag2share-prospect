"use client";
import Link from "next/link";
import { useBrand } from "@/components/BrandProvider";
import { BrandSwitcher } from "@/components/BrandSwitcher";

/**
 * En-tête commun aux pages de l'app : identité de la marque active, sélecteur
 * de marque (masqué s'il n'y en a qu'une) et liens de navigation.
 */
export function AppHeader({
  subtitle,
  links,
}: {
  /** Sous-titre de la page (par défaut : l'accroche de la marque). */
  subtitle?: string;
  links?: { href: string; label: string }[];
}) {
  const brand = useBrand();
  return (
    <header className="mb-8 flex flex-wrap items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand font-bold text-brand-fg">
        {brand.theme.monogram}
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900">{brand.name} - Prospection</h1>
        <p className="text-sm text-gray-500">{subtitle ?? brand.tagline}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <BrandSwitcher />
        {(links ?? []).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-brand/50"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
