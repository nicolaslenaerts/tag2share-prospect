import type { BrandConfig } from "../brands/types";

export type LayoutOpts = {
  /**
   * Accroche sous le logo. undefined/null → accroche par défaut de la marque ;
   * "" → masquée.
   */
  tagline?: string | null;
  unsubscribeUrl?: string | null;
  /** Surcharge ponctuelle du logo (sinon celui de la marque). */
  logoUrl?: string;
};

/** Un gabarit d'email : enveloppe un corps HTML dans l'habillage de la marque. */
export type EmailLayout = (
  brand: BrandConfig,
  bodyHtml: string,
  opts?: LayoutOpts
) => string;
