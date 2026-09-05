/**
 * Reprise de l'enrichissement déjà payé par une AUTRE marque.
 *
 * Depuis la migration 0015, un prospect appartient à une seule marque : quand
 * une marque découvre un business déjà connu d'une autre, elle obtient sa
 * propre ligne. Repartir de zéro coûterait un nouvel appel Places + Gemini
 * pour retrouver un email déjà trouvé la semaine dernière.
 *
 * On recopie donc les données d'ENTREPRISE (elles ne dépendent pas de la
 * marque : un email de contact est le même pour tout le monde) au moment de la
 * création, une fois. Les deux lignes sont ensuite indépendantes : corriger
 * l'email chez une marque ne touche pas l'autre.
 *
 * Ce qui n'est JAMAIS recopié, parce que c'est un jugement propre à la marque
 * et non un fait sur l'entreprise :
 *   - `status: "rejected"` (écarté par une marque, à voir par l'autre) ;
 *   - `segment_id` et les rattachements (segments d'une autre marque) ;
 *   - l'historique de contact et les suppressions (déjà cloisonnés ailleurs).
 */

/** Champs d'entreprise repris tels quels d'une ligne d'une autre marque. */
const SEEDED = [
  "email",
  "contact_name",
  "logo_url",
  "phone",
  "website",
  "address",
  "city",
  "country",
  "enrichment",
] as const;

export type ProspectSeed = Partial<Record<(typeof SEEDED)[number] | "status", any>>;

/**
 * Valeurs à injecter dans la ligne créée pour la marque courante, d'après la
 * ligne `donor` d'une autre marque. Ne remplit que les champs absents de
 * `row` : ce que la découverte vient de rapporter est plus frais.
 *
 * Renvoie un objet vide s'il n'y a rien à reprendre.
 */
export function seedFromOtherBrand(
  row: Record<string, any>,
  donor: Record<string, any> | undefined | null
): ProspectSeed {
  if (!donor) return {};
  const seed: ProspectSeed = {};
  for (const f of SEEDED) {
    const mine = row[f];
    if (mine != null && String(mine).trim() !== "") continue;
    const theirs = donor[f];
    if (theirs == null || (typeof theirs === "string" && theirs.trim() === "")) continue;
    seed[f] = theirs;
  }
  // Le statut suit l'enrichissement : sans lui, l'interface proposerait de
  // relancer l'enrichissement d'une fiche déjà complète - exactement l'appel
  // que cette reprise sert à éviter. « rejected » ne se transmet pas.
  if (donor.status === "enriched" && seed.enrichment) seed.status = "enriched";
  return seed;
}
