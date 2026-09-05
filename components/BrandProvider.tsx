"use client";
import { createContext, useContext } from "react";
import { DEFAULT_BRAND } from "@/lib/brands";
import type { BrandConfig } from "@/lib/brands/types";

export type BrandOption = {
  slug: string;
  name: string;
  monogram: string;
  active: boolean;
  source: "code" | "db";
};

type BrandContextValue = {
  brand: BrandConfig;
  /** La marque active est-elle autorisée à envoyer de vrais emails ? */
  active: boolean;
  /** Toutes les marques du registre, pour le sélecteur. */
  options: BrandOption[];
};

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  active: true,
  options: [],
});

/**
 * Rend la marque active disponible aux composants clients (aperçu d'email,
 * catalogue produit, libellés).
 *
 * La configuration COMPLÈTE est transmise depuis app/layout.tsx, et non plus
 * seulement son slug : depuis que des marques sont créées dans l'interface et
 * stockées en base, le navigateur ne peut plus résoudre un slug depuis le
 * registre statique.
 */
export function BrandProvider({
  brand,
  active,
  options,
  children,
}: {
  brand: BrandConfig;
  active: boolean;
  options: BrandOption[];
  children: React.ReactNode;
}) {
  return (
    <BrandContext.Provider value={{ brand, active, options }}>
      {children}
    </BrandContext.Provider>
  );
}

/** La marque active. */
export function useBrand(): BrandConfig {
  return useContext(BrandContext).brand;
}

/** La marque active et son contexte (activation, registre). */
export function useBrandContext(): BrandContextValue {
  return useContext(BrandContext);
}
