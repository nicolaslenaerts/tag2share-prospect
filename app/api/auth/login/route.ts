import { NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, expectedToken, safeEqual } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    return NextResponse.json(
      { error: "Authentification non configurée (APP_PASSWORD manquant)." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const password = body && typeof body.password === "string" ? body.password : "";

  if (!safeEqual(password, pw)) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
