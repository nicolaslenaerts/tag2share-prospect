import { verify } from "@/lib/unsubscribe";
import { addSuppression, normEmail } from "@/lib/suppression";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function page(title: string, message: string, status = 200) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);text-align:center;">
    <h1 style="color:rgb(20,74,102);font-size:20px;margin:0 0 12px;">${title}</h1>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0;">${message}</p>
  </div>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function unsubscribe(email: string) {
  const e = normEmail(email);
  await addSuppression(e, "unsubscribe");
  // Marque les destinataires non encore envoyés comme exclus.
  const db = supabaseAdmin();
  await db
    .from("campaign_recipients")
    .update({ status: "skipped", error: "désinscription" })
    .eq("to_email", e)
    .in("status", ["draft", "approved", "test_sent"]);
}

// Page de confirmation (clic depuis l'email).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("e") || "";
  const token = searchParams.get("t") || "";
  if (!verify(email, token)) {
    return page("Lien invalide", "Ce lien de désinscription n'est pas valide ou a expiré.", 400);
  }
  await unsubscribe(email);
  return page(
    "Désinscription confirmée",
    `L'adresse <b>${normEmail(email)}</b> ne recevra plus d'emails de notre part.`
  );
}

// One-click (en-tête List-Unsubscribe-Post des clients mail).
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("e") || "";
  const token = searchParams.get("t") || "";
  if (!verify(email, token)) {
    return new Response("invalid", { status: 400 });
  }
  await unsubscribe(email);
  return new Response("ok", { status: 200 });
}
