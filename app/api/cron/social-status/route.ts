import { supabaseAdmin } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { safeEqual } from "@/lib/auth";
import { socialFail } from "@/lib/social/http";
import { syncPublications } from "@/lib/social/status";

export const runtime = "nodejs";
// Un appel Buffer par canal (et par post échu pour le suivi) : au-delà des 10 s par défaut.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Cron de suivi des publications (toutes marques) : statuts, liens publics et
 * emails de notification. À appeler toutes les 1 à 5 minutes.
 *
 * Route PUBLIQUE pour le middleware (un planificateur n'a pas le cookie de
 * session) : l'accès est protégé ici par CRON_SECRET, envoyé en
 * `Authorization: Bearer <secret>`, convention des Vercel Cron Jobs.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail("CRON_SECRET non configuré.", 503);
  const header = req.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) return fail("Non autorisé.", 401);
  try {
    return ok(await syncPublications(supabaseAdmin()));
  } catch (err) {
    return socialFail(err);
  }
}

export const GET = run;
export const POST = run;
