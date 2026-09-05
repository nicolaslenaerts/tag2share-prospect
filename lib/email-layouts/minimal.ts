/**
 * Gabarit "minimal" : pas de carte ni d'ombre, fond blanc plein, logo aligné à
 * gauche, accroche en texte discret séparée par un filet coloré, pied de page
 * sobre. Rend un email plus proche d'un message écrit à la main que d'une
 * newsletter, ce qui aide la délivrabilité en prospection à froid.
 *
 * Contraintes email respectées : tables, styles inline, 600px max, aucune
 * image de fond (Outlook les ignore).
 */
import { brandColor } from "../brands/types";
import type { EmailLayout } from "./types";

export const minimal: EmailLayout = (brand, bodyHtml, opts) => {
  const color = brandColor(brand);
  const logo = opts?.logoUrl || brand.theme.logoUrl;
  const tagline = opts?.tagline == null ? brand.defaults.tagline : opts.tagline;
  const id = brand.sender.identity;
  const identityLine = [id.name, id.address, id.contact].filter(Boolean).join(" · ");
  const taglineRow = tagline.trim()
    ? `<tr><td style="padding:0 0 18px;">
          <p style="margin:0;color:#6b7280;font-size:13px;letter-spacing:0.2px;">${tagline}</p>
        </td></tr>`
    : "";
  const socials = brand.email.socials
    .map(
      (s) =>
        `<a href="${s.url}" style="color:#9ca3af;font-weight:500;text-decoration:none;">${s.label}</a>`
    )
    .join(' <span style="color:#d1d5db;">/</span> ');
  const unsubLine = opts?.unsubscribeUrl
    ? `<p style="margin:10px 0 0;color:#9ca3af;font-size:12px;">
            Vous recevez cet email professionnel car vos coordonnées sont publiques.
            <a href="${opts.unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Se désinscrire</a>
          </p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:32px 20px 48px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td style="padding:0 0 14px;">
          <img src="${logo}" alt="${brand.theme.logoAlt}" width="${Math.round(brand.theme.logoWidth * 0.8)}" style="display:block;border:0;outline:none;">
        </td></tr>
        ${taglineRow}
        <tr><td style="border-top:3px solid ${color};padding:0;line-height:0;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:26px 0 8px;color:#1f2937;font-size:16px;line-height:1.65;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:22px 0 0;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;font-size:13px;">${socials}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} ${identityLine}</p>
          ${unsubLine}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};
