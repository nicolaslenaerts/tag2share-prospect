import { ok, fail, readJson } from "@/lib/http";
import { brandSender } from "@/lib/brand-sender";
import { brandReadiness } from "@/lib/brands/readiness";
import { BrandWriteError, createBrand, listBrandRows } from "@/lib/brands/store";
import type { BrandConfig } from "@/lib/brands/types";

export const runtime = "nodejs";

/** Diagnostic d'activation d'une marque, identité d'expédition résolue. */
async function readinessOf(brand: BrandConfig) {
  const sender = await brandSender(brand);
  return brandReadiness(brand, {
    fromEmail: sender.fromEmail,
    replyTo: sender.replyTo,
    testEmail: sender.testEmail,
    fromSource: sender.fromSource,
  });
}

/**
 * Registre complet : marques déclarées en code ET marques créées ici.
 *
 * Les lignes dont la configuration est invalide sont renvoyées AVEC leurs
 * erreurs plutôt qu'écartées : l'écran d'administration est le seul endroit
 * d'où l'on puisse les réparer.
 */
export async function GET() {
  try {
    const rows = await listBrandRows();
    const brands = await Promise.all(
      rows.map(async (r) => ({
        slug: r.slug,
        source: r.source,
        active: r.active,
        editable: r.source === "db",
        name: r.brand?.name ?? r.slug,
        monogram: r.brand?.theme.monogram ?? "??",
        appUrl: r.brand?.appUrl ?? null,
        productCount: r.brand?.products.length ?? 0,
        updatedAt: r.updatedAt ?? null,
        errors: r.errors ?? null,
        readiness: r.brand ? await readinessOf(r.brand) : null,
      }))
    );
    return ok({ brands });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

/**
 * Crée une marque. Elle naît en BROUILLON : segments, rédaction IA et emails
 * de test fonctionnent, l'envoi réel reste bloqué jusqu'à activation explicite.
 */
export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  try {
    const record = await createBrand(body);
    return ok({ brand: record.brand, active: record.active, readiness: await readinessOf(record.brand) }, 201);
  } catch (e) {
    if (e instanceof BrandWriteError) return fail(e.message, e.status);
    return fail((e as Error).message, 500);
  }
}
