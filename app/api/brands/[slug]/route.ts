import { ok, fail, readJson } from "@/lib/http";
import { brandSender } from "@/lib/brand-sender";
import { brandReadiness } from "@/lib/brands/readiness";
import { webhookUrl } from "@/lib/public-url";
import {
  BrandWriteError,
  brandUsage,
  clearSenderOverride,
  deleteBrand,
  listBrandRows,
  setBrandActive,
  updateBrand,
} from "@/lib/brands/store";
import type { BrandConfig } from "@/lib/brands/types";

export const runtime = "nodejs";

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
 * Ce qui s'appliquera réellement à l'envoi. Renvoyé à côté de la configuration
 * saisie : tant qu'une surcharge héritée existe, les deux diffèrent, et
 * n'afficher que le formulaire laisserait croire qu'il fait foi.
 */
async function effectiveOf(brand: BrandConfig) {
  const s = await brandSender(brand);
  return {
    from: s.from,
    fromEmail: s.fromEmail,
    replyTo: s.replyTo,
    testEmail: s.testEmail ?? null,
    dailyCap: s.dailyCap,
    delayMs: s.delayMs,
    fromSource: s.fromSource,
  };
}

async function row(slug: string) {
  return (await listBrandRows()).find((r) => r.slug === slug);
}

/**
 * Une marque, telle qu'elle doit être affichée dans l'éditeur : sa
 * configuration, son état d'activation, ce qui bloque encore, et le volume de
 * données qui y est rattaché (une marque utilisée ne se supprime pas).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const r = await row(slug);
    if (!r) return fail(`Marque introuvable : « ${slug} ».`, 404);
    return ok({
      slug: r.slug,
      source: r.source,
      editable: r.source === "db",
      active: r.active,
      config: r.brand ?? r.config,
      errors: r.errors ?? null,
      updatedAt: r.updatedAt ?? null,
      usage: await brandUsage(slug),
      readiness: r.brand ? await readinessOf(r.brand) : null,
      effective: r.brand ? await effectiveOf(r.brand) : null,
      // Affiché tel quel dans l'interface : c'est l'adresse à déclarer chez
      // Resend, et elle suit désormais le domaine public de la marque.
      webhookUrl: r.brand ? webhookUrl(r.brand) : null,
    });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

/**
 * Met à jour la configuration (`config`) ou l'état d'activation (`active`).
 *
 * L'activation est REFUSÉE tant qu'un blocage subsiste. Volontairement sans
 * échappatoire : l'unique raison d'être du mode brouillon est d'empêcher un
 * envoi sous une identité non vérifiée, et un bouton « forcer » la viderait
 * de son sens.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await readJson<{ config?: unknown; active?: boolean; clearOverride?: boolean }>(req);

  try {
    if (body.clearOverride === true) {
      await clearSenderOverride(slug);
      const r = await row(slug);
      if (!r?.brand) return fail(`Marque introuvable ou invalide : « ${slug} ».`, 404);
      return ok({
        config: r.brand,
        active: r.active,
        readiness: await readinessOf(r.brand),
        effective: await effectiveOf(r.brand),
      });
    }

    if (body.config !== undefined) {
      const record = await updateBrand(slug, body.config);
      return ok({
        config: record.brand,
        active: record.active,
        readiness: await readinessOf(record.brand),
        effective: await effectiveOf(record.brand),
        webhookUrl: webhookUrl(record.brand),
      });
    }

    if (typeof body.active === "boolean") {
      if (body.active) {
        const r = await row(slug);
        if (!r?.brand) return fail(`Marque introuvable ou invalide : « ${slug} ».`, 404);
        const readiness = await readinessOf(r.brand);
        if (!readiness.ok) {
          return fail(
            `Activation impossible. ${readiness.blockers.join(" ")}`,
            409
          );
        }
      }
      const record = await setBrandActive(slug, body.active);
      return ok({
        config: record.brand,
        active: record.active,
        readiness: await readinessOf(record.brand),
        effective: await effectiveOf(record.brand),
      });
    }

    return fail("Rien à modifier : fournissez `config`, `active` ou `clearOverride`.");
  } catch (e) {
    if (e instanceof BrandWriteError) return fail(e.message, e.status);
    return fail((e as Error).message, 500);
  }
}

/** Supprime une marque de base. Refusé dès qu'une donnée la référence. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    await deleteBrand(slug);
    return ok({ deleted: slug });
  } catch (e) {
    if (e instanceof BrandWriteError) return fail(e.message, e.status);
    return fail((e as Error).message, 500);
  }
}
