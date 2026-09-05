/**
 * Identité d'expédition effective d'une marque.
 *
 * La clé API Resend est UNIQUE pour toute l'app (RESEND_API_KEY) : un seul
 * compte Resend, plusieurs domaines vérifiés. Ce qui change d'une marque à
 * l'autre, c'est l'adresse d'envoi.
 *
 * Ordre de résolution, du plus fort au plus faible :
 *   1. table brand_settings   SURCHARGE HÉRITÉE de l'ancien écran /reglages
 *   2. variable d'environnement nommée par une marque déclarée en code
 *   3. configuration de la marque (`sender`), éditable dans /marques
 *
 * Le cas normal est aujourd'hui le 3 : la configuration vit en base et
 * s'édite, elle n'a plus besoin d'être contournée sans redéploiement. Les deux
 * premiers niveaux restent lus pour ne pas changer en silence l'identité d'une
 * installation qui s'en sert - l'éditeur signale la surcharge et permet de la
 * lever.
 *
 * Le couple (nom, adresse) est résolu comme un TOUT : on ne mélange jamais un
 * nom enregistré avec une adresse venue du code, ce qui produirait une
 * identité que personne n'a choisie.
 *
 * ⚠️ Module SERVEUR (process.env + Supabase) : ne jamais l'importer depuis un
 * composant client.
 */
import { supabaseAdmin } from "./supabase";
import type { BrandConfig } from "./brands/types";

function env(name?: string): string | undefined {
  if (!name) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function num(v?: string): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Clé API Resend, commune à toutes les marques. */
export function resendApiKey(): string {
  return env("RESEND_API_KEY") || "";
}

/** Secret de signature du webhook Resend, commun à toutes les marques. */
export function resendWebhookSecret(): string | undefined {
  return env("RESEND_WEBHOOK_SECRET");
}

export type MailAddress = { name?: string; email: string };

/**
 * Adresse email valide et sans risque d'injection d'en-tête.
 * On refuse tout caractère de contrôle, espace, chevron ou virgule : ces
 * valeurs finissent dans l'en-tête `From:` d'un vrai email.
 */
export function isValidEmail(value: string): boolean {
  const v = (value || "").trim();
  if (!v || v.length > 254) return false;
  if (/[\s<>,;"\r\n]/.test(v)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v);
}

/**
 * Nom d'expéditeur acceptable. Les retours chariot permettraient d'injecter
 * des en-têtes supplémentaires (Bcc:, Reply-To:...) ; les chevrons et
 * guillemets casseraient le format `Nom <adresse>`.
 */
export function isValidSenderName(value: string): boolean {
  const v = (value || "").trim();
  if (v.length > 120) return false;
  return !/[<>"\r\n]/.test(v);
}

/** Compose l'en-tête `From` : `Nom <adresse>`, ou l'adresse seule. */
export function formatAddress(a: MailAddress): string {
  // Défense en profondeur : on renettoie au moment de composer, même si la
  // validation a déjà eu lieu à l'écriture.
  const name = (a.name || "").replace(/[<>"\r\n]/g, "").trim();
  return name ? `${name} <${a.email}>` : a.email;
}

/** Parse `Nom <adresse>` ou une adresse nue (format des variables d'env). */
export function parseAddress(value: string): MailAddress | undefined {
  const v = (value || "").trim();
  if (!v) return undefined;
  const m = v.match(/^(.*)<\s*([^<>\s]+)\s*>$/);
  if (m) {
    const email = m[2].trim();
    if (!isValidEmail(email)) return undefined;
    return { name: m[1].replace(/["]/g, "").trim() || undefined, email };
  }
  return isValidEmail(v) ? { email: v } : undefined;
}

/** Ligne de la table brand_settings (toutes les colonnes optionnelles). */
export type BrandSettingsRow = {
  brand: string;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  test_email: string | null;
  updated_at?: string;
};

const blank = (b: string): BrandSettingsRow => ({
  brand: b,
  from_name: null,
  from_email: null,
  reply_to: null,
  test_email: null,
});

/**
 * Codes signalant « cette table n'existe pas » = migration 0011 pas encore
 * jouée. PostgREST a changé de code selon les versions : `42P01` est le code
 * PostgreSQL brut, `PGRST205` celui renvoyé par les versions récentes
 * (« Could not find the table in the schema cache ») - Supabase utilise la
 * seconde. On accepte les deux, plus le message en dernier recours : se
 * tromper ici bloquerait tous les envois jusqu'à l'application de la migration.
 */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  const m = (error.message || "").toLowerCase();
  return m.includes("brand_settings") && (m.includes("does not exist") || m.includes("could not find the table"));
}

/**
 * Valeurs enregistrées pour cette marque (ligne vide si rien n'a été saisi).
 *
 * Deux échecs à ne PAS confondre :
 *  - table absente (migration 0011 pas encore appliquée) → on dégrade vers
 *    l'env puis le code, l'app continue de fonctionner comme avant ;
 *  - toute autre erreur → on LÈVE. Retomber silencieusement sur le défaut
 *    ferait partir de vrais emails depuis une adresse que personne n'a
 *    choisie, et un email envoyé ne se rattrape pas.
 */
export async function readBrandSettings(
  brandSlug: string
): Promise<BrandSettingsRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("brand_settings")
    .select("*")
    .eq("brand", brandSlug)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      console.warn(
        "brand_settings absente : migration 0011_brand_sender.sql non appliquée, " +
          "repli sur les variables d'environnement."
      );
      return blank(brandSlug);
    }
    throw new Error(
      `Lecture de l'identité d'expédition impossible (${brandSlug}) : ${error.message}`
    );
  }
  if (!data) return blank(brandSlug);
  return data as BrandSettingsRow;
}

export type SenderRuntime = {
  from: string; // en-tête From composé
  fromName?: string;
  fromEmail: string;
  replyTo: string;
  testEmail?: string;
  dailyCap: number;
  delayMs: number;
  /** D'où vient l'adresse d'envoi effective (affiché dans l'UI). */
  fromSource: "settings" | "env" | "config";
};

/**
 * Identité d'expédition effective. Un appel = une lecture en base : dans une
 * boucle d'envoi, résoudre UNE fois puis passer le résultat à sendEmail
 * (l'identité reste ainsi figée pour tout le lot).
 */
export async function brandSender(brand: BrandConfig): Promise<SenderRuntime> {
  const s = brand.sender;
  const row = await readBrandSettings(brand.slug);

  // 1. Surcharge héritée de l'ancien écran /reglages.
  let from: MailAddress | undefined;
  let fromSource: SenderRuntime["fromSource"] = "config";
  if (row.from_email && isValidEmail(row.from_email)) {
    from = { name: row.from_name?.trim() || undefined, email: row.from_email.trim() };
    fromSource = "settings";
  }
  // 2. Variable d'environnement (format `Nom <adresse>` accepté).
  if (!from) {
    const parsed = parseAddress(env(s.fromEnv) || "");
    if (parsed) {
      from = parsed;
      fromSource = "env";
    }
  }
  // 3. Configuration de la marque : le cas normal.
  if (!from) {
    from = { name: s.fromName, email: s.from };
    fromSource = "config";
  }

  const replyTo =
    row.reply_to?.trim() || env(s.replyToEnv) || s.replyTo || from.email;
  const testEmail = row.test_email?.trim() || env(s.testEmailEnv) || s.testEmail;

  return {
    from: formatAddress(from),
    fromName: from.name,
    fromEmail: from.email,
    replyTo,
    testEmail,
    dailyCap: num(env(s.dailyCapEnv)) ?? s.dailyCap,
    delayMs: num(env(s.delayMsEnv)) ?? s.delayMs,
    fromSource,
  };
}

/**
 * Enregistre (ou efface) l'identité d'expédition d'une marque.
 * Une chaîne vide efface la valeur : on retombe alors sur l'env puis le code.
 */
export async function saveBrandSettings(
  brandSlug: string,
  fields: {
    from_name?: string | null;
    from_email?: string | null;
    reply_to?: string | null;
    test_email?: string | null;
  }
): Promise<BrandSettingsRow> {
  const clean = (v?: string | null) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("brand_settings")
    .upsert(
      {
        brand: brandSlug,
        from_name: clean(fields.from_name),
        from_email: clean(fields.from_email),
        reply_to: clean(fields.reply_to),
        test_email: clean(fields.test_email),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brand" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BrandSettingsRow;
}
