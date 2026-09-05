/**
 * Noms du cookie et de l'en-tête portant la marque active.
 *
 * Ces deux constantes vivent à part parce qu'elles sont partagées par trois
 * mondes qui n'ont pas les mêmes dépendances : le middleware (runtime Edge,
 * pas d'accès base), les route handlers (Node + Supabase) et les composants
 * clients. Les mettre dans lib/brand-context.ts tirerait le client Supabase
 * dans le bundle Edge.
 */
export const BRAND_HEADER = "x-brand";
export const BRAND_COOKIE = "brand";
