/**
 * Enrichissement d'un prospect à partir de son site web :
 * - email(s) de contact
 * - logo (og:image / icône)
 * - liens réseaux sociaux
 * - nom de la personne de contact (déduit par Gemini si possible)
 * Aucun scraping agressif : 1 page d'accueil + tentative /contact.
 */
import { geminiJSON } from "./gemini";

export type Enrichment = {
  emails: string[];
  socials: Record<string, string>;
  logo_url?: string;
  description?: string;
  contact_name?: string;
  pages_fetched: string[];
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "facebook",
  "instagram.com": "instagram",
  "linkedin.com": "linkedin",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "tiktok.com": "tiktok",
  "youtube.com": "youtube",
};

/** Résout `fallback` si la promesse ne répond pas dans le délai imparti. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      }
    );
  });
}

async function fetchHtml(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Tag2Share Prospect Bot)" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function absoluteUrl(base: string, href: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function extractFromHtml(html: string, baseUrl: string) {
  const emails = new Set<string>();
  const addEmail = (m: string) => {
    if (m && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(m)) emails.add(m.toLowerCase());
  };
  // Liens mailto: (parfois URL-encodés)
  for (const mm of html.match(/mailto:[^"'>\s]+/gi) || []) {
    try {
      const decoded = decodeURIComponent(mm.slice(7).split("?")[0]);
      const m = decoded.match(EMAIL_RE);
      if (m) m.forEach(addEmail);
    } catch {
      /* ignore */
    }
  }
  // Emails en clair dans le HTML
  for (const m of html.match(EMAIL_RE) || []) addEmail(m);

  const socials: Record<string, string> = {};
  const linkRe = /href=["']([^"']+)["']/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html))) {
    const href = lm[1];
    for (const [host, key] of Object.entries(SOCIAL_HOSTS)) {
      if (href.includes(host) && !socials[key]) {
        const abs = absoluteUrl(baseUrl, href);
        if (abs) socials[key] = abs;
      }
    }
  }

  // logo : og:image puis <link rel icon>
  let logo: string | undefined;
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );
  if (og) logo = absoluteUrl(baseUrl, og[1]);
  if (!logo) {
    const icon = html.match(
      /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i
    );
    if (icon) logo = absoluteUrl(baseUrl, icon[1]);
  }

  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );

  return {
    emails: [...emails],
    socials,
    logo,
    description: descMatch?.[1],
  };
}

/** Trouve les liens "contact / mentions légales / à propos" présents dans la page. */
function findContactLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const kw = /(contact|mentions|l[ée]gal|nous[- ]?[ée]crire|about|propos)/i;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (kw.test(href) || kw.test(text)) {
      const abs = absoluteUrl(baseUrl, href);
      if (abs && abs.startsWith("http")) out.push(abs);
    }
  }
  return out;
}

// Budget de temps total par prospect : garde l'enrichissement sous la limite
// d'exécution de la fonction (même un plan Vercel plafonné à 10 s).
const ENRICH_BUDGET_MS = 8000;

export async function enrichWebsite(
  website: string,
  businessName: string
): Promise<Enrichment> {
  const start = Date.now();
  const remaining = () => ENRICH_BUDGET_MS - (Date.now() - start);
  const result: Enrichment = { emails: [], socials: {}, pages_fetched: [] };

  const home = await fetchHtml(website, Math.min(4500, remaining()));
  const pages: string[] = [];
  if (home) {
    pages.push(website);
    const base = extractFromHtml(home, website);
    base.emails.forEach((e) => result.emails.push(e));
    Object.assign(result.socials, base.socials);
    result.logo_url = base.logo;
    result.description = base.description;
  }

  // Si pas d'email : suivre les VRAIS liens contact/légaux de la page d'accueil,
  // puis quelques chemins fréquents en secours. Pages testées EN PARALLÈLE et
  // plafonnées pour rester dans le budget de temps.
  if (result.emails.length === 0 && remaining() > 1500) {
    const candidates: string[] = [];
    if (home) candidates.push(...findContactLinks(home, website));
    for (const path of ["/contact", "/contactez-nous", "/contact-us", "/mentions-legales"]) {
      const u = absoluteUrl(website, path);
      if (u) candidates.push(u);
    }
    // dédoublonne, limite à 3 pages
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const u of candidates) {
      if (seen.has(u)) continue;
      seen.add(u);
      unique.push(u);
      if (unique.length >= 3) break;
    }
    const timeout = Math.min(4000, Math.max(1000, remaining() - 1500));
    const fetched = await Promise.all(
      unique.map(async (u) => ({ u, html: await fetchHtml(u, timeout) }))
    );
    for (const { u, html } of fetched) {
      if (!html) continue;
      pages.push(u);
      const c = extractFromHtml(html, u);
      c.emails.forEach((e) => result.emails.push(e));
      Object.assign(result.socials, c.socials);
    }
  }

  result.emails = [...new Set(result.emails)];
  result.pages_fetched = pages;

  // Déduction du nom de contact via Gemini (best effort, borné, n'échoue jamais le flux).
  if (home && remaining() > 1500) {
    const snippet = home.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000);
    const data = await withTimeout<{ contact_name?: string } | null>(
      geminiJSON<{ contact_name?: string }>(
        `Voici le texte du site de l'entreprise "${businessName}". Identifie le nom de la personne de contact (gérant, propriétaire, responsable) si mentionné. Réponds en JSON strict: {"contact_name": "Prénom Nom" | null}.\n\nTEXTE:\n${snippet}`
      ),
      Math.min(3000, remaining()),
      null
    );
    if (data?.contact_name) result.contact_name = data.contact_name;
  }

  return result;
}
