/**
 * Email « post publié » envoyé à l'opérateur (jamais à un prospect).
 *
 * Un email par post, qui récapitule chaque réseau : lien public quand le
 * réseau l'a rendu, message d'erreur sinon.
 */
import { brandAppUrl } from "@/lib/public-url";
import { brandColor, brandOnColor, brandTextColor, type BrandConfig } from "@/lib/brands/types";
import { FORMAT_LABEL, postLabel, serviceLabel } from "./rules";
import type { SocialPost, SocialTarget } from "./types";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function publicationEmail(args: {
  brand: BrandConfig;
  post: SocialPost;
  targets: SocialTarget[];
  channelNames: Map<string, string | null>;
}): { subject: string; html: string } {
  const { brand, post, targets, channelNames } = args;
  const published = targets.filter((t) => t.status === "published");
  const failed = targets.filter((t) => t.status === "failed");
  const networks = (list: SocialTarget[]) => [...new Set(list.map((t) => serviceLabel(t.service)))].join(", ");
  const label = postLabel(post, 60);
  const kind = FORMAT_LABEL[post.format].toLowerCase();

  const subject =
    failed.length === 0
      ? `Publié sur ${networks(published)} : ${label}`
      : published.length === 0
        ? `Échec de publication sur ${networks(failed)} : ${label}`
        : `Publié en partie (${networks(published)}), échec sur ${networks(failed)} : ${label}`;

  const color = brandColor(brand);
  const onColor = brandOnColor(brand);
  const textColor = brandTextColor(brand);
  const rows = targets
    .map((t) => {
      const network = serviceLabel(t.service);
      const account = channelNames.get(t.channel_id);
      const name = escapeHtml(account ? `${network} · ${account}` : network);
      if (t.status === "published") {
        const action = t.published_url
          ? `<a href="${escapeHtml(t.published_url)}" style="display:inline-block;padding:8px 14px;border-radius:6px;background:${color};color:${onColor};text-decoration:none;font-size:14px;">Voir la publication</a>`
          : `<span style="color:#6b7280;font-size:13px;">Lien pas encore communiqué par ${escapeHtml(network)}</span>`;
        return `<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb;"><strong>${name}</strong><br><span style="color:#15803d;font-size:13px;">Publié</span></td><td style="padding:12px 0;border-top:1px solid #e5e7eb;text-align:right;">${action}</td></tr>`;
      }
      return `<tr><td colspan="2" style="padding:12px 0;border-top:1px solid #e5e7eb;"><strong>${name}</strong><br><span style="color:#b91c1c;font-size:13px;">Échec : ${escapeHtml(t.error || "raison inconnue")}</span></td></tr>`;
    })
    .join("");

  const excerpt = post.text.trim()
    ? `<p style="margin:16px 0;padding:12px 14px;background:#f9fafb;border-radius:8px;color:#374151;font-size:14px;white-space:pre-wrap;">${escapeHtml(
        post.text.length > 400 ? `${post.text.slice(0, 400)}...` : post.text
      )}</p>`
    : "";

  const appLink = `${brandAppUrl(brand)}/social?post=${encodeURIComponent(post.id)}`;
  const intro =
    failed.length === 0
      ? `Votre ${kind} « ${escapeHtml(label)} » est en ligne.`
      : published.length === 0
        ? `Votre ${kind} « ${escapeHtml(label)} » n'a pas pu être publié.`
        : `Votre ${kind} « ${escapeHtml(label)} » n'est parti que sur une partie des réseaux.`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
    <div style="font-size:12px;font-weight:600;color:${textColor};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(brand.name)} · Réseaux sociaux</div>
    <h1 style="margin:8px 0 0;font-size:20px;">${intro}</h1>
    ${excerpt}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">${rows}</table>
    <p style="margin:20px 0 0;font-size:13px;"><a href="${escapeHtml(appLink)}" style="color:${textColor};">Ouvrir le post dans l'outil</a></p>
  </div>
</div></body></html>`;

  return { subject, html };
}
