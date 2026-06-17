/**
 * Enrichissement d'un prospect à partir de son site web :
 * - email(s) de contact (dé-obfusqués, filtrés, triés par pertinence)
 * - téléphone
 * - logo (og:image / apple-touch-icon / icône)
 * - liens réseaux sociaux
 * - nom de la personne de contact (déduit par Gemini si possible)
 * Scraping léger : page d'accueil + pages contact/légales (plafonné en temps).
 */
import { promises as dns } from "dns";
import { geminiJSON } from "./gemini";
import {
  extractCompanyIds,
  lookupFrance,
  lookupVies,
  type RegistryInfo,
} from "./registry";

export type Enrichment = {
  emails: string[];
  phone?: string;
  socials: Record<string, string>;
  logo_url?: string;
  description?: string;
  contact_name?: string;
  contact_role?: string;
  company_number?: string; // n° d'entreprise BE (BCE) ou SIREN FR
  vat_number?: string;
  address?: string; // adresse postale officielle (registre)
  registry?: RegistryInfo;
  directors?: string[];
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

// Domaines/fragments d'emails techniques ou bidons à ignorer.
const EMAIL_BLOCKLIST = [
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "yourcompany.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "squarespace.com",
  "godaddy.com",
  "schema.org",
  "w3.org",
  "googleapis.com",
  "gstatic.com",
  "cloudflare.com",
  "jquery.com",
  "sentry.wixpress.com",
];
// Fournisseurs grand public : utilisables mais moins fiables qu'un domaine pro.
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.fr",
  "hotmail.be",
  "outlook.com",
  "outlook.fr",
  "outlook.be",
  "live.com",
  "live.fr",
  "live.be",
  "yahoo.com",
  "yahoo.fr",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "skynet.be",
  "telenet.be",
  "orange.fr",
  "free.fr",
  "wanadoo.fr",
  "laposte.net",
]);

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
      // User-Agent réaliste : certains sites bloquent les UA estampillés "bot".
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-BE,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    // On accepte aussi les types vides/mal déclarés mais on rejette binaires connus.
    if (ct && !/(text\/html|application\/xhtml|text\/plain|^$)/i.test(ct)) {
      if (/(image|application\/pdf|application\/octet|font|video|audio)/i.test(ct))
        return null;
    }
    return await res.text();
  } catch {
    return null;
  }
}

/** Tente la page d'accueil, avec repli https/http et www/non-www. */
async function fetchHomepage(
  website: string,
  timeoutMs: number
): Promise<{ html: string; url: string } | null> {
  const variants: string[] = [];
  const push = (u: string) => {
    if (!variants.includes(u)) variants.push(u);
  };
  push(website);
  try {
    const u = new URL(website);
    // bascule https si http
    if (u.protocol === "http:") {
      const https = new URL(website);
      https.protocol = "https:";
      push(https.toString());
    }
    // bascule www <-> sans www
    const alt = new URL(u.toString());
    alt.hostname = u.hostname.startsWith("www.")
      ? u.hostname.slice(4)
      : "www." + u.hostname;
    push(alt.toString());
  } catch {
    /* url invalide : on tentera tel quel */
  }
  for (const v of variants) {
    const html = await fetchHtml(v, timeoutMs);
    if (html) return { html, url: v };
  }
  return null;
}

function absoluteUrl(base: string, href: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function registrableDomain(urlOrHost: string): string {
  try {
    const host = urlOrHost.includes("://")
      ? new URL(urlOrHost).hostname
      : urlOrHost;
    return host.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlOrHost.replace(/^www\./, "").toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Données structurées JSON-LD (schema.org) : souvent les infos les plus fiables.
// ---------------------------------------------------------------------------

/** Aplatit récursivement les objets JSON-LD (gère les tableaux et @graph). */
function collectLdNodes(data: any, out: any[], depth = 0): void {
  if (!data || depth > 6) return;
  if (Array.isArray(data)) {
    for (const d of data) collectLdNodes(d, out, depth + 1);
    return;
  }
  if (typeof data === "object") {
    out.push(data);
    if (data["@graph"]) collectLdNodes(data["@graph"], out, depth + 1);
  }
}

/** Transforme une PostalAddress (ou chaîne) JSON-LD en adresse lisible. */
function ldAddressToString(addr: any): string | undefined {
  if (!addr) return undefined;
  if (typeof addr === "string") return addr.trim() || undefined;
  if (Array.isArray(addr)) return ldAddressToString(addr[0]);
  if (typeof addr === "object") {
    const country =
      typeof addr.addressCountry === "string"
        ? addr.addressCountry
        : addr.addressCountry?.name;
    const s = [
      addr.streetAddress,
      [addr.postalCode, addr.addressLocality].filter(Boolean).join(" "),
      addr.addressRegion,
      country,
    ]
      .filter(Boolean)
      .join(", ")
      .replace(/\s+/g, " ")
      .trim();
    return s || undefined;
  }
  return undefined;
}

function ldImageToString(img: any): string | undefined {
  if (!img) return undefined;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return ldImageToString(img[0]);
  if (typeof img === "object" && typeof img.url === "string") return img.url;
  return undefined;
}

// ---------------------------------------------------------------------------
// Validation de délivrabilité : on écarte les emails dont le domaine ne peut
// recevoir de courrier (ni MX, ni A). On NE pénalise PAS un échec transitoire.
// ---------------------------------------------------------------------------

type DnsVerdict = "yes" | "no" | "unknown";
function raceDns(fn: () => Promise<unknown[]>, ms = 2000): Promise<DnsVerdict> {
  return new Promise<DnsVerdict>((resolve) => {
    const t = setTimeout(() => resolve("unknown"), ms);
    fn().then(
      (r) => {
        clearTimeout(t);
        resolve(Array.isArray(r) && r.length ? "yes" : "no");
      },
      (e: any) => {
        clearTimeout(t);
        resolve(e?.code === "ENOTFOUND" || e?.code === "ENODATA" ? "no" : "unknown");
      }
    );
  });
}

const domainCache = new Map<string, Promise<boolean>>();
function domainDeliverable(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (!domainCache.has(key)) {
    domainCache.set(
      key,
      (async () => {
        const mx = await raceDns(() => dns.resolveMx(key));
        if (mx === "yes" || mx === "unknown") return true;
        const a = await raceDns(() => dns.resolve(key));
        return a !== "no"; // "yes" ou "unknown" -> on garde
      })()
    );
  }
  return domainCache.get(key)!;
}

/** Filtre les emails dont le domaine est avéré non délivrable (budget borné). */
async function filterDeliverable(
  emails: string[],
  budgetMs: number
): Promise<string[]> {
  if (emails.length === 0) return emails;
  const deadline = Date.now() + budgetMs;
  const out: string[] = [];
  for (const e of emails) {
    const domain = e.split("@")[1];
    if (!domain || Date.now() > deadline) {
      out.push(e); // budget dépassé : on garde plutôt que de risquer un faux négatif
      continue;
    }
    if (await domainDeliverable(domain)) out.push(e);
  }
  return out;
}

/** Décode les entités HTML et dé-obfusque les emails ([at], (dot), &#64;, …). */
function deobfuscate(html: string): string {
  let s = html;
  // Entités numériques : &#64; -> @, &#46; -> .
  s = s.replace(/&#0*64;/g, "@").replace(/&#0*46;/g, ".");
  s = s.replace(/&#x0*40;/gi, "@").replace(/&#x0*2e;/gi, ".");
  // Entités nommées courantes.
  s = s.replace(/&commat;/gi, "@").replace(/&period;/gi, ".");
  // Obfuscations textuelles : "nom [at] domaine [dot] com".
  s = s.replace(/\s*[\[({]?\s*(?:at|arobase|chez)\s*[\])}]?\s*/gi, "@");
  s = s.replace(/\s*[\[({]?\s*(?:dot|point)\s*[\])}]?\s*/gi, ".");
  return s;
}

function isJunkEmail(email: string): boolean {
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js)$/i.test(email)) return true;
  if (/^(noreply|no-reply|donotreply|mailer-daemon|postmaster)@/i.test(email))
    return true;
  const domain = email.split("@")[1] || "";
  if (EMAIL_BLOCKLIST.some((b) => domain === b || domain.endsWith("." + b)))
    return true;
  // local part qui ressemble à un hash/asset (uniquement hexa long).
  const local = email.split("@")[0] || "";
  if (/^[0-9a-f]{16,}$/i.test(local)) return true;
  return false;
}

/** Trie les emails : domaine du site d'abord, puis pro, puis grand public. */
function rankEmails(emails: string[], siteDomain: string): string[] {
  const score = (e: string): number => {
    const domain = e.split("@")[1] || "";
    const local = (e.split("@")[0] || "").toLowerCase();
    let s = 0;
    if (siteDomain && (domain === siteDomain || domain.endsWith("." + siteDomain)))
      s += 100;
    if (!FREE_PROVIDERS.has(domain)) s += 20;
    // boîtes de contact génériques mais exploitables
    if (/^(contact|info|hello|bonjour|sales|commercial|welcome|reservation|booking)/.test(local))
      s += 6;
    if (FREE_PROVIDERS.has(domain)) s -= 10;
    return s;
  };
  return [...new Set(emails)].sort((a, b) => score(b) - score(a));
}

/**
 * Réduit le bruit : on conserve l'email principal (le mieux classé) puis
 * uniquement les autres adresses du MÊME domaine (boîtes réelles de
 * l'entreprise : info@, contact@, jobs@…). Les adresses d'autres domaines
 * — agence web, placeholders, scripts tiers — sont écartées.
 */
function pruneEmails(ranked: string[]): string[] {
  if (ranked.length <= 1) return ranked;
  const primaryDomain = (ranked[0].split("@")[1] || "").toLowerCase();
  return ranked.filter(
    (e, i) => i === 0 || (e.split("@")[1] || "").toLowerCase() === primaryDomain
  );
}

const PHONE_RE =
  /(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{1,4}\)?[\s.\-]?){2,5}\d{2,4}/g;

/** Extrait un numéro de téléphone : liens tel: en priorité, sinon heuristique. */
function extractPhone(html: string): string | undefined {
  const tel = html.match(/href=["']tel:([^"']+)["']/i);
  if (tel) {
    const cleaned = decodeURIComponent(tel[1]).replace(/[^\d+]/g, "");
    if (cleaned.replace(/\D/g, "").length >= 7) return cleaned;
  }
  // Heuristique sur le texte (hors balises) pour limiter le bruit.
  const text = html.replace(/<[^>]+>/g, " ");
  for (const m of text.match(PHONE_RE) || []) {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 13) return m.trim();
  }
  return undefined;
}

function extractFromHtml(html: string, baseUrl: string) {
  // Pour les emails on retire scripts/styles/commentaires : ils contiennent
  // quantité de chaînes "x@y.z" (libs, sourcemaps, JSON) qui ne sont pas des
  // adresses réelles et polluaient la liste.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const deob = deobfuscate(cleaned);
  const emails = new Set<string>();
  const addEmail = (m: string) => {
    const e = m.toLowerCase();
    if (!isJunkEmail(e)) emails.add(e);
  };
  // Liens mailto: (parfois URL-encodés)
  for (const mm of deob.match(/mailto:[^"'>\s]+/gi) || []) {
    try {
      const decoded = decodeURIComponent(mm.slice(7).split("?")[0]);
      const m = decoded.match(EMAIL_RE);
      if (m) m.forEach(addEmail);
    } catch {
      /* ignore */
    }
  }
  // Emails en clair (après dé-obfuscation)
  for (const m of deob.match(EMAIL_RE) || []) addEmail(m);

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

  // logo : og:image, twitter:image, apple-touch-icon, puis <link rel icon>
  let logo: string | undefined;
  const metaImg =
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    );
  if (metaImg) logo = absoluteUrl(baseUrl, metaImg[1]);
  if (!logo) {
    const apple = html.match(
      /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i
    );
    if (apple) logo = absoluteUrl(baseUrl, apple[1]);
  }
  if (!logo) {
    const icon = html.match(
      /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i
    );
    if (icon) logo = absoluteUrl(baseUrl, icon[1]);
  }

  const descMatch =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    );

  // --- Données structurées JSON-LD (prioritaires car déclaratives) ---
  let address: string | undefined;
  let ldPhone: string | undefined;
  let ldLogo: string | undefined;
  let ldDescription: string | undefined;
  const contactNames: string[] = [];
  const ldRe =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lj: RegExpExecArray | null;
  const nodes: any[] = [];
  while ((lj = ldRe.exec(html))) {
    try {
      collectLdNodes(JSON.parse(lj[1].trim()), nodes);
    } catch {
      /* JSON-LD malformé : on ignore */
    }
  }
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const emailVals = Array.isArray(n.email) ? n.email : n.email ? [n.email] : [];
    for (const ev of emailVals)
      if (typeof ev === "string") addEmail(ev.replace(/^mailto:/i, ""));
    if (!ldPhone && typeof n.telephone === "string") ldPhone = n.telephone.trim();
    if (!address) address = ldAddressToString(n.address);
    if (!ldLogo) ldLogo = ldImageToString(n.logo);
    if (!ldDescription && typeof n.description === "string")
      ldDescription = n.description;
    const sameAs = Array.isArray(n.sameAs)
      ? n.sameAs
      : typeof n.sameAs === "string"
      ? [n.sameAs]
      : [];
    for (const url of sameAs) {
      if (typeof url !== "string") continue;
      for (const [host, key] of Object.entries(SOCIAL_HOSTS)) {
        if (url.includes(host) && !socials[key]) socials[key] = url;
      }
    }
    for (const key of ["founder", "employee", "member"]) {
      const v = (n as any)[key];
      const arr = Array.isArray(v) ? v : v ? [v] : [];
      for (const person of arr) {
        if (typeof person === "string") contactNames.push(person);
        else if (person && typeof person === "object" && typeof person.name === "string")
          contactNames.push(person.name);
      }
    }
  }
  if (ldLogo) logo = absoluteUrl(baseUrl, ldLogo) || logo;

  return {
    emails: [...emails],
    socials,
    logo,
    phone: ldPhone || extractPhone(html),
    address,
    contactNames,
    description: descMatch?.[1] || ldDescription,
  };
}

/** Trouve les liens "contact / mentions légales / à propos / équipe" de la page. */
function findContactLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const kw =
    /(contact|mentions|l[ée]gal|nous[- ]?[ée]crire|about|propos|[ée]quipe|team|impressum)/i;
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

// Budget de temps total pour le scraping web (le lookup registre est en plus).
const ENRICH_BUDGET_MS = 10000;

/** Texte brut (hors balises) d'une page, borné. */
function stripText(html: string, max = 6000): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, max);
}

export async function enrichWebsite(
  website: string,
  businessName: string,
  country?: string
): Promise<Enrichment> {
  const start = Date.now();
  const remaining = () => ENRICH_BUDGET_MS - (Date.now() - start);
  const result: Enrichment = { emails: [], socials: {}, pages_fetched: [] };
  const allEmails: string[] = [];
  const corpus: string[] = []; // texte cumulé pour repérer TVA / n° d'entreprise

  const homeRes = await fetchHomepage(website, Math.min(5000, remaining()));
  const home = homeRes?.html ?? null;
  const homeUrl = homeRes?.url ?? website;
  const siteDomain = registrableDomain(homeUrl);
  const pages: string[] = [];
  let contactText = "";
  let siteAddress: string | undefined; // adresse trouvée sur le site (JSON-LD)
  const ldNames: string[] = []; // dirigeants/fondateurs déclarés (JSON-LD)
  if (home) {
    pages.push(homeUrl);
    corpus.push(stripText(home));
    const base = extractFromHtml(home, homeUrl);
    allEmails.push(...base.emails);
    Object.assign(result.socials, base.socials);
    result.logo_url = base.logo;
    result.description = base.description;
    if (base.phone) result.phone = base.phone;
    if (base.address) siteAddress = base.address;
    ldNames.push(...base.contactNames);
  }

  // Suivre les pages contact/légales/équipe : on les visite TOUJOURS (pas
  // seulement en l'absence d'email) car elles portent souvent le téléphone,
  // le nom du contact et l'email pro. Plafonné en temps et en nombre.
  if (home && remaining() > 2500) {
    const candidates: string[] = [...findContactLinks(home, homeUrl)];
    for (const path of [
      "/contact",
      "/contactez-nous",
      "/contact-us",
      "/mentions-legales",
      "/a-propos",
      "/equipe",
    ]) {
      const u = absoluteUrl(homeUrl, path);
      if (u) candidates.push(u);
    }
    const unique: string[] = [];
    const seen = new Set<string>([homeUrl]);
    for (const u of candidates) {
      if (seen.has(u)) continue;
      seen.add(u);
      unique.push(u);
      if (unique.length >= 4) break;
    }
    const timeout = Math.min(4500, Math.max(1200, remaining() - 2000));
    const fetched = await Promise.all(
      unique.map(async (u) => ({ u, html: await fetchHtml(u, timeout) }))
    );
    for (const { u, html } of fetched) {
      if (!html) continue;
      pages.push(u);
      corpus.push(stripText(html));
      const c = extractFromHtml(html, u);
      allEmails.push(...c.emails);
      Object.assign(result.socials, c.socials);
      if (!result.phone && c.phone) result.phone = c.phone;
      if (!siteAddress && c.address) siteAddress = c.address;
      ldNames.push(...c.contactNames);
      // texte de la 1re page contact pour aider Gemini à trouver le contact
      if (!contactText && /contact|propos|equipe|about|team/i.test(u)) {
        contactText = stripText(html, 4000);
      }
    }
  }

  result.pages_fetched = pages;
  if (siteAddress) result.address = siteAddress;

  // N° d'entreprise / TVA repérés dans le texte (mentions légales, footer…).
  const ids = extractCompanyIds(corpus.join(" \n "), country);
  if (ids.companyNumber) result.company_number = ids.companyNumber;
  if (ids.vatNumber) result.vat_number = ids.vatNumber;

  // Nom de contact déclaré en JSON-LD (founder/employee) : signal fiable.
  const ldName = ldNames.find((n) => /\s/.test(n.trim()));
  if (ldName) result.contact_name = ldName.trim();

  // Repli LLM : Gemini complète ce qui manque (nom, rôle, email, tél, adresse).
  // On ne lui fait confiance pour un email/tél QUE s'il apparaît dans le texte
  // (garde-fou anti-hallucination).
  const corpusText = corpus.join(" ");
  if (home && remaining() > 1500) {
    const homeText = stripText(home, 5000);
    const snippet = contactText
      ? `${homeText}\n\n[PAGE CONTACT]\n${contactText}`
      : homeText;
    const data = await withTimeout<{
      contact_name?: string;
      contact_role?: string;
      email?: string;
      phone?: string;
      address?: string;
    } | null>(
      geminiJSON<{
        contact_name?: string;
        contact_role?: string;
        email?: string;
        phone?: string;
        address?: string;
      }>(
        `Voici le texte du site de l'entreprise "${businessName}". Extrais les informations de contact réellement présentes. Réponds en JSON strict: {"contact_name": "Prénom Nom" | null, "contact_role": "fonction" | null, "email": "adresse email | null", "phone": "téléphone | null", "address": "adresse postale complète | null"}.\n\nTEXTE:\n${snippet}`
      ),
      Math.min(3500, remaining()),
      null
    );
    if (data?.email) {
      const e = data.email.toLowerCase().trim();
      if (
        /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) &&
        !isJunkEmail(e) &&
        corpusText.toLowerCase().includes(e)
      )
        allEmails.push(e);
    }
    if (!result.phone && data?.phone) result.phone = data.phone.trim();
    if (!result.address && data?.address) result.address = data.address.trim();
    if (!result.contact_name && data?.contact_name) result.contact_name = data.contact_name;
    if (data?.contact_role) result.contact_role = data.contact_role;
  }

  // Finalisation des emails : classement, réduction au domaine principal, puis
  // validation de délivrabilité (MX/A) sur le temps restant.
  const ranked = pruneEmails(rankEmails(allEmails, siteDomain));
  result.emails =
    remaining() > 800 ? await filterDeliverable(ranked, remaining() - 300) : ranked;

  return result;
}

function countryCode(country?: string): "BE" | "FR" | undefined {
  if (country === "Belgique" || country === "BE") return "BE";
  if (country === "France" || country === "FR") return "FR";
  return undefined;
}

export type ProspectInput = {
  name: string;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

/**
 * Enrichissement complet d'un prospect :
 *  1. scraping du site web (si connu)
 *  2. lookup registre officiel (VIES pour la BE, recherche-entreprises pour la FR)
 *  3. si le registre révèle un site web qu'on n'avait pas → on relance le scraping
 *  4. complète l'adresse postale et les données légales.
 */
export async function enrichProspect(p: ProspectInput): Promise<Enrichment> {
  const cc = countryCode(p.country || undefined);

  let result: Enrichment = p.website
    ? await enrichWebsite(p.website, p.name, p.country || undefined)
    : { emails: [], socials: {}, pages_fetched: [] };

  // --- Lookup registre officiel ---
  let reg: RegistryInfo | null = null;
  if (cc === "BE" && result.company_number) {
    reg = await lookupVies(result.company_number);
  } else if (cc === "FR") {
    reg = await lookupFrance({
      siren: result.company_number,
      name: p.name,
      city: p.city || undefined,
    });
  }

  if (reg) {
    result.registry = reg;
    result.company_number = result.company_number || reg.company_number;
    result.vat_number = result.vat_number || reg.vat_number;
    if (reg.directors) result.directors = reg.directors;
  }

  // --- Adresse postale : prospect d'abord, sinon registre ---
  result.address = p.address || reg?.address || result.address;

  // --- Re-scraping si un site web apparaît alors qu'on n'en avait pas ---
  const discovered = reg?.website;
  if (discovered && !p.website) {
    const extra = await enrichWebsite(discovered, p.name, p.country || undefined);
    result = mergeEnrichment(result, extra);
  }

  return result;
}

/** Fusionne deux enrichissements (le 1er prime sur les scalaires déjà remplis). */
function mergeEnrichment(a: Enrichment, b: Enrichment): Enrichment {
  return {
    emails: pruneEmails([...new Set([...a.emails, ...b.emails])]),
    phone: a.phone || b.phone,
    socials: { ...b.socials, ...a.socials },
    logo_url: a.logo_url || b.logo_url,
    description: a.description || b.description,
    contact_name: a.contact_name || b.contact_name,
    contact_role: a.contact_role || b.contact_role,
    company_number: a.company_number || b.company_number,
    vat_number: a.vat_number || b.vat_number,
    address: a.address || b.address,
    registry: a.registry || b.registry,
    directors: a.directors || b.directors,
    pages_fetched: [...new Set([...a.pages_fetched, ...b.pages_fetched])],
  };
}
