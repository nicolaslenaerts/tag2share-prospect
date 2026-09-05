"use client";
import { BRAND_COOKIE } from "@/lib/brand-cookie";
import { useBrandContext } from "./BrandProvider";

/**
 * Sélecteur de marque. Écrit le cookie `brand` puis recharge la page :
 * toutes les données (segments, prospects, campagnes) sont chargées côté
 * client via lib/api.ts, donc un rechargement complet garantit qu'aucune
 * donnée de l'ancienne marque ne subsiste à l'écran.
 *
 * La liste vient du serveur (app/layout.tsx) : elle inclut les marques créées
 * dans l'interface, que le navigateur ne peut pas résoudre lui-même.
 */
export function BrandSwitcher() {
  const { brand, options } = useBrandContext();
  if (options.length < 2) return null;

  function select(slug: string) {
    if (slug === brand.slug) return;
    // 1 an, tout le site. Pas de donnée sensible : simple préférence d'affichage.
    document.cookie = `${BRAND_COOKIE}=${encodeURIComponent(slug)};path=/;max-age=${
      60 * 60 * 24 * 365
    };samesite=lax`;
    window.location.reload();
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Marque</span>
      <select
        value={brand.slug}
        onChange={(e) => select(e.target.value)}
        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 focus:border-brand focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {/* Une marque en brouillon reste sélectionnable : on prépare ses
                segments et ses tests avant de l'activer. */}
            {o.name}
            {o.active ? "" : " (brouillon)"}
          </option>
        ))}
      </select>
    </label>
  );
}
