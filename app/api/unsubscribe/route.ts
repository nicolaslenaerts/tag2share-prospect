import { verify } from "@/lib/unsubscribe";
import { addSuppression, normEmail } from "@/lib/suppression";
import { supabaseAdmin } from "@/lib/supabase";
import { DEFAULT_BRAND } from "@/lib/brands";
import { resolveBrandOrDefault } from "@/lib/brands/store";
import { brandColor, type BrandConfig } from "@/lib/brands/types";

export const runtime = "nodejs";

/**
 * Page de désinscription (lien signé dans les emails). Route PUBLIQUE : elle
 * ne passe pas par le middleware, la marque vient donc du paramètre `b` du
 * lien - et non d'un cookie de session.
 *
 * Les anciens liens (émis avant le multi-marque) n'ont pas de `b` : ils sont
 * rattachés à la marque par défaut, et leur signature historique reste
 * acceptée (voir lib/unsubscribe.ts).
 */

function page(brand: BrandConfig, title: string, message: string, status = 200) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);text-align:center;">
    <h1 style="color:${brandColor(brand)};font-size:20px;margin:0 0 12px;">${title}</h1>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0;">${message}</p>
    <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;">${brand.sender.identity.name}</p>
  </div>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function unsubscribe(email: string, brand: BrandConfig) {
  const e = normEmail(email);
  await addSuppression(e, brand.slug, "unsubscribe");

  // Marque les destinataires non encore envoyés comme exclus, dans les
  // campagnes de CETTE marque : une désinscription auprès d'une marque ne doit
  // pas vider les campagnes d'une autre.
  const db = supabaseAdmin();
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id")
    .eq("brand", brand.slug);
  const ids = (campaigns ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  await db
    .from("campaign_recipients")
    .update({ status: "skipped", error: "désinscription" })
    .eq("to_email", e)
    .in("campaign_id", ids)
    .in("status", ["draft", "approved", "test_sent"]);
}

/**
 * Marque du lien : paramètre `b`, sinon marque par défaut (anciens liens).
 *
 * Repli tolérant assumé : une désinscription qui échoue est un risque de
 * plainte spam. Un slug devenu inconnu affiche l'identité par défaut plutôt
 * qu'une erreur - la vérification de signature, elle, reste stricte et refusera
 * le lien si la marque ne correspond pas.
 */
async function linkBrand(searchParams: URLSearchParams): Promise<BrandConfig> {
  const slug = searchParams.get("b");
  return slug ? resolveBrandOrDefault(slug) : DEFAULT_BRAND;
}

// Page de confirmation (clic depuis l'email).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("e") || "";
  const token = searchParams.get("t") || "";
  const brand = await linkBrand(searchParams);
  if (!verify(email, token, brand.slug)) {
    return page(
      brand,
      "Lien invalide",
      "Ce lien de désinscription n'est pas valide ou a expiré.",
      400
    );
  }
  await unsubscribe(email, brand);
  return page(
    brand,
    "Désinscription confirmée",
    `L'adresse <b>${normEmail(email)}</b> ne recevra plus d'emails de notre part.`
  );
}

// One-click (en-tête List-Unsubscribe-Post des clients mail).
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("e") || "";
  const token = searchParams.get("t") || "";
  const brand = await linkBrand(searchParams);
  if (!verify(email, token, brand.slug)) {
    return new Response("invalid", { status: 400 });
  }
  await unsubscribe(email, brand);
  return new Response("ok", { status: 200 });
}
