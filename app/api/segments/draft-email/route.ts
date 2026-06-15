import { geminiJSON } from "@/lib/gemini";
import { getProduct } from "@/lib/products";
import { ok, fail, readJson } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Rédige (via Gemini) un email marketing adapté à un type de business ET au produit
 * mis en avant, en intégrant les liens page produit + configurateur.
 * Renvoie { subject, body } avec variables de fusion {{...}} - révisable ensuite dans l'UI.
 */
export async function POST(req: Request) {
  const { label, product, rationale } = await readJson<{
    label: string;
    product: string;
    rationale?: string;
  }>(req);
  if (!label) return fail("label requis.");

  const p = getProduct(product);

  const prompt = `Tu es copywriter B2B pour Tag2Share. Rédige un email de prospection à froid, en français, percutant et orienté marketing.

CIBLE : des "${label}".${rationale ? ` Contexte : ${rationale}.` : ""}
PRODUIT MIS EN AVANT : ${p.name}. ${p.description}
Angle : ${p.pitch}

CONTRAINTES :
- N'utilise JAMAIS le caractère tiret cadratin "—". Emploie une virgule, un deux-points ou une parenthèse à la place.
- N'indique AUCUN prix ni montant dans l'email.
- Adapte tout le discours à CE produit et à CE type de business (bénéfices concrets pour eux).
- Le corps est du HTML simple (<p>, <ul>, <li>, <strong>, <a>). PAS de <html>/<body>/<style>.
- Utilise les variables de fusion telles quelles : {{contact_name}}, {{name}}, {{city}}.
- Inclus impérativement un BOUTON cliquable vers la PAGE PRODUIT. Copie EXACTEMENT ce bouton :
  <table cellpadding="0" cellspacing="0" style="margin:20px auto;"><tr><td style="border-radius:8px;background:rgb(20,74,102);"><a href="${p.shopUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;">Découvrir le ${p.name}</a></td></tr></table>
- Inclus aussi un LIEN texte bien visible vers le CONFIGURATEUR : <a href="${p.configUrl}">personnaliser votre ${p.name}</a> (les liens seront mis en couleur automatiquement).
- Termine le corps par une ligne contenant EXACTEMENT le token {{products_more}} (un encart "autres produits" y sera inséré automatiquement), juste avant la signature.
- Ton chaleureux, concret, sans jargon. 130-200 mots. Termine par "L'équipe Tag2Share".
- Sujet court et accrocheur (max ~60 caractères), peut contenir {{name}}.

Réponds en JSON STRICT : {"subject": "...", "body": "<p>...</p>"}`;

  try {
    const data = await geminiJSON<{ subject: string; body: string }>(prompt);
    let body = data.body || "";
    // Garantit la présence du bloc "autres produits".
    if (!body.includes("{{products_more}}")) body += "\n\n{{products_more}}";
    return ok({ subject: data.subject, body, product: p.key });
  } catch (e) {
    return fail(`Erreur Gemini : ${(e as Error).message}`, 500);
  }
}
