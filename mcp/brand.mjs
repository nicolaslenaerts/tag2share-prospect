/**
 * Résolution de la marque pour les outils MCP.
 *
 * Pourquoi une couche ici plutôt que de laisser faire l'API : côté application,
 * `activeBrand()` retombe SILENCIEUSEMENT sur la marque par défaut quand le
 * slug est inconnu (lib/brand-context.ts). C'est le bon comportement pour un
 * navigateur — une session avec un vieux cookie doit continuer de fonctionner.
 * C'est le mauvais comportement pour un agent : un slug mal orthographié
 * créerait une campagne sur Tag2Share en croyant travailler sur Voxado, avec
 * une autre identité d'expédition. Le serveur MCP valide donc le slug contre
 * le registre AVANT d'écrire, et refuse au lieu de dériver.
 */
import { request } from "./client.mjs";

let cached = null;

/** Registre des marques (mis en cache pour la durée du processus). */
export async function loadBrands({ refresh = false } = {}) {
  if (!cached || refresh) {
    const { brands } = await request("/api/brands");
    cached = brands ?? [];
  }
  return cached;
}

/**
 * Slug de marque à utiliser pour un appel, ou lève une erreur explicite.
 *
 * @param {string|undefined} requested slug passé par l'outil MCP
 * @returns {Promise<string>} slug validé contre le registre
 */
export async function resolveBrandSlug(requested) {
  const brands = await loadBrands();
  const known = brands.map((b) => b.slug);

  if (requested) {
    const slug = String(requested).trim().toLowerCase();
    const match = brands.find((b) => b.slug === slug);
    if (!match)
      throw new Error(
        `Marque inconnue : « ${requested} ». Marques disponibles : ${known.join(", ")}.`
      );
    return match.slug;
  }

  // ------------------------------------------------------------------
  // TODO (décision produit) — que faire quand l'outil N'INDIQUE PAS de marque ?
  //
  // Le repli ci-dessous est le plus STRICT : on refuse et on liste les
  // marques. Sûr, mais verbeux — l'agent perd un aller-retour à chaque fois.
  //
  // Autres politiques défendables :
  //   - s'il n'existe qu'UNE marque active, la prendre (confort sans ambiguïté) ;
  //   - prendre T2S_MCP_DEFAULT_BRAND si la variable est posée (l'opérateur
  //     déclare sur quoi il travaille, une fois pour toutes) ;
  //   - ne tolérer l'implicite qu'en LECTURE, et l'exiger en écriture.
  //
  // Le vrai enjeu : une campagne créée sur la mauvaise marque part avec une
  // autre identité d'expédition. Le confort d'un aller-retour économisé vaut-il
  // ce risque ?
  // ------------------------------------------------------------------
  throw new Error(
    `Paramètre « brand » requis. Marques disponibles : ${known.join(", ")}.`
  );
}

/** Marques exposées à l'agent, sans le détail d'administration. */
export function summarizeBrands(brands) {
  return brands.map((b) => ({
    slug: b.slug,
    name: b.name,
    active: b.active,
    source: b.source,
    product_count: b.productCount,
    app_url: b.appUrl,
    /** Envoi réel autorisé ? `active` seul ne suffit pas (domaine à vérifier). */
    ready_to_send: b.readiness?.ok ?? null,
  }));
}
