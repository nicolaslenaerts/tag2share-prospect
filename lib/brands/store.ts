/**
 * Registre EFFECTIF des marques. La BASE fait foi (table `brands`).
 *
 * Trois provenances possibles, dans cet ordre :
 *
 *  1. Les lignes de la table. C'est le cas normal depuis la migration 0013 :
 *     toutes les marques, Tag2Share et Horodo comprises, y vivent et se
 *     modifient dans /marques.
 *
 *  2. Le tableau BRANDS de lib/brands/index.ts, VIDE aujourd'hui. Une marque
 *     qui y figurerait aurait autorité sur la ligne de base du même slug, qui
 *     serait alors ignorée à la lecture et refusée à l'écriture. Réservé au cas
 *     où l'on voudrait délibérément soustraire une marque à l'interface.
 *
 *  3. Les configurations d'origine (SEED_BRANDS), UNIQUEMENT si la base ne
 *     fournit aucune marque. Canot de sauvetage, jamais un mélange : voir
 *     seedRecords.
 *
 * ⚠️ Module SERVEUR (Supabase) : ne jamais l'importer depuis un composant
 * client. Les composants clients reçoivent la marque déjà résolue, sérialisée
 * par app/layout.tsx.
 */
import { supabaseAdmin } from "../supabase";
import { BRANDS, DEFAULT_BRAND_SLUG, SEED_BRANDS } from "./index";
import { formatErrors, parseBrandConfig, SLUG_RE, type FieldError } from "./schema";
import type { BrandConfig } from "./types";

export type BrandSource = "code" | "db";

export type BrandRecord = {
  brand: BrandConfig;
  source: BrandSource;
  /** Autorisation d'ENVOI RÉEL. Une marque venue du code est active d'office. */
  active: boolean;
  updatedAt?: string;
};

type BrandRow = {
  slug: string;
  config: unknown;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

/* ------------------------------------------------------------------ */
/* Tolérance à la migration non appliquée                              */
/* ------------------------------------------------------------------ */

/**
 * Même posture que lib/brand-sender.ts : tant que la migration 0012 n'est pas
 * jouée, l'application doit continuer de tourner sur ses marques en code.
 * `42P01` est le code PostgreSQL, `PGRST205` celui des versions récentes de
 * PostgREST utilisées par Supabase.
 */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  const m = (error.message || "").toLowerCase();
  return (
    m.includes("'brands'") ||
    (m.includes("brands") &&
      (m.includes("does not exist") || m.includes("could not find the table")))
  );
}

let warnedMissing = false;

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/**
 * Le registre est relu à presque chaque requête (résolution de la marque
 * active). Un cache très court évite une lecture Supabase par requête sans
 * rendre l'interface poussive : après un enregistrement on invalide, et sur
 * une autre instance serverless la fenêtre de décalage reste sous ce délai.
 *
 * Les chemins qui ENVOIENT de vrais emails demandent explicitement `fresh`
 * (voir requireSendableBrand) : une marque désactivée il y a trois secondes ne
 * doit pas pouvoir écrire à un prospect.
 */
const TTL_MS = 10_000;
let cache: { at: number; records: BrandRecord[] } | null = null;

export function invalidateBrandCache(): void {
  cache = null;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

const asRecords = (brands: BrandConfig[]): BrandRecord[] =>
  brands.map((brand) => ({ brand, source: "code" as const, active: true }));

let warnedSeed = false;

/**
 * Registre de secours, quand la base ne fournit AUCUNE marque : table absente,
 * variables Supabase manquantes, ou table vide avant la migration 0013.
 *
 * Ce repli ne s'applique jamais quand des lignes existent, même invalides.
 * Substituer les configurations d'origine à des lignes que quelqu'un vient de
 * modifier ferait partir des emails sous une identité que l'opérateur croyait
 * avoir changée : mieux vaut une marque manquante et bruyante qu'une marque
 * silencieusement périmée.
 */
function seedRecords(reason: string): BrandRecord[] {
  if (!warnedSeed) {
    warnedSeed = true;
    console.warn(
      `Aucune marque en base (${reason}) : repli sur les configurations d'origine ` +
        "de lib/brands/. Elles sont en lecture seule et ne reflètent pas les " +
        "modifications faites dans /marques."
    );
  }
  return asRecords(SEED_BRANDS);
}

async function fetchRows(): Promise<BrandRow[] | null> {
  let db: ReturnType<typeof supabaseAdmin>;
  try {
    db = supabaseAdmin();
  } catch {
    // Variables Supabase absentes. Le cas se produit pendant `next build`, où
    // le layout est prérendu sans secrets : le registre doit alors se réduire
    // aux marques en code plutôt que de faire échouer la construction. Une
    // erreur de REQUÊTE, elle, continue de remonter (voir plus bas) : elle
    // signale une base joignable qui refuse, ce qui n'est pas la même chose.
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(
        "Variables Supabase absentes : seules les marques déclarées en code sont disponibles."
      );
    }
    return null;
  }
  const { data, error } = await db.from("brands").select("*").order("created_at");
  if (error) {
    if (isMissingTable(error)) {
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn(
          "Table `brands` absente : migration 0012_brands.sql non appliquée. " +
            "Seules les marques déclarées en code sont disponibles."
        );
      }
      return null;
    }
    throw new Error(`Lecture du registre des marques impossible : ${error.message}`);
  }
  return (data ?? []) as BrandRow[];
}

/**
 * Registre complet, marques en code d'abord, puis les lignes de base dans leur
 * ordre de création (cet ordre pilote l'affichage du sélecteur).
 *
 * Une ligne de base illisible est ÉCARTÉE plutôt que de faire échouer tout le
 * registre : une seule marque mal formée ne doit pas empêcher les autres
 * d'envoyer. Elle reste visible et réparable dans /marques, qui lit les lignes
 * brutes (voir listBrandRows).
 */
export async function loadBrandRecords(opts?: { fresh?: boolean }): Promise<BrandRecord[]> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.records;

  const rows = await fetchRows();
  if (rows === null) return (cache = { at: Date.now(), records: seedRecords("base injoignable") }).records;
  if (rows.length === 0 && BRANDS.length === 0) {
    return (cache = { at: Date.now(), records: seedRecords("table vide") }).records;
  }

  const records = asRecords(BRANDS);
  const taken = new Set(records.map((r) => r.brand.slug));

  for (const row of rows) {
    if (taken.has(row.slug)) {
      console.warn(
        `Marque « ${row.slug} » ignorée : ce slug appartient à une marque déclarée en code.`
      );
      continue;
    }
    const parsed = parseBrandConfig(row.config);
    if (!parsed.ok) {
      console.warn(
        `Marque « ${row.slug} » ignorée (configuration invalide) : ${formatErrors(parsed.errors)}`
      );
      continue;
    }
    // Le slug fait foi côté base : c'est lui qui est en clé primaire et dans
    // les colonnes `brand` des autres tables.
    records.push({
      brand: { ...parsed.brand, slug: row.slug },
      source: "db",
      active: row.active === true,
      updatedAt: row.updated_at,
    });
    taken.add(row.slug);
  }

  cache = { at: Date.now(), records };
  return records;
}

/** Toutes les marques utilisables, actives ou non. */
export async function loadBrands(): Promise<BrandConfig[]> {
  return (await loadBrandRecords()).map((r) => r.brand);
}

export async function findBrandRecord(
  slug?: string | null,
  opts?: { fresh?: boolean }
): Promise<BrandRecord | undefined> {
  if (!slug) return undefined;
  const s = String(slug).trim().toLowerCase();
  return (await loadBrandRecords(opts)).find((r) => r.brand.slug === s);
}

/** Recherche stricte : undefined si le slug est inconnu. */
export async function resolveBrand(slug?: string | null): Promise<BrandConfig | undefined> {
  return (await findBrandRecord(slug))?.brand;
}

/**
 * Résolution stricte, à utiliser partout où une erreur d'identité serait grave
 * (rendu et envoi d'email) : mieux vaut échouer que d'envoyer sous la mauvaise
 * marque.
 */
export async function resolveBrandStrict(slug?: string | null): Promise<BrandConfig> {
  const records = await loadBrandRecords();
  const s = String(slug ?? "").trim().toLowerCase();
  const found = records.find((r) => r.brand.slug === s);
  if (!found) {
    throw new Error(
      `Marque inconnue : "${slug}". Marques disponibles : ${records
        .map((r) => r.brand.slug)
        .join(", ")}.`
    );
  }
  return found.brand;
}

/**
 * Marque retenue en l'absence d'indication : celle portant DEFAULT_BRAND_SLUG,
 * sinon la première du registre.
 *
 * Lève si le registre est vide. Ce cas ne devrait pas se produire - le repli
 * sur les configurations d'origine l'empêche - et le taire ferait rendre des
 * pages sans identité de marque du tout.
 */
export async function defaultBrand(): Promise<BrandConfig> {
  const records = await loadBrandRecords();
  const wanted = records.find((r) => r.brand.slug === DEFAULT_BRAND_SLUG);
  if (wanted) return wanted.brand;
  if (records[0]) return records[0].brand;
  throw new Error(
    "Aucune marque disponible : la table `brands` est vide et aucune marque n'est déclarée en code."
  );
}

/** Résolution tolérante : repli sur la marque par défaut si slug absent/inconnu. */
export async function resolveBrandOrDefault(slug?: string | null): Promise<BrandConfig> {
  return (await resolveBrand(slug)) ?? (await defaultBrand());
}

/**
 * Marque autorisée à envoyer DE VRAIS emails. Lecture non mise en cache : une
 * désactivation doit prendre effet immédiatement, y compris au milieu d'une
 * session d'envoi.
 */
export async function resolveSendableBrand(slug?: string | null): Promise<BrandConfig> {
  const record = await findBrandRecord(slug, { fresh: true });
  if (!record) {
    throw new Error(`Marque inconnue : "${slug}".`);
  }
  if (!record.active) {
    throw new Error(
      `La marque « ${record.brand.name} » est en brouillon : l'envoi réel est bloqué. ` +
        "Activez-la dans Marques une fois son domaine vérifié chez Resend."
    );
  }
  return record.brand;
}

/** Liste légère pour le sélecteur de marque de l'UI. */
export async function brandOptions(): Promise<
  { slug: string; name: string; monogram: string; active: boolean; source: BrandSource }[]
> {
  return (await loadBrandRecords()).map((r) => ({
    slug: r.brand.slug,
    name: r.brand.name,
    monogram: r.brand.theme.monogram,
    active: r.active,
    source: r.source,
  }));
}

/**
 * Lignes BRUTES pour l'écran d'administration : contrairement à
 * loadBrandRecords, une configuration invalide n'est pas écartée mais renvoyée
 * avec ses erreurs, sinon une marque cassée deviendrait irréparable.
 */
export type BrandRowView = {
  slug: string;
  source: BrandSource;
  active: boolean;
  /** Configuration brute, telle que stockée. Seule chose exploitable si elle est invalide. */
  config: unknown;
  /** Configuration validée. Absente si la ligne est invalide. */
  brand?: BrandConfig;
  errors?: FieldError[];
  updatedAt?: string;
};

export async function listBrandRows(): Promise<BrandRowView[]> {
  const rows = await fetchRows();
  const codeBrands = rows === null || rows.length === 0 ? (BRANDS.length ? BRANDS : SEED_BRANDS) : BRANDS;
  const out: BrandRowView[] = codeBrands.map((brand) => ({
    slug: brand.slug,
    source: "code",
    active: true,
    config: brand,
    brand,
  }));
  const codeSlugs = new Set(out.map((o) => o.slug));

  for (const row of rows ?? []) {
    if (codeSlugs.has(row.slug)) continue;
    const parsed = parseBrandConfig(row.config);
    out.push({
      slug: row.slug,
      source: "db",
      active: row.active === true,
      config: row.config,
      ...(parsed.ok ? { brand: { ...parsed.brand, slug: row.slug } } : { errors: parsed.errors }),
      updatedAt: row.updated_at,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

export class BrandWriteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Une marque déclarée en code n'est pas modifiable depuis l'interface. */
function assertWritable(slug: string): void {
  if (BRANDS.some((b) => b.slug === slug)) {
    throw new BrandWriteError(
      `La marque « ${slug} » est déclarée en code (lib/brands/${slug}.ts) : elle se modifie dans le dépôt, pas ici.`,
      409
    );
  }
}

/** Slugs que l'on ne laisse pas prendre : ils entreraient en collision avec les routes. */
const RESERVED_SLUGS = new Set(["nouvelle", "new", "api", "admin"]);

/**
 * Crée une marque. Elle naît INACTIVE : on peut tout préparer, mais pas encore
 * écrire à de vrais prospects.
 */
export async function createBrand(input: unknown): Promise<BrandRecord> {
  const parsed = parseBrandConfig(input);
  if (!parsed.ok) throw new BrandWriteError(formatErrors(parsed.errors));

  const { slug } = parsed.brand;
  if (!SLUG_RE.test(slug)) throw new BrandWriteError(`Identifiant invalide : « ${slug} ».`);
  if (RESERVED_SLUGS.has(slug)) throw new BrandWriteError(`L'identifiant « ${slug} » est réservé.`);
  assertWritable(slug);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("brands")
    .insert({ slug, config: parsed.brand, active: false })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new BrandWriteError(`La marque « ${slug} » existe déjà.`, 409);
    }
    throw new BrandWriteError(error.message, 500);
  }
  invalidateBrandCache();
  const row = data as BrandRow;
  return { brand: parsed.brand, source: "db", active: row.active, updatedAt: row.updated_at };
}

/**
 * Met à jour la configuration d'une marque de base.
 *
 * Le slug est IMMUABLE : il est recopié dans segments.brand, campaigns.brand,
 * email_log.brand et dans les liens de désinscription déjà partis. Le changer
 * orphelinerait tout cela en silence.
 */
export async function updateBrand(slug: string, input: unknown): Promise<BrandRecord> {
  assertWritable(slug);
  const parsed = parseBrandConfig({ ...(input as object), slug });
  if (!parsed.ok) throw new BrandWriteError(formatErrors(parsed.errors));

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("brands")
    .update({ config: parsed.brand, updated_at: new Date().toISOString() })
    .eq("slug", slug)
    .select("*")
    .maybeSingle();
  if (error) throw new BrandWriteError(error.message, 500);
  if (!data) throw new BrandWriteError(`Marque introuvable : « ${slug} ».`, 404);

  invalidateBrandCache();
  const row = data as BrandRow;
  return { brand: parsed.brand, source: "db", active: row.active, updatedAt: row.updated_at };
}

/** Active ou désactive l'envoi réel. */
export async function setBrandActive(slug: string, active: boolean): Promise<BrandRecord> {
  assertWritable(slug);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("brands")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("slug", slug)
    .select("*")
    .maybeSingle();
  if (error) throw new BrandWriteError(error.message, 500);
  if (!data) throw new BrandWriteError(`Marque introuvable : « ${slug} ».`, 404);

  invalidateBrandCache();
  const row = data as BrandRow;
  const parsed = parseBrandConfig(row.config);
  if (!parsed.ok) throw new BrandWriteError(formatErrors(parsed.errors));
  return { brand: parsed.brand, source: "db", active: row.active, updatedAt: row.updated_at };
}

/**
 * Lève la surcharge d'expédition héritée de l'ancien écran /reglages, pour que
 * la configuration de la marque redevienne ce qui s'applique réellement.
 *
 * Supprimer la ligne plutôt que la vider : une ligne à colonnes nulles et une
 * ligne absente ont déjà le même sens pour brandSender, autant ne pas laisser
 * de trace qui ferait croire à un réglage.
 */
export async function clearSenderOverride(slug: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("brand_settings").delete().eq("brand", slug);
  if (error) throw new BrandWriteError(error.message, 500);
}

/** Tables cloisonnées par marque (voir migration 0009). */
const BRAND_SCOPED_TABLES = ["segments", "campaigns", "searches", "email_log"] as const;

/** Nombre de lignes rattachées à cette marque, par table. */
export async function brandUsage(slug: string): Promise<Record<string, number>> {
  const db = supabaseAdmin();
  const counts = await Promise.all(
    BRAND_SCOPED_TABLES.map(async (table) => {
      const { count } = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("brand", slug);
      return [table, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts);
}

/**
 * Supprime une marque de base.
 *
 * Refusé dès qu'une donnée la référence : les colonnes `brand` ne sont pas des
 * clés étrangères (voir 0009), donc rien en base n'empêcherait la suppression -
 * elle laisserait des campagnes et un journal d'envoi rattachés à une marque
 * qui n'existe plus, donc inaffichables. Désactiver est le bon geste dans ce
 * cas, et l'appelant est invité à le faire.
 */
export async function deleteBrand(slug: string): Promise<void> {
  assertWritable(slug);
  const usage = await brandUsage(slug);
  const used = Object.entries(usage).filter(([, n]) => n > 0);
  if (used.length > 0) {
    throw new BrandWriteError(
      `Suppression impossible : des données sont rattachées à cette marque (${used
        .map(([t, n]) => `${n} ${t}`)
        .join(", ")}). Désactivez-la plutôt que de la supprimer.`,
      409
    );
  }
  const db = supabaseAdmin();
  const { error } = await db.from("brands").delete().eq("slug", slug);
  if (error) throw new BrandWriteError(error.message, 500);
  // L'identité d'expédition est stockée à part : sans ça, recréer un jour le
  // même slug hériterait de l'adresse d'envoi de l'ancienne marque.
  await db.from("brand_settings").delete().eq("brand", slug);
  invalidateBrandCache();
}
