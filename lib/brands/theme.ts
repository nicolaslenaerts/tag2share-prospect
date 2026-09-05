/**
 * Dérivation des variables CSS de marque pour l'UI.
 *
 * Tailwind compile ses couleurs au build : une couleur littérale dans
 * tailwind.config.ts serait figée pour TOUTES les marques. On expose donc la
 * palette en variables CSS posées sur <html>, et tailwind.config.ts s'y réfère
 * via rgb(var(--brand) / <alpha-value>).
 *
 * Les nuances sont dérivées de la couleur de base : mélange avec du blanc pour
 * les tons clairs (50/100), assombrissement multiplicatif pour les tons foncés
 * (700/900). Client-safe.
 */
import type { BrandConfig } from "./types";

type Rgb = [number, number, number];

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Mélange avec du blanc : ratio = part de la couleur conservée. */
function tint(rgb: Rgb, ratio: number): Rgb {
  return rgb.map((c) => clamp(c * ratio + 255 * (1 - ratio))) as Rgb;
}

/** Assombrissement multiplicatif. */
function shade(rgb: Rgb, factor: number): Rgb {
  return rgb.map((c) => clamp(c * factor)) as Rgb;
}

const triplet = (rgb: Rgb) => rgb.join(" ");

/**
 * Variables CSS à poser sur <html> pour la marque active.
 * Les facteurs reproduisent, à quelques unités près, la palette Tag2Share
 * d'origine (#144A66 / #eef4f8 / #d4e3ec / #103b52 / #0a2738).
 */
export function brandCssVars(brand: BrandConfig): Record<string, string> {
  const base = brand.theme.rgb;
  // Les tons foncés servent de TEXTE (titres, messages, survols) : ils sont
  // dérivés de la variante lisible, pas de la couleur de signature. Pour une
  // marque sombre les deux coïncident ; pour une marque claire (ambre), dériver
  // de la signature donnerait un texte illisible.
  const text = brand.theme.textRgb ?? base;
  return {
    "--brand": triplet(base),
    "--brand-fg": brand.theme.onBrandHex ?? "#ffffff",
    "--brand-50": triplet(tint(base, 0.07)),
    "--brand-100": triplet(tint(base, 0.18)),
    "--brand-700": triplet(shade(text, 0.8)),
    "--brand-900": triplet(shade(text, 0.55)),
  };
}

/** Même palette, sous forme de chaîne `style` pour un attribut inline. */
export function brandStyleAttr(brand: BrandConfig): React.CSSProperties {
  return brandCssVars(brand) as React.CSSProperties;
}
