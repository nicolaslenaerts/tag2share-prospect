"use client";
import { createContext, useContext } from "react";
import { DEFAULT_BRAND, getBrandOrDefault } from "@/lib/brands";
import type { BrandConfig } from "@/lib/brands/types";

const BrandContext = createContext<BrandConfig>(DEFAULT_BRAND);

/**
 * Rend la marque active disponible aux composants clients (aperçu d'email,
 * catalogue produit, libellés). Le slug est résolu côté serveur depuis le
 * cookie, dans app/layout.tsx.
 */
export function BrandProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <BrandContext.Provider value={getBrandOrDefault(slug)}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandConfig {
  return useContext(BrandContext);
}
