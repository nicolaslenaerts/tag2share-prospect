import { geminiJSON } from "@/lib/gemini";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Rédige (via Gemini) l'email d'une CAMPAGNE. L'email est générique : le produit
 * est porté par les variables de fusion {{product_name}} / {{product_url}} /
 * {{config_url}} / {{products_more}}, résolues par destinataire selon son segment.
 * Renvoie { subject, body } avec variables {{...}} - révisable dans l'UI.
 */
export async function POST(req: Request) {
  const { labels, instruction } = await readJson<{
    labels?: string[];
    instruction?: string;
  }>(req);

  const cibles = (labels ?? []).filter(Boolean);
  const ciblesTxt = cibles.length
    ? `Types de business ciblés : ${cibles.join(", ")}.`
    : "Cible : petits commerces et prestataires de proximité.";

  const prompt = `Tu es copywriter B2B pour Tag2Share (objets connectés NFC + QR : plus d'avis Google, plus d'abonnés, partage sans contact). Rédige un email de prospection à froid, en français, percutant et orienté marketing, pour une CAMPAGNE pouvant viser plusieurs types de business.

${ciblesTxt}
${instruction ? `Consigne supplémentaire : ${instruction}` : ""}

RÈGLES IMPÉRATIVES :
- L'email est GÉNÉRIQUE : ne nomme PAS un produit en dur. Utilise les variables de fusion produit, qui seront remplacées par destinataire :
  {{product_name}} (nom du produit), {{product_url}} (page produit), {{config_url}} (configurateur).
- Utilise aussi les variables : {{name}} (nom du business), {{contact_name}}, {{city}}.
- Inclus impérativement un BOUTON cliquable vers la page produit. Copie EXACTEMENT ce bouton :
  <table cellpadding="0" cellspacing="0" style="margin:20px auto;"><tr><td style="border-radius:8px;background:rgb(20,74,102);"><a href="{{product_url}}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;">Découvrir le {{product_name}}</a></td></tr></table>
- Inclus un LIEN texte visible vers le configurateur : <a href="{{config_url}}">personnaliser votre {{product_name}}</a>.
- Termine le corps par une ligne contenant EXACTEMENT le token {{products_more}}, juste avant la signature.
- Le corps est du HTML simple (<p>, <ul>, <li>, <strong>, <a>). PAS de <html>/<body>/<style>.
- N'utilise JAMAIS le tiret cadratin "—". N'indique AUCUN prix.
- Ton chaleureux, concret, sans jargon. 130-200 mots. Termine par "L'équipe Tag2Share".
- Sujet court et accrocheur (max ~60 caractères), peut contenir {{name}}.

Réponds en JSON STRICT : {"subject": "...", "body": "<p>...</p>"}`;

  try {
    const data = await geminiJSON<{ subject: string; body: string }>(prompt);
    let body = data.body || "";
    if (!body.includes("{{products_more}}")) body += "\n\n{{products_more}}";
    return ok({ subject: data.subject, body });
  } catch (e) {
    return fail(`Erreur Gemini : ${(e as Error).message}`, 500);
  }
}
