import { geminiJSON } from "@/lib/gemini";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Améliore un email EXISTANT (sujet + corps) selon une instruction libre,
 * SANS le réécrire de zéro : la structure, les variables de fusion {{...}},
 * les liens et les boutons existants sont préservés.
 * Renvoie { subject, body }.
 */
export async function POST(req: Request) {
  const { subject, body, instruction } = await readJson<{
    subject: string;
    body: string;
    instruction: string;
  }>(req);

  if (!instruction?.trim()) return fail("instruction requise.");
  if (!body?.trim() && !subject?.trim()) return fail("sujet ou corps requis.");

  const prompt = `Tu es copywriter B2B pour Tag2Share. On te donne un email de prospection EXISTANT (sujet + corps HTML) et une INSTRUCTION d'amélioration. Améliore l'email en suivant l'instruction, SANS le réécrire entièrement : conserve le sens, le ton et la structure globale, ne change que ce qui sert l'instruction.

INSTRUCTION : ${instruction}

RÈGLES IMPÉRATIVES :
- Conserve TOUTES les variables de fusion telles quelles, à l'identique : {{name}}, {{contact_name}}, {{city}}, {{product_name}}, {{products_more}}, etc. N'en ajoute pas de nouvelles, n'en supprime aucune.
- Conserve TOUS les liens et boutons HTML existants (balises <a>, tables de bouton) avec leurs URL EXACTES. Ne modifie pas les href.
- Le corps reste du HTML simple (<p>, <ul>, <li>, <strong>, <a>). PAS de <html>/<body>/<style>.
- N'utilise JAMAIS le tiret cadratin "—".
- N'indique AUCUN prix ni montant.
- Si l'instruction ne concerne que le corps, renvoie le sujet inchangé (et inversement).

EMAIL ACTUEL
Sujet : ${subject || "(vide)"}
Corps :
${body || "(vide)"}

Réponds en JSON STRICT : {"subject": "...", "body": "<p>...</p>"}`;

  try {
    const data = await geminiJSON<{ subject: string; body: string }>(prompt);
    let outBody = data.body || body || "";
    // Préserve l'encart "autres produits" s'il était présent.
    if (body?.includes("{{products_more}}") && !outBody.includes("{{products_more}}")) {
      outBody += "\n\n{{products_more}}";
    }
    return ok({ subject: data.subject || subject, body: outBody });
  } catch (e) {
    return fail(`Erreur Gemini : ${(e as Error).message}`, 500);
  }
}
