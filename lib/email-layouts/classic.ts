/**
 * Gabarit "classic" : carte blanche centrée, logo, bandeau d'accroche coloré,
 * pied avec réseaux sociaux. C'est le gabarit historique Tag2Share, rendu
 * paramétrable par marque (couleur, logo, accroche, réseaux, identité).
 */
import { brandColor, brandOnColor, brandTextColor } from "../brands/types";
import type { EmailLayout } from "./types";

export const classic: EmailLayout = (brand, bodyHtml, opts) => {
  const color = brandColor(brand); // fonds : bandeau
  const onColor = brandOnColor(brand); // texte posé sur le bandeau
  const textColor = brandTextColor(brand); // liens, lisibles sur fond clair
  const logo = opts?.logoUrl || brand.theme.logoUrl;
  const tagline = opts?.tagline == null ? brand.defaults.tagline : opts.tagline;
  const id = brand.sender.identity;
  const identityLine = [id.name, id.address, id.contact].filter(Boolean).join(" · ");
  const unsubLine = opts?.unsubscribeUrl
    ? `<p style="margin:8px 0 0;color:#999999;font-size:12px;">
            Vous recevez cet email professionnel car vos coordonnées sont publiques.
            <a href="${opts.unsubscribeUrl}" style="color:#999999;text-decoration:underline;">Se désinscrire</a>
          </p>`
    : "";
  const taglineRow = tagline.trim()
    ? `<tr><td style="background:${color};padding:14px 30px;text-align:center;">
          <p style="margin:0;color:${onColor};font-size:14px;font-weight:600;letter-spacing:0.3px;">
            ${tagline}
          </p>
        </td></tr>`
    : "";
  const socials = brand.email.socials
    .map(
      (s) =>
        `<a href="${s.url}" style="color:${textColor};font-weight:600;text-decoration:none;">${s.label}</a>`
    )
    .join(`\n            <span style="color:#cccccc;">&nbsp;·&nbsp;</span>\n            `);
  const socialsRow = socials
    ? `<p style="margin:0 0 12px;font-size:13px;">
            ${socials}
          </p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="padding:28px 30px 20px;text-align:center;background:#ffffff;">
          <img src="${logo}" alt="${brand.theme.logoAlt}" width="${brand.theme.logoWidth}" style="display:block;margin:0 auto;border:0;outline:none;">
        </td></tr>
        ${taglineRow}
        <tr><td style="padding:32px 30px;color:#1f2937;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:24px 30px;background-color:#f8f9fa;text-align:center;border-top:1px solid #e9ecef;">
          ${socialsRow}
          <p style="margin:0;color:#999999;font-size:12px;">© ${new Date().getFullYear()} ${identityLine}</p>
          ${unsubLine}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};
