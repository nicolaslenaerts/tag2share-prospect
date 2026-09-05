import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { BRAND_COOKIE, BRAND_HEADER } from "@/lib/brand-cookie";
// Validation de FORME uniquement : lib/brands/schema.ts n'a aucune dépendance
// serveur, il peut donc être chargé par le runtime Edge (contrairement à
// lib/brand-context.ts, qui lit la base).
import { SLUG_RE } from "@/lib/brands/schema";

/**
 * Protège l'ensemble de l'application par mot de passe partagé.
 * Exceptions publiques (validation propre côté handler) :
 *   - /api/unsubscribe       (lien signé dans les emails)
 *   - /api/webhooks/resend   (signature Resend)
 *   - /login + /api/auth/*   (parcours de connexion)
 *
 * Pose aussi l'en-tête `x-brand` d'après le cookie de préférence, pour que les
 * routes API n'aient pas à re-parser le cookie et ne puissent pas recevoir un
 * slug arbitraire depuis le réseau.
 */

const PUBLIC_PREFIXES = ["/api/unsubscribe", "/api/webhooks/resend", "/login", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

/**
 * Poursuit la requête en injectant la marque demandée dans les en-têtes.
 *
 * Le middleware tourne sur le runtime Edge et ne peut pas interroger la base :
 * depuis que des marques y sont créées, il ne peut plus valider le slug contre
 * le registre. Il ne fait donc que deux choses, les seules qui relèvent de lui :
 *   - refuser une valeur qui n'a pas la FORME d'un slug (un cookie est une
 *     entrée non fiable, et cette valeur finit dans des requêtes SQL) ;
 *   - retirer tout en-tête `x-brand` entrant, qui permettrait sinon de choisir
 *     sa marque depuis le réseau.
 *
 * La validation réelle a lieu dans les handlers (lib/brand-context.ts), qui
 * eux lisent le registre complet. En l'absence de cookie exploitable, aucun
 * en-tête n'est posé : le handler peut alors déduire la marque du DOMAINE.
 */
function nextWithBrand(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(BRAND_HEADER);
  const cookie = req.cookies.get(BRAND_COOKIE)?.value?.trim().toLowerCase();
  if (cookie && SLUG_RE.test(cookie)) headers.set(BRAND_HEADER, cookie);
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
