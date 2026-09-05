/**
 * Helpers HTML email PURS : aucune dépendance à une marque, aucune lecture
 * d'environnement. Isolés ici pour que les fichiers de marque
 * (lib/brands/*.ts) puissent les utiliser sans créer de cycle d'import
 * avec lib/email.ts.
 */

/** Retire tout tiret cadratin "—" (interdit dans les emails). */
export function noEmDash(text: string): string {
  return text.replace(/—/g, "-");
}

/** Transforme un texte en slug utilisable dans une URL (utm_campaign). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/** Bouton CTA réutilisable (inline-block, email-safe). */
export function ctaButton(label: string, href: string, color: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto;"><tr><td style="border-radius:8px;background:${color};">
  <a href="${href}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">${label}</a>
</td></tr></table>`;
}

/**
 * Rend visibles les liens du corps : tout <a> SANS attribut style reçoit la
 * couleur de marque + soulignement + gras (les boutons, qui ont déjà un style,
 * sont laissés tels quels).
 */
export function enhanceLinks(html: string, color: string): string {
  return html.replace(/<a\b(?![^>]*\bstyle=)([^>]*)>/gi, (_m, attrs) => {
    return `<a${attrs} style="color:${color};font-weight:600;text-decoration:underline;">`;
  });
}
