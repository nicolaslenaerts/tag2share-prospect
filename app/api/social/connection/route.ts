import { supabaseAdmin } from "@/lib/supabase";
import { ok, readJson } from "@/lib/http";
import { activeBrand, requireBrand } from "@/lib/brand-context";
import { brandSender } from "@/lib/brand-sender";
import { bufferAccount, BufferApiError } from "@/lib/social/buffer";
import { encryptionReady } from "@/lib/social/crypto";
import { socialFail } from "@/lib/social/http";
import {
  deleteConnection,
  isMissingTable,
  listChannels,
  loadConnection,
  saveApiKey,
  saveNotifyEmail,
  SocialError,
  syncChannels,
} from "@/lib/social/store";
import type { ConnectionView } from "@/lib/social/types";
import type { BrandConfig } from "@/lib/brands/types";

export const runtime = "nodejs";

/** Vue de la connexion Buffer de la marque active. La clé n'en sort jamais. */
async function view(brand: BrandConfig): Promise<ConnectionView> {
  const db = supabaseAdmin();
  const sender = await brandSender(brand).catch(() => null);
  const base: ConnectionView = {
    ready: true,
    encryptionReady: encryptionReady(),
    connected: false,
    accountEmail: null,
    keyHint: null,
    notifyEmail: null,
    defaultNotifyEmail: sender?.testEmail ?? null,
    connectedAt: null,
    channelsSyncedAt: null,
    channels: [],
  };
  const probe = await db.from("brand_buffer").select("brand").limit(1);
  if (isMissingTable(probe.error)) return { ...base, ready: false };

  const row = await loadConnection(db, brand.slug);
  if (!row) return base;
  return {
    ...base,
    connected: true,
    accountEmail: row.account_email,
    keyHint: row.api_key_hint,
    notifyEmail: row.notify_email,
    connectedAt: row.connected_at,
    channelsSyncedAt: row.channels_synced_at,
    channels: await listChannels(db, brand.slug),
  };
}

export async function GET(req: Request) {
  try {
    return ok(await view(await activeBrand(req)));
  } catch (err) {
    return socialFail(err);
  }
}

/**
 * Connecte (ou remplace) la clé Buffer de la marque, et/ou règle l'adresse de
 * notification. La clé est validée auprès de Buffer AVANT d'être enregistrée.
 */
export async function PUT(req: Request) {
  try {
    const brand = await requireBrand(req);
    const body = await readJson<{ apiKey?: string; notifyEmail?: string | null }>(req);
    const db = supabaseAdmin();

    if (typeof body.apiKey === "string") {
      const key = body.apiKey.trim();
      if (!key) throw new SocialError("Clé API vide.");
      if (!encryptionReady())
        throw new SocialError(
          "SOCIAL_ENCRYPTION_KEY manquante côté serveur : la clé ne peut pas être stockée chiffrée.",
          500
        );
      let account;
      try {
        account = await bufferAccount(key);
      } catch (err) {
        if (err instanceof BufferApiError && err.kind !== "rate_limit" && err.kind !== "network")
          throw new SocialError(
            "Clé refusée par Buffer. Vérifiez qu'elle a bien été générée dans Buffer → Settings → API et qu'elle n'a pas été révoquée.",
            401
          );
        throw err;
      }
      await saveApiKey(db, brand.slug, key, account.email);
      await syncChannels(db, brand.slug, key);
    }

    if (body.notifyEmail !== undefined) await saveNotifyEmail(db, brand.slug, body.notifyEmail);
    return ok(await view(brand));
  } catch (err) {
    return socialFail(err);
  }
}

/** Déconnecte la marque. Les posts déjà programmés restent dans Buffer. */
export async function DELETE(req: Request) {
  try {
    const brand = await requireBrand(req);
    await deleteConnection(supabaseAdmin(), brand.slug);
    return ok(await view(brand));
  } catch (err) {
    return socialFail(err);
  }
}
