/**
 * Rapprochement entre une valeur libre (colonne « catégorie » d'un fichier
 * importé) et les segments d'une marque.
 *
 * Un fichier acheté ou exporté d'un CRM écrit « Coiffeur », « coiffeurs »,
 * « Salon de coiffure » là où la marque a un segment « Salons de coiffure ».
 * Sans normalisation, chaque variante créerait un segment de plus et
 * éparpillerait le vivier. Ce module concentre la règle de rapprochement pour
 * qu'elle soit la même côté client (aperçu du plan d'import) et côté serveur.
 */

/** « Salons de Coiffure ! » -> « salons de coiffure ». */
function normalize(label?: string | null): string {
  return (label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mots vides qui ne portent aucune information de segment. */
const STOPWORDS = new Set(["de", "des", "du", "la", "le", "les", "l", "d", "et", "a", "au", "aux", "en"]);

/**
 * Clé de comparaison d'un libellé : normalisée, sans mots vides, chaque mot
 * ramené au singulier et les mots triés. « Salon de Coiffure » et
 * « coiffures salons » donnent donc la même clé.
 *
 * Le singulier est obtenu en retirant un « s » final (suffisant en français
 * pour ce cas d'usage ; « bus » -> « bu » est sans conséquence tant que la
 * même règle s'applique des deux côtés de la comparaison).
 */
export function labelKey(label?: string | null): string {
  return normalize(label)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .sort()
    .join(" ");
}

export type MatchableSegment = { id: string; label: string };

/**
 * ⚠️ DÉCISION MÉTIER — quand considère-t-on qu'une catégorie du fichier
 * DÉSIGNE un segment existant plutôt qu'un nouveau segment ?
 *
 * Le défaut ci-dessous est volontairement STRICT : même clé (mots
 * significatifs identiques au singulier, ordre libre) ou rien. Rationnel : un
 * faux positif est coûteux et silencieux — les prospects atterrissent dans un
 * segment dont l'email parle d'autre chose, et personne ne s'en aperçoit avant
 * l'envoi. Créer un segment de trop, à l'inverse, se corrige d'un clic.
 *
 * Les deux autres arbitrages possibles :
 *  - « inclusif » : accepter qu'une clé soit contenue dans l'autre
 *    (« coiffure » trouverait « salon coiffure »). Rattrape les fichiers
 *    laconiques, au prix de rapprochements douteux (« bar » -> « bar a vin ») ;
 *  - « jamais » : toujours créer, et laisser l'utilisateur fusionner à la main
 *    dans le plan d'import. Le plus prévisible, le plus fastidieux.
 *
 * Dans tous les cas l'utilisateur peut corriger chaque ligne du plan d'import
 * avant de lancer : cette fonction ne fait que proposer le défaut.
 */
export function matchSegment<T extends MatchableSegment>(
  category: string,
  segments: T[]
): T | null {
  const key = labelKey(category);
  if (!key) return null;
  return segments.find((s) => labelKey(s.label) === key) ?? null;
}

/** Libellé propre pour un segment créé depuis une catégorie de fichier. */
export function segmentLabelFromCategory(category: string): string {
  const clean = (category || "").replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
