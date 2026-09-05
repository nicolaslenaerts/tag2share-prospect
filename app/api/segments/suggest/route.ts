import { geminiJSON } from "@/lib/gemini";
import { getProduct } from "@/lib/products";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import { brandForbiddenBlock } from "@/lib/brands/types";

export const runtime = "nodejs";

type SuggestedSegment = {
  label: string;
  rationale: string;
  search_terms: string[];
};

/**
 * Étape 1 - l'utilisateur choisit UN produit du catalogue de la marque active ;
 * l'IA propose des types de business qui auraient le plus à gagner à utiliser
 * CE produit. Le positionnement de la marque est injecté dans le prompt.
 */
export async function POST(req: Request) {
  const { country, hint, count, product } = await readJson<{
    country?: string;
    hint?: string;
    count?: number;
    product?: string;
  }>(req);

  const brand = activeBrand(req);
  const n = Math.min(Math.max(count || 8, 3), 15);
  const zone = country || "Belgique";
  const p = getProduct(brand, product);

  const prompt = `Tu es expert en prospection B2B pour ${brand.name}.

${brand.ai.positioning}
${brandForbiddenBlock(brand)}
Produit à vendre : ${p.name} (${p.price}).
${p.description}
Angle : ${p.pitch}

Propose ${n} TYPES de business locaux (en ${zone}) qui auraient le plus à gagner à utiliser CE produit précis.
${hint ? `Contrainte supplémentaire de l'utilisateur : ${hint}.` : ""}

Pour chaque type, donne :
- "label" : nom du type de business (français, pluriel, ex: "Salons de coiffure")
- "rationale" : 1 phrase expliquant pourquoi CE produit (${p.name}) leur est particulièrement utile
- "search_terms" : 1 à 3 requêtes Google Maps pour les trouver (ex: ["salon de coiffure", "coiffeur"])

Réponds en JSON STRICT : {"segments":[{...}]}`;

  try {
    const data = await geminiJSON<{ segments: SuggestedSegment[] }>(prompt);
    // Tous les segments proposés portent le produit choisi pour la recherche.
    const segments = (data.segments || []).map((s) => ({ ...s, product: p.key }));
    return ok({ segments });
  } catch (e) {
    return fail(`Erreur Gemini : ${(e as Error).message}`, 500);
  }
}
