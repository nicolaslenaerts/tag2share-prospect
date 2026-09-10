/**
 * Variantes d'email d'une campagne (A/B/C...) et répartition des envois.
 *
 * Une campagne peut porter plusieurs textes, chacun avec une part en % :
 * ex. A 35 %, B 35 %, C 30 %. Deux règles structurent tout le module :
 *
 *  1. La somme des poids doit faire 100. L'édition tolère un état transitoire
 *     (on enregistre 35+35 = 70 pendant qu'on ajoute la 3e variante), mais
 *     l'ENVOI le refuse : partir avec une somme fausse voudrait dire une
 *     proportion réelle différente de celle affichée.
 *
 *  2. La variante d'un destinataire est FIGÉE sur sa ligne
 *     (campaign_recipients.variant_id) avant l'envoi, jamais tirée à
 *     l'expédition. L'envoi se fait par lots (« envoyer les 25 prochains ») :
 *     un tirage par lot ferait dériver la proportion globale, et l'opérateur
 *     ne pourrait pas prévisualiser ni tester le texte qui va réellement
 *     partir à un destinataire donné.
 */
import type { supabaseAdmin } from "./supabase";

export type CampaignVariant = {
  id: string;
  campaign_id?: string;
  name: string;
  subject: string;
  body_html: string;
  email_tagline?: string | null;
  product?: string | null;
  weight: number;
  sort_order?: number;
};

/** Template effectif d'un envoi : variante par-dessus le repli campagne. */
export type EffectiveTemplate = {
  subject: string;
  body_html: string;
  email_tagline?: string | null;
  product?: string | null;
};

export const TOTAL_WEIGHT = 100;

/** Somme des parts. Doit valoir 100 pour qu'un envoi soit autorisé. */
export function totalWeight(variants: Pick<CampaignVariant, "weight">[]): number {
  return variants.reduce((n, v) => n + (Number(v.weight) || 0), 0);
}

/**
 * Vrai si la répartition est envoyable : au moins une variante, somme = 100.
 * Une campagne SANS variante reste envoyable (repli sur le template campagne),
 * c'est le cas testé séparément par les appelants.
 */
export function weightsAreValid(variants: Pick<CampaignVariant, "weight">[]): boolean {
  return variants.length > 0 && totalWeight(variants) === TOTAL_WEIGHT;
}

/**
 * Parts équitables pour n variantes : 100 / n, le reste de la division allant
 * aux PREMIÈRES variantes. Pour 3 : 34 / 33 / 33. Sert de point de départ
 * valide à la création d'une variante, l'opérateur ajustant ensuite.
 */
export function evenWeights(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(TOTAL_WEIGHT / n);
  const rest = TOTAL_WEIGHT - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Template effectif pour un destinataire. Précédence, du plus spécifique au
 * plus général :
 *   sujet / corps  : variante (si non vide) → template de la campagne
 *   accroche       : variante (y compris '' = masquée) → campagne
 *   produit        : variante → campagne → produit du segment (côté appelant)
 * L'override individuel du destinataire (custom_subject / custom_html) est
 * appliqué au-dessus, dans buildRecipientEmail (lib/email.ts).
 */
export function effectiveTemplate(
  campaign: EffectiveTemplate,
  variant?: CampaignVariant | null
): EffectiveTemplate {
  if (!variant) return campaign;
  return {
    subject: variant.subject?.trim() ? variant.subject : campaign.subject,
    body_html: variant.body_html?.trim() ? variant.body_html : campaign.body_html,
    email_tagline: variant.email_tagline ?? campaign.email_tagline,
    product: variant.product || campaign.product || null,
  };
}

/**
 * Répartit des destinataires entre les variantes selon leurs poids.
 *
 * Deux propriétés voulues, et elles ne vont pas de soi ensemble :
 *
 *  - TOTAUX EXACTS : les quotas sont calculés à la méthode du plus fort reste
 *    (chaque variante prend floor(n × poids / 100), puis les places restantes
 *    vont aux plus gros restes). Sur 100 destinataires en 35/35/30 on obtient
 *    exactement 35/35/30, pas « à peu près » comme le donnerait un tirage
 *    aléatoire pondéré (qui, sur 40 destinataires, peut sortir 12/18/10).
 *
 *  - ORDRE LISSÉ : les variantes sont ensuite entrelacées (A, B, C, A, B, C…)
 *    plutôt que posées en blocs. C'est indispensable ici parce que l'envoi
 *    prend « les N premiers approuvés » : en blocs, le premier lot de 25 sur
 *    100 serait 100 % de variante A. À chaque place on sert la variante la
 *    plus en retard sur son propre quota (part servie la plus faible), ce qui
 *    fait que TOUT préfixe de la liste respecte déjà les proportions.
 *
 * Déterministe (aucun aléa) : même entrée, même sortie. Deux exécutions de la
 * répartition ne rebrassent donc pas inutilement les affectations.
 *
 * @param recipientIds destinataires dans l'ordre de la liste (= ordre d'envoi)
 * @param variants     variantes avec leurs poids ; somme supposée = 100
 * @returns Map destinataire → variante ; vide si aucune variante utilisable
 */
export function allocateVariants(
  recipientIds: string[],
  variants: CampaignVariant[]
): Map<string, string> {
  const out = new Map<string, string>();
  const n = recipientIds.length;
  // On ignore les variantes à 0 % : elles existent mais ne reçoivent personne.
  const active = variants
    .filter((v) => (Number(v.weight) || 0) > 0)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (n === 0 || active.length === 0) return out;
  if (active.length === 1) {
    for (const id of recipientIds) out.set(id, active[0].id);
    return out;
  }

  const total = totalWeight(active) || TOTAL_WEIGHT;

  // 1. Quotas exacts, méthode du plus fort reste.
  const quotas = active.map((v) => {
    const exact = (n * (Number(v.weight) || 0)) / total;
    return { id: v.id, quota: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let leftover = n - quotas.reduce((s, q) => s + q.quota, 0);
  // Les places restantes vont aux plus gros restes ; à reste égal, à la
  // variante la plus lourde puis à la première dans l'ordre d'affichage.
  const byRest = [...quotas.keys()].sort((a, b) => {
    const d = quotas[b].rest - quotas[a].rest;
    if (Math.abs(d) > 1e-9) return d;
    const w = (Number(active[b].weight) || 0) - (Number(active[a].weight) || 0);
    return w !== 0 ? w : a - b;
  });
  for (let k = 0; leftover > 0; k = (k + 1) % byRest.length, leftover--) {
    quotas[byRest[k]].quota += 1;
  }

  // 2. Ordre lissé : à chaque place, la variante la plus en retard sur son
  //    quota. `served / quota` plutôt que le reste absolu, sinon la variante
  //    la plus lourde monopoliserait le début de la liste.
  const served = active.map(() => 0);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestRatio = Infinity;
    for (let v = 0; v < active.length; v++) {
      const q = quotas[v].quota;
      if (q <= 0 || served[v] >= q) continue; // quota épuisé
      const ratio = served[v] / q;
      // Départage : plus grand quota restant, puis ordre d'affichage.
      const better =
        ratio < bestRatio - 1e-9 ||
        (Math.abs(ratio - bestRatio) <= 1e-9 &&
          best >= 0 &&
          quotas[v].quota - served[v] > quotas[best].quota - served[best]);
      if (best < 0 || better) {
        best = v;
        bestRatio = ratio;
      }
    }
    if (best < 0) break; // tous les quotas sont épuisés (ne devrait pas arriver)
    served[best] += 1;
    out.set(recipientIds[i], active[best].id);
  }
  return out;
}

/** Variantes d'une campagne, dans l'ordre d'affichage. */
export async function loadVariants(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string
): Promise<CampaignVariant[]> {
  const { data } = await db
    .from("campaign_variants")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as CampaignVariant[];
}

/**
 * (Re)calcule et enregistre l'affectation des variantes pour une campagne.
 *
 * Ce qui est REDISTRIBUÉ : tout destinataire encore en jeu (brouillon, test
 * envoyé, approuvé). Modifier un poids doit se voir immédiatement dans la
 * liste, sinon les proportions affichées mentiraient.
 *
 * Ce qui est INTOUCHABLE : les destinataires « sent » et « failed ». Leur
 * variante est un fait passé, consigné en plus dans email_log ; la réécrire
 * rendrait toute mesure A/B fausse. Les « excluded » et « already_contacted »
 * sont laissés de côté : ils ne partiront pas et occuperaient un quota.
 *
 * Limite connue et assumée : les désinscrits/bouncés (liste de suppression)
 * comptent encore dans les quotas, leur statut n'étant pas porté par la ligne
 * destinataire mais calculé au moment de l'envoi. Sur une liste normale ils
 * sont trop peu nombreux pour décaler visiblement les parts ; les exclure
 * imposerait une lecture de la table des suppressions à chaque répartition.
 *
 * @returns nombre de destinataires affectés
 */
export async function assignVariants(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string,
  variants?: CampaignVariant[]
): Promise<number> {
  const list = variants ?? (await loadVariants(db, campaignId));
  const { data: recipients } = await db
    .from("campaign_recipients")
    .select("id, status, variant_id")
    .eq("campaign_id", campaignId)
    .in("status", ["draft", "test_sent", "approved"])
    .order("created_at", { ascending: true });
  const ids = (recipients ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;

  const alloc = allocateVariants(ids, list);

  // Une écriture par variante (et une pour les non-affectés) plutôt qu'une par
  // destinataire : une campagne peut compter des milliers de lignes.
  const byVariant = new Map<string, string[]>();
  const unassigned: string[] = [];
  for (const r of recipients ?? []) {
    const target = alloc.get(r.id) ?? null;
    if (target === r.variant_id) continue; // déjà à jour
    if (!target) unassigned.push(r.id);
    else byVariant.set(target, [...(byVariant.get(target) ?? []), r.id]);
  }
  let touched = 0;
  for (const [variantId, rows] of byVariant) {
    const { error } = await db
      .from("campaign_recipients")
      .update({ variant_id: variantId })
      .in("id", rows);
    if (error) throw new Error(error.message);
    touched += rows.length;
  }
  if (unassigned.length > 0) {
    const { error } = await db
      .from("campaign_recipients")
      .update({ variant_id: null })
      .in("id", unassigned);
    if (error) throw new Error(error.message);
    touched += unassigned.length;
  }
  return touched;
}
