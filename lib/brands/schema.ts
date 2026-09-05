/**
 * Validation d'un BrandConfig venu de l'EXTÉRIEUR (formulaire de création,
 * corps d'une requête API, ligne JSONB relue en base).
 *
 * TypeScript ne protège que le code écrit à la main : une marque créée dans
 * l'interface arrive en `unknown`, et une marque mal formée casse l'envoi
 * d'emails, pas la compilation. Ce module est donc l'unique porte d'entrée -
 * le formulaire s'en sert pour afficher les erreurs avant l'envoi, l'API pour
 * refuser l'écriture, et le registre pour écarter une ligne devenue invalide.
 *
 * Client-safe : aucun secret, aucune lecture de process.env, aucun accès base.
 */
import type {
  BrandConfig,
  BrandTheme,
  EmailLayoutKey,
  Product,
  SocialLink,
} from "./types";

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Propose un slug à partir d'un nom saisi. Simple confort de formulaire : le
 * résultat reste modifiable, et c'est SLUG_RE qui fait foi.
 */
export function slugify(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const LAYOUTS: EmailLayoutKey[] = ["classic", "minimal"];

/** Une erreur = un chemin de champ + un message affichable tel quel. */
export type FieldError = { path: string; message: string };

export type ParseResult =
  | { ok: true; brand: BrandConfig }
  | { ok: false; errors: FieldError[] };

/* ------------------------------------------------------------------ */
/* Petits lecteurs typés                                               */
/* ------------------------------------------------------------------ */

class Collector {
  readonly errors: FieldError[] = [];
  add(path: string, message: string) {
    this.errors.push({ path, message });
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(c: Collector, v: unknown, path: string, label: string, opts?: { max?: number }): string {
  if (typeof v !== "string" || !v.trim()) {
    c.add(path, `${label} est obligatoire.`);
    return "";
  }
  const t = v.trim();
  if (opts?.max && t.length > opts.max) {
    c.add(path, `${label} dépasse ${opts.max} caractères.`);
  }
  return t;
}

/** Chaîne facultative : "" et absent sont équivalents (= pas de valeur). */
function optStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * URL absolue en http(s). On refuse les autres schémas : ces valeurs
 * atterrissent dans un `href` d'email (`javascript:`, `data:`) ou dans un
 * `src` d'image.
 */
function url(c: Collector, v: unknown, path: string, label: string, required = true): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) {
    if (required) c.add(path, `${label} est obligatoire.`);
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    c.add(path, `${label} : adresse invalide (attendu https://...).`);
    return raw;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    c.add(path, `${label} : seuls http et https sont acceptés.`);
  }
  return raw;
}

/**
 * Adresse email. Règle identique à lib/brand-sender.ts (isValidEmail), qui ne
 * peut pas être importée ici : ce module est chargé par le navigateur.
 */
function email(c: Collector, v: unknown, path: string, label: string, required = true): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) {
    if (required) c.add(path, `${label} est obligatoire.`);
    return "";
  }
  const valid =
    raw.length <= 254 && !/[\s<>,;"\r\n]/.test(raw) && /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(raw);
  if (!valid) c.add(path, `${label} : adresse email invalide.`);
  return raw;
}

function int(
  c: Collector,
  v: unknown,
  path: string,
  label: string,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    c.add(path, `${label} doit être un nombre entier.`);
    return fallback;
  }
  if (n < min || n > max) {
    c.add(path, `${label} doit être compris entre ${min} et ${max}.`);
    return fallback;
  }
  return n;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Liste de chaînes non vides, dédoublonnée, ordre conservé. */
function strList(v: unknown, max = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list(v)) {
    const t = typeof item === "string" ? item.trim() : "";
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Couleurs                                                            */
/* ------------------------------------------------------------------ */

/** `#1a2b3c` ou `#abc` → [r,g,b]. undefined si la chaîne n'est pas un hex. */
export function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** [r,g,b] → `#1a2b3c`, format attendu par `<input type="color">`. */
export function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Triplet RVB accepté sous deux formes : `[r,g,b]` (forme stockée) ou une
 * chaîne hex (forme saisie par le sélecteur de couleur du formulaire).
 */
function rgb(
  c: Collector,
  v: unknown,
  path: string,
  label: string,
  required: boolean
): [number, number, number] | undefined {
  if (typeof v === "string") {
    const parsed = hexToRgb(v);
    if (!parsed) {
      c.add(path, `${label} : couleur invalide (attendu #rrggbb).`);
      return undefined;
    }
    return parsed;
  }
  if (Array.isArray(v) && v.length === 3) {
    const out = v.map((n) => Number(n));
    if (out.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
      return out.map((n) => Math.round(n)) as [number, number, number];
    }
    c.add(path, `${label} : chaque composante doit être comprise entre 0 et 255.`);
    return undefined;
  }
  if (required) c.add(path, `${label} est obligatoire.`);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Domaines                                                            */
/* ------------------------------------------------------------------ */

/**
 * Normalise un domaine : `https://www.Exemple.com/boutique` → `exemple.com`.
 * Ces valeurs pilotent l'ajout des paramètres UTM (lib/email.ts) : un domaine
 * mal saisi ne casse rien, il fait juste perdre le suivi des liens.
 */
export function normalizeDomain(raw: string): string {
  let v = (raw || "").trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return v.split(/[?#]/)[0].replace(/\.$/, "");
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function domains(c: Collector, v: unknown, path: string): string[] {
  const out: string[] = [];
  for (const item of strList(v)) {
    const d = normalizeDomain(item);
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) {
      c.add(path, `Domaine invalide : « ${item} ».`);
      continue;
    }
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sous-objets                                                         */
/* ------------------------------------------------------------------ */

function parseTheme(c: Collector, v: unknown): BrandTheme {
  const o = isObject(v) ? v : {};
  const base = rgb(c, o.rgb, "theme.rgb", "La couleur de signature", true) ?? [20, 74, 102];
  const text = rgb(c, o.textRgb, "theme.textRgb", "La couleur de texte", false);
  const onBrand = optStr(o.onBrandHex);
  if (onBrand && !hexToRgb(onBrand)) {
    c.add("theme.onBrandHex", "La couleur posée sur la marque doit être un hex (#rrggbb).");
  }
  return {
    rgb: base,
    ...(text ? { textRgb: text } : {}),
    ...(onBrand ? { onBrandHex: onBrand } : {}),
    logoUrl: url(c, o.logoUrl, "theme.logoUrl", "L'adresse du logo"),
    logoAlt: str(c, o.logoAlt, "theme.logoAlt", "Le texte alternatif du logo", { max: 120 }),
    logoWidth: int(c, o.logoWidth, "theme.logoWidth", "La largeur du logo", {
      min: 40,
      max: 600,
      fallback: 140,
    }),
    monogram: str(c, o.monogram, "theme.monogram", "Le monogramme", { max: 3 }).toUpperCase(),
  };
}

function parseSocials(c: Collector, v: unknown): SocialLink[] {
  return list(v).flatMap((item, i): SocialLink[] => {
    const o = isObject(item) ? item : {};
    const label = optStr(o.label);
    const href = optStr(o.url);
    // Une ligne entièrement vide est une ligne que l'utilisateur a ajoutée
    // puis laissée de côté : on l'ignore plutôt que d'exiger sa suppression.
    if (!label && !href) return [];
    return [
      {
        label: str(c, o.label, `email.socials.${i}.label`, "Le libellé du réseau social", { max: 40 }),
        url: url(c, o.url, `email.socials.${i}.url`, `L'adresse du réseau social « ${label ?? i} »`),
      },
    ];
  });
}

function parseProducts(c: Collector, v: unknown): Product[] {
  const raw = list(v);
  if (raw.length === 0) {
    c.add("products", "Une marque doit avoir au moins un produit : c'est lui qui alimente les tokens {{product_*}} de l'email.");
    return [];
  }
  const seen = new Set<string>();
  return raw.map((item, i): Product => {
    const o = isObject(item) ? item : {};
    const p = `products.${i}`;
    const key = str(c, o.key, `${p}.key`, `La clé du produit n°${i + 1}`, { max: 40 }).toLowerCase();
    if (key && !SLUG_RE.test(key)) {
      c.add(`${p}.key`, `Clé de produit invalide : « ${key} » (minuscules, chiffres et tirets).`);
    }
    // Les clés sont stockées telles quelles dans segments.product et
    // email_log.product_key : deux produits homonymes rendraient la résolution
    // d'un email déjà envoyé ambiguë.
    if (key && seen.has(key)) c.add(`${p}.key`, `Clé de produit en double : « ${key} ».`);
    seen.add(key);
    return {
      key,
      name: str(c, o.name, `${p}.name`, `Le nom du produit n°${i + 1}`, { max: 80 }),
      ...(optStr(o.uiLabel) ? { uiLabel: optStr(o.uiLabel)! } : {}),
      ...(optStr(o.price) ? { price: optStr(o.price)! } : {}),
      shopUrl: url(c, o.shopUrl, `${p}.shopUrl`, `L'adresse boutique du produit n°${i + 1}`),
      configUrl: url(c, o.configUrl, `${p}.configUrl`, `L'adresse de configuration du produit n°${i + 1}`),
      description: str(c, o.description, `${p}.description`, `La description du produit n°${i + 1}`, { max: 600 }),
      pitch: str(c, o.pitch, `${p}.pitch`, `L'accroche du produit n°${i + 1}`, { max: 300 }),
      ...(strList(o.aliases, 20).length ? { aliases: strList(o.aliases, 20) } : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Entrée principale                                                   */
/* ------------------------------------------------------------------ */

/**
 * Valide et NORMALISE un BrandConfig arbitraire. Renvoie toutes les erreurs
 * d'un coup, pas la première : corriger un formulaire champ par champ, avec un
 * aller-retour réseau à chaque fois, est insupportable.
 *
 * Les champs `*Env` de `sender` sont volontairement IGNORÉS : ils nomment une
 * variable d'environnement lue côté serveur, et laisser une valeur venue de la
 * base désigner n'importe quelle variable ferait fuiter des secrets dans les
 * en-têtes d'un email. Les marques déclarées en code gardent cette faculté.
 */
export function parseBrandConfig(input: unknown): ParseResult {
  const c = new Collector();
  const o = isObject(input) ? input : {};

  const slug = str(c, o.slug, "slug", "L'identifiant (slug)", { max: 40 }).toLowerCase();
  if (slug && !SLUG_RE.test(slug)) {
    c.add(
      "slug",
      `Identifiant invalide : « ${slug} ». Minuscules, chiffres et tirets, 40 caractères max, sans tiret en début ni en fin.`
    );
  }

  const senderRaw = isObject(o.sender) ? o.sender : {};
  const identityRaw = isObject(senderRaw.identity) ? senderRaw.identity : {};
  const emailRaw = isObject(o.email) ? o.email : {};
  const defaultsRaw = isObject(o.defaults) ? o.defaults : {};
  const aiRaw = isObject(o.ai) ? o.ai : {};

  const layout = optStr(emailRaw.layout) ?? "classic";
  if (!LAYOUTS.includes(layout as EmailLayoutKey)) {
    c.add("email.layout", `Gabarit d'email inconnu : « ${layout} ». Attendu : ${LAYOUTS.join(" ou ")}.`);
  }

  const products = parseProducts(c, o.products);
  const defaultProductKey = optStr(o.defaultProductKey);
  if (defaultProductKey && !products.some((p) => p.key === defaultProductKey)) {
    c.add("defaultProductKey", `Le produit présélectionné « ${defaultProductKey} » n'est pas dans le catalogue.`);
  }

  const brand: BrandConfig = {
    slug,
    name: str(c, o.name, "name", "Le nom de la marque", { max: 80 }),
    // La tagline est un sous-titre d'interface : une marque a le droit de ne
    // pas en avoir.
    tagline: optStr(o.tagline) ?? "",
    domains: domains(c, o.domains, "domains"),
    ...(optStr(o.appUrl)
      ? { appUrl: url(c, o.appUrl, "appUrl", "L'URL publique de l'outil", false).replace(/\/+$/, "") }
      : {}),
    theme: parseTheme(c, o.theme),
    shopUrl: url(c, o.shopUrl, "shopUrl", "L'adresse de la boutique"),
    email: {
      layout: (LAYOUTS.includes(layout as EmailLayoutKey) ? layout : "classic") as EmailLayoutKey,
      socials: parseSocials(c, emailRaw.socials),
      showProductsMore: emailRaw.showProductsMore !== false,
    },
    sender: {
      ...(optStr(senderRaw.fromName) ? { fromName: optStr(senderRaw.fromName)! } : {}),
      from: email(c, senderRaw.from, "sender.from", "L'adresse d'envoi"),
      replyTo: email(c, senderRaw.replyTo, "sender.replyTo", "L'adresse de réponse"),
      ...(optStr(senderRaw.testEmail)
        ? { testEmail: email(c, senderRaw.testEmail, "sender.testEmail", "L'adresse de test", false) }
        : {}),
      identity: {
        name: str(c, identityRaw.name, "sender.identity.name", "La raison sociale affichée en pied d'email", { max: 120 }),
        ...(optStr(identityRaw.address) ? { address: optStr(identityRaw.address)! } : {}),
        contact: str(c, identityRaw.contact, "sender.identity.contact", "Le contact affiché en pied d'email", { max: 200 }),
      },
      dailyCap: int(c, senderRaw.dailyCap ?? 20, "sender.dailyCap", "Le plafond quotidien", {
        min: 0,
        max: 100000,
        fallback: 20,
      }),
      delayMs: int(c, senderRaw.delayMs ?? 1500, "sender.delayMs", "Le délai entre deux envois", {
        min: 0,
        max: 600000,
        fallback: 1500,
      }),
    },
    defaults: {
      subject: str(c, defaultsRaw.subject, "defaults.subject", "L'objet par défaut", { max: 300 }),
      body: str(c, defaultsRaw.body, "defaults.body", "Le corps d'email par défaut"),
      tagline: optStr(defaultsRaw.tagline) ?? "",
    },
    products,
    ...(defaultProductKey ? { defaultProductKey } : {}),
    ai: {
      positioning: str(c, aiRaw.positioning, "ai.positioning", "Le positionnement pour l'IA", { max: 1200 }),
      signature: str(c, aiRaw.signature, "ai.signature", "La signature d'email", { max: 120 }),
      ...(strList(aiRaw.forbidden, 40).length ? { forbidden: strList(aiRaw.forbidden, 40) } : {}),
    },
  };

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, brand };
}

/** Les erreurs sur une seule ligne, pour un message d'API. */
export function formatErrors(errors: FieldError[]): string {
  return errors.map((e) => `${e.path} : ${e.message}`).join(" ");
}
