/**
 * Registre des gabarits d'email. Une marque déclare le sien via
 * `email.layout` dans sa configuration (lib/brands/<slug>.ts).
 */
import type { BrandConfig, EmailLayoutKey } from "../brands/types";
import type { EmailLayout, LayoutOpts } from "./types";
import { classic } from "./classic";
import { minimal } from "./minimal";

export type { EmailLayout, LayoutOpts } from "./types";

export const LAYOUTS: Record<EmailLayoutKey, EmailLayout> = { classic, minimal };

/** Libellés pour l'UI. */
export const LAYOUT_LABELS: Record<EmailLayoutKey, string> = {
  classic: "Classique (carte centrée, bandeau coloré)",
  minimal: "Minimal (pleine largeur, filet coloré)",
};

/**
 * Enveloppe un corps HTML dans le gabarit de la marque.
 * Remplace l'ancien `wrapEmail` mono-marque.
 */
export function renderLayout(
  brand: BrandConfig,
  bodyHtml: string,
  opts?: LayoutOpts
): string {
  const layout = LAYOUTS[brand.email.layout] ?? classic;
  return layout(brand, bodyHtml, opts);
}
