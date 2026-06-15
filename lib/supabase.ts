import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Client admin (service_role) - À N'UTILISER QUE CÔTÉ SERVEUR (route handlers).
 * Contourne la RLS : ne jamais l'exposer au navigateur.
 */
export function supabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error(
      "Variables Supabase manquantes (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
