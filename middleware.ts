import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { BRAND_COOKIE, BRAND_HEADER } from "@/lib/brand-context";
import { DEFAULT_BRAND, findBrand } from "@/lib/brands";

/**
 * Protège l'ensemble de l'application par mot de passe partagé.
 * Exceptions publiques (validation propre côté handler) :
 *   - /api/unsubscribe       (lien signé dans les emails)
 *   - /api/webhooks/resend   (signature Resend)
 *   - /login + /api/auth/*   (parcours de connexion)
 *
 * Pose aussi l'en-tête `x-brand` (marque active, validée contre le registre)
 * pour que les routes API n'aient pas à re-parser le cookie et ne puissent pas
 * recevoir un slug arbitraire.
 */

const PUBLIC_PREFIXES = ["/api/unsubscribe", "/api/webhooks/resend", "/login", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

/**
 * Poursuit la requête en injectant la marque active dans les en-têtes.
 * Un slug inconnu (marque retirée du registre) retombe sur la marque par
 * défaut plutôt que de casser la session.
 */
function nextWithBrand(req: NextRequest) {
  const slug = findBrand(req.cookies.get(BRAND_COOKIE)?.value)?.slug ?? DEFAULT_BRAND.slug;
  const headers = new Headers(req.headers);
  headers.set(BRAND_HEADER, slug);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifyToken(token)) return nextWithBrand(req);

  // Non authentifié : 401 pour les API, redirection vers /login pour les pages.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les assets statiques de Next et le favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
