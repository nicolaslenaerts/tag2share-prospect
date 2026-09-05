/**
 * Lecture de fichiers CSV « du monde réel » (exports Excel, Google Sheets,
 * annuaires, plateformes tierces).
 *
 * Trois pièges traités ici, parce qu'ils cassent 90 % des imports en pratique :
 *  - le séparateur : Excel en locale FR/BE écrit des « ; », pas des « , » ;
 *  - les guillemets : un champ peut contenir le séparateur, un retour ligne
 *    ou un guillemet doublé ("") ;
 *  - les fins de ligne : CRLF (Windows), LF (Unix), CR (vieux Mac).
 *
 * Le parseur est volontairement autonome (pas de dépendance) et partagé
 * client/serveur : le client s'en sert pour l'aperçu et le mapping, le
 * serveur ne reçoit que des lignes déjà structurées.
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
};

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Normalise les fins de ligne : tout devient \n, y compris dans les champs. */
function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

const DELIMITERS = [",", ";", "\t", "|"];

/**
 * Devine le séparateur d'après la première ligne non vide : celui qui apparaît
 * le plus souvent HORS guillemets. Par défaut « , ».
 */
export function detectDelimiter(text: string): string {
  const line =
    normalizeNewlines(stripBom(text))
      .split("\n")
      .find((l) => l.trim() !== "") ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse un CSV complet. `hasHeader` à false génère des en-têtes « Colonne 1… ».
 * Les lignes entièrement vides sont ignorées ; les lignes trop courtes ou trop
 * longues sont alignées sur le nombre de colonnes de l'en-tête.
 */
export function parseCsv(
  text: string,
  opts: { delimiter?: string; hasHeader?: boolean } = {}
): CsvTable {
  const src = normalizeNewlines(stripBom(text));
  const d = opts.delimiter || detectDelimiter(src);
  const hasHeader = opts.hasHeader !== false;

  const all: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false; // au moins un caractère lu sur la ligne courante

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = "";
      started = true;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      all.push(row);
      row = [];
      field = "";
      started = false;
      continue;
    }
    field += c;
    started = true;
  }
  if (started || field !== "" || row.length) {
    row.push(field);
    all.push(row);
  }

  // Nettoyage : trim des cellules, suppression des lignes vides.
  const cleaned = all
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));

  if (cleaned.length === 0) return { headers: [], rows: [], delimiter: d };

  const width = Math.max(...cleaned.map((r) => r.length));
  const pad = (r: string[]) =>
    r.length === width ? r : [...r, ...Array(width - r.length).fill("")];

  if (hasHeader) {
    const headers = pad(cleaned[0]).map((h, i) => h || `Colonne ${i + 1}`);
    return { headers, rows: cleaned.slice(1).map(pad), delimiter: d };
  }
  const headers = Array.from({ length: width }, (_, i) => `Colonne ${i + 1}`);
  return { headers, rows: cleaned.map(pad), delimiter: d };
}

// ------------------------------------------------------------------
// Mapping colonnes CSV -> champs prospect
// ------------------------------------------------------------------

/** Champs de `prospects` alimentables par un import. */
export const IMPORT_FIELDS = [
  { key: "name", label: "Nom du business", required: true },
  { key: "email", label: "Email", required: false },
  { key: "contact_name", label: "Nom du contact", required: false },
  { key: "website", label: "Site web", required: false },
  { key: "phone", label: "Téléphone", required: false },
  { key: "address", label: "Adresse", required: false },
  { key: "city", label: "Ville", required: false },
  { key: "country", label: "Pays", required: false },
  { key: "category", label: "Catégorie", required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** minuscules, sans accents, sans ponctuation : « E-Mail Pro » -> « emailpro ». */
export function normHeader(h: string): string {
  return (h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Synonymes FR/EN les plus courants. L'ordre du tableau sert de priorité pour
// la passe « approchante » : les champs les plus spécifiques d'abord, sinon
// « adresse email » finirait mappé sur `address` et « nom du contact » sur `name`.
const SYNONYMS: Record<ImportField, string[]> = {
  email: [
    "email", "e-mail", "mail", "courriel", "adresse email", "adresse e-mail",
    "email address", "email pro", "emails",
  ],
  contact_name: [
    "contact", "nom du contact", "nom contact", "contact name", "responsable",
    "interlocuteur", "gerant", "gérant", "dirigeant", "prenom nom", "prénom nom",
  ],
  website: ["site", "site web", "site internet", "website", "url", "web", "domaine", "domain"],
  phone: ["telephone", "téléphone", "tel", "tél", "phone", "gsm", "mobile", "numero", "numéro"],
  city: ["ville", "city", "localite", "localité", "commune", "town"],
  country: ["pays", "country", "nation"],
  category: [
    "categorie", "catégorie", "category", "secteur", "activite", "activité",
    "type", "industry", "metier", "métier",
  ],
  address: ["adresse", "address", "rue", "street", "adresse postale", "adresse complete"],
  name: [
    "nom", "name", "entreprise", "societe", "société", "raison sociale", "business",
    "company", "company name", "etablissement", "établissement", "enseigne",
    "nom de l'entreprise", "denomination", "dénomination",
  ],
};

const FIELD_ORDER = Object.keys(SYNONYMS) as ImportField[];

/**
 * Devine le mapping colonne -> champ. Deux passes : d'abord les
 * correspondances exactes (fiables), puis les approchantes (« Email pro »
 * contient « email »). Une colonne n'est utilisée qu'une fois.
 */
export function autoMap(headers: string[]): Record<ImportField, number> {
  const norm = headers.map(normHeader);
  const mapping = Object.fromEntries(
    FIELD_ORDER.map((f) => [f, -1])
  ) as Record<ImportField, number>;
  const used = new Set<number>();

  for (const pass of ["exact", "loose"] as const) {
    for (const field of FIELD_ORDER) {
      if (mapping[field] >= 0) continue;
      const syn = SYNONYMS[field].map(normHeader);
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i) || !norm[i]) continue;
        const hit =
          pass === "exact"
            ? syn.includes(norm[i])
            : syn.some((s) => s.length >= 3 && norm[i].includes(s));
        if (hit) {
          mapping[field] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  return mapping;
}
