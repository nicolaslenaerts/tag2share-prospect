import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import {
  brandSender,
  readBrandSettings,
  saveBrandSettings,
  isValidEmail,
  isValidSenderName,
} from "@/lib/brand-sender";

export const runtime = "nodejs";

/**
 * Identité d'expédition de la marque active.
 *
 * GET renvoie trois choses distinctes, pour que l'interface puisse montrer
 * ce qui est enregistré ET ce qui s'appliquera réellement :
 *   - settings  : ce qui est enregistré en base (null = rien de saisi)
 *   - effective : ce qui sera réellement utilisé à l'envoi
 *   - defaults  : le défaut du code, affiché en placeholder
 */
export async function GET(req: Request) {
  const brand = activeBrand(req);
  const [settings, effective] = await Promise.all([
    readBrandSettings(brand.slug),
    brandSender(brand),
  ]);
  return ok({
    brand: { slug: brand.slug, name: brand.name },
    settings,
    effective,
    defaults: {
      from_name: brand.sender.fromName ?? null,
      from_email: brand.sender.from,
      reply_to: brand.sender.replyTo,
      test_email: brand.sender.testEmail ?? null,
    },
  });
}

/**
 * Enregistre l'identité d'expédition. Un champ vide EFFACE la valeur : on
 * retombe alors sur la variable d'environnement puis sur le défaut du code.
 *
 * La validation est stricte parce que ces valeurs finissent dans les en-têtes
 * d'un vrai email : un retour chariot dans le nom d'expéditeur permettrait
 * d'injecter des en-têtes supplémentaires.
 */
export async function PATCH(req: Request) {
  const brand = activeBrand(req);
  const body = await readJson<{
    from_name?: string | null;
    from_email?: string | null;
    reply_to?: string | null;
    test_email?: string | null;
  }>(req);

  const name = (body.from_name ?? "").trim();
  if (name && !isValidSenderName(name))
    return fail(
      "Nom d'expéditeur invalide : pas de chevrons, de guillemets ni de retour à la ligne (120 caractères max).",
      400
    );

  for (const [field, label] of [
    ["from_email", "adresse d'envoi"],
    ["reply_to", "adresse de réponse"],
    ["test_email", "adresse de test"],
  ] as const) {
    const value = ((body as any)[field] ?? "").trim();
    if (value && !isValidEmail(value))
      return fail(`Format d'${label} invalide : ${value}`, 400);
  }

  try {
    const settings = await saveBrandSettings(brand.slug, body);
    const effective = await brandSender(brand);
    return ok({ settings, effective });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
