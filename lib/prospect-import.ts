/**
 * Import de prospects depuis un fichier : normalisation, déduplication et
 * politique de fusion.
 *
 * ⚠️ Le vivier `prospects` est cloisonné par marque et dédoublonné en base par
 * `(brand, place_id)` (unique, migration 0015). Une ligne de CSV n'a pas de
 * place_id, et Postgres autorise autant de NULL qu'on veut dans un index
 * unique : l'upsert utilisé par la recherche Places ne protège donc RIEN ici.
 * La déduplication d'un import est entièrement applicative, c'est le rôle de ce
 * fichier - et elle s'applique DANS une marque : deux marques peuvent détenir
 * chacune leur fiche du même commerce, c'est le principe du cloisonnement.
 */
import { isValidFormat, isRoleAddress } from "./email-validation";

export type ImportRow = {
  name?: string;
  email?: string;
  contact_name?: string;
  website?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  category?: string;
};

/** Champs recopiables tels quels dans la table `prospects`. */
export const COPYABLE = [
  "name", "email", "contact_name", "website", "phone", "address", "city", "category", "country",
] as const;

export function normEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}

/** « HTTPS://WWW.Site.be/contact/ » -> « site.be ». Vide si inexploitable. */
export function normDomain(website?: string | null): string {
  let w = (website || "").trim().toLowerCase();
  if (!w) return "";
  w = w.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  w = w.split("/")[0].split("?")[0].split("#")[0];
  return w.includes(".") ? w : "";
}

/** Complète une URL saisie sans protocole, pour que les liens restent cliquables. */
export function normWebsite(website?: string | null): string {
  const w = (website || "").trim();
  if (!w) return "";
  return /^[a-z]+:\/\//i.test(w) ? w : `https://${w}`;
}

function normText(v?: string | null): string {
  return (v || "").replace(/\s+/g, " ").trim();
}

function normKey(v?: string | null): string {
  return normText(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Nettoyage d'une ligne brute avant tout traitement. */
export function cleanRow(row: ImportRow): ImportRow {
  return {
    name: normText(row.name),
    email: normEmail(row.email),
    contact_name: normText(row.contact_name),
    website: normWebsite(row.website),
    phone: normText(row.phone),
    address: normText(row.address),
    city: normText(row.city),
    country: normText(row.country),
    category: normText(row.category),
  };
}

/**
 * Clés d'identité d'un prospect, de la plus fiable à la plus faible.
 * Deux enregistrements partageant UNE de ces clés sont considérés identiques.
 */
export function identityKeys(p: {
  email?: string | null;
  website?: string | null;
  name?: string | null;
  city?: string | null;
}): string[] {
  const keys: string[] = [];
  const email = normEmail(p.email);
  if (email) keys.push(`email:${email}`);
  const domain = normDomain(p.website);
  if (domain) keys.push(`site:${domain}`);
  const name = normKey(p.name);
  if (name) keys.push(`nom:${name}|${normKey(p.city)}`);
  return keys;
}

export type RowIssue = { line: number; reason: string };

/** Ce qu'un import a versé dans un segment donné. */
export type SegmentTally = {
  id: string;
  label: string;
  created: number;
  merged: number;
};

/** Compte rendu d'un lot importé, agrégé côté client sur l'ensemble du fichier. */
export type ImportReport = {
  received: number;
  /** Nouveaux prospects créés. */
  created: number;
  /** Lignes rattachées à un prospect déjà présent dans le vivier. */
  merged: number;
  /** Doublons internes au fichier. */
  duplicates: number;
  /** Lignes gardées mais dont l'email a été écarté (invalide ou automatique). */
  droppedEmails: number;
  skipped: RowIssue[];
  /** Détail par segment alimenté (un import peut en viser plusieurs). */
  segments: SegmentTally[];
  warning?: string;
};

/**
 * Vérifie une ligne nettoyée. Retourne la raison du rejet, ou null si la ligne
 * est importable.
 *
 * Choix assumé : un email au format invalide ou de type « no-reply@ » ne fait
 * PAS tomber la ligne. Le business reste utile (téléphone, site, adresse) et
 * sera de toute façon revalidé au moment de l'envoi par validateSendable().
 * L'email fautif est simplement écarté, et signalé dans le rapport.
 */
export function checkRow(row: ImportRow): { reason: string | null; droppedEmail: boolean } {
  if (!row.name) return { reason: "nom du business manquant", droppedEmail: false };
  if (row.email && (!isValidFormat(row.email) || isRoleAddress(row.email)))
    return { reason: null, droppedEmail: true };
  return { reason: null, droppedEmail: false };
}

/**
 * ⚠️ DÉCISION MÉTIER — que faire quand une ligne du fichier correspond à un
 * prospect DÉJÀ présent dans le vivier ?
 *
 * Le défaut ci-dessous est le choix prudent : on ne COMPLÈTE que les champs
 * vides en base, jamais on n'écrase une valeur existante. Rationnel : les
 * données déjà en base viennent de Google Places ou de l'enrichissement du
 * site officiel, souvent plus fiables qu'un fichier acheté ou exporté à la
 * main. Le rattachement au segment, lui, se fait toujours (il est additif).
 *
 * Les deux autres arbitrages possibles :
 *  - « le fichier fait foi » : écraser systématiquement (utile si le CSV vient
 *    d'un CRM à jour et que la base est vieillissante) ;
 *  - « par champ » : le fichier gagne sur email/contact (données humaines,
 *    souvent plus fraîches), la base gagne sur nom/adresse/catégorie (issues
 *    de Places, normalisées).
 *
 * @returns le patch à appliquer, ou null s'il n'y a rien à mettre à jour.
 */
export function mergeProspect(
  existing: Record<string, any>,
  incoming: ImportRow
): Record<string, string> | null {
  const patch: Record<string, string> = {};
  for (const field of COPYABLE) {
    const value = (incoming as any)[field];
    if (!value) continue;
    const current = existing[field];
    if (current == null || String(current).trim() === "") patch[field] = value;
  }
  return Object.keys(patch).length ? patch : null;
}
