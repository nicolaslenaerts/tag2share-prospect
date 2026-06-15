import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";

/**
 * Protège l'ensemble de l'application par mot de passe partagé.
 * Exceptions publiques (validation propre côté handler) :
 *   - /api/unsubscribe       (lien signé dans les emails)
 *   - /api/webhooks/resend   (signature Resend)
 *   - /login + /api/auth/*   (parcours de connexion)
 */

const PUBLIC_PREFIXES = ["/api/unsubscribe", "/api/webhooks/resend", "/login", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifyToken(token)) return NextResponse.next();

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
