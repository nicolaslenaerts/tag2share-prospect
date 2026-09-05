/**
 * Marques déclarées en CODE.
 *
 * Historiquement, ce fichier était le registre : Tag2Share et Horodo y étaient
 * listées et l'application n'en connaissait pas d'autres. Depuis la migration
 * 0013, toutes les marques vivent en base (table `brands`) et se modifient
 * dans /marques. Le registre effectif est donc lib/brands/store.ts.
 *
 * Ce qui reste ici sert deux rôles, et deux seulement :
 *
 *  - SEED_BRANDS : les configurations d'origine. Elles ont servi à écrire la
 *    migration 0013, et font office de CANOT DE SAUVETAGE si la base est
 *    injoignable ou vide - sans quoi une panne Supabase laisserait l'app sans
 *    aucune marque, donc incapable de rendre la moindre page.
 *
 *  - BRANDS : les marques qui, DANS LE CODE, ont autorité sur celles de la
 *    base. Le tableau est vide, et c'est voulu : une entrée ici masquerait la
 *    ligne de base du même slug, rendant ses modifications sans effet et
 *    invisibles. À ne réutiliser que pour figer délibérément une marque hors
 *    de portée de l'interface.
 *
 * Client-safe : aucun secret, aucune lecture de process.env.
 */
import type { BrandConfig } from "./types";
import { tag2share } from "./tag2share";
import { horodo } from "./horodo";

export * from "./types";

/**
 * Configurations d'origine des deux marques historiques. Repli d'urgence
 * uniquement (voir loadBrandRecords) : en fonctionnement normal, la base fait
 * foi et ces objets ne sont jamais lus.
 */
export const SEED_BRANDS: BrandConfig[] = [tag2share, horodo];

/**
 * Marques déclarées en code, prioritaires sur la base. Vide par choix : voir
 * l'en-tête de ce fichier.
 */
export const BRANDS: BrandConfig[] = [];

/**
 * Marque retenue quand la requête n'en désigne aucune. C'est un SLUG et non
 * un objet : la configuration correspondante est lue en base, et cette
 * constante doit rester utilisable même quand la base ne répond pas (c'est
 * elle qui permet à lib/unsubscribe.ts de reconnaître les liens signés à
 * l'ancien format, émis avant le multi-marque).
 */
export const DEFAULT_BRAND_SLUG = "tag2share";
