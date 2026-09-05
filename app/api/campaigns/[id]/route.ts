import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";
import { activeBrand } from "@/lib/brand-context";
import { resolveProspectSegments } from "@/lib/campaign-segments";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Détail d'une campagne + destinataires (avec le prospect joint)
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { data: campaign, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("brand", brand.slug)
    .single();
  if (error) return fail(error.message, 404);

  // Segments ciblés (multi-segment).
  const { data: links } = await db
    .from("campaign_segments")
    .select("segment:segments(id, label, product)")
    .eq("campaign_id", id);
  (campaign as any).segments = (links ?? [])
    .map((l) => l.segment)
    .filter(Boolean);

  const { data: recipients, error: rErr } = await db
    .from("campaign_recipients")
    .select("*, prospect:prospects(*)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  if (rErr) return fail(rErr.message, 500);

  // Segment porteur du produit, résolu EXACTEMENT comme à l'envoi (segment de
  // la campagne, donc de sa marque). L'aperçu de l'UI montre ainsi le produit
  // qui partira réellement, et non le segment d'origine du prospect - qui peut
  // appartenir à une autre marque, le vivier étant partagé.
  const resolvedSegments = await resolveProspectSegments(
    db,
    id,
    brand.slug,
    (recipients ?? []).map((r) => r.prospect_id).filter(Boolean)
  );

  // Marque les destinataires désinscrits / bouncés / plaints.
  const suppressed = await suppressionMap(
    (recipients ?? []).map((r) => r.to_email || r.prospect?.email).filter(Boolean),
    brand.slug
  );

  // Marque les destinataires DÉJÀ contactés (toutes campagnes confondues), par
  // adresse email, d'après le journal immuable des envois réussis. Permet de les
  // regrouper dans la vue avant même toute tentative d'envoi.
  //
  // Le vivier de prospects étant partagé entre marques, on distingue :
  //  - "déjà contacté" = par CETTE marque (bloquant à l'envoi),
  //  - other_brands    = par une autre marque (information, non bloquant).
  const emailsForCheck = Array.from(
    new Set(
      (recipients ?? [])
        .map((r) => normEmail(r.to_email || r.prospect?.email || ""))
        .filter(Boolean)
    )
  );
  const contacted = new Map<
    string,
    { at: string | null; campaigns: string[]; products: string[] }
  >();
  const otherBrands = new Map<string, string[]>();
  if (emailsForCheck.length > 0) {
    const { data: logs } = await db
      .from("email_log")
      .select("to_email, campaign_name, product_name, created_at, brand")
      .eq("status", "sent")
      .in("to_email", emailsForCheck);
    for (const row of logs ?? []) {
      const e = normEmail(row.to_email);
      if (row.brand && row.brand !== brand.slug) {
        const list = otherBrands.get(e) ?? [];
        if (!list.includes(row.brand)) list.push(row.brand);
        otherBrands.set(e, list);
        continue;
      }
      const cur = contacted.get(e) ?? { at: null, campaigns: [], products: [] };
      if (row.created_at && (!cur.at || row.created_at < cur.at)) cur.at = row.created_at;
      if (row.campaign_name && !cur.campaigns.includes(row.campaign_name))
        cur.campaigns.push(row.campaign_name);
      if (row.product_name && !cur.products.includes(row.product_name))
        cur.products.push(row.product_name);
      contacted.set(e, cur);
    }
  }

  const recipientsMarked = (recipients ?? []).map((r) => {
    const email = r.to_email || r.prospect?.email;
    const reason = email ? suppressed.get(normEmail(email)) ?? null : null;
    const info = email ? contacted.get(normEmail(email)) : undefined;
    return {
      ...r,
      suppressed: !!reason,
      suppression_reason: reason,
      emailed: !!info,
      emailed_at: info?.at ?? null,
      emailed_campaigns: info?.campaigns ?? [],
      emailed_products: info?.products ?? [],
      other_brands: email ? otherBrands.get(normEmail(email)) ?? [] : [],
      resolved_segment: resolvedSegments.get(r.prospect_id) ?? null,
    };
  });

  return ok({ campaign, recipients: recipientsMarked });
}

// Mise à jour du template (sujet/corps/nom/statut)
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const brand = await activeBrand(req);
  // `brand` n'est pas modifiable : déplacer une campagne d'une marque à l'autre
  // rendrait son email (catalogue, identité, UTM) incohérent avec ses envois
  // déjà journalisés.
  const { brand: _ignored, ...fields } = await readJson<any>(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("campaigns")
    .update(fields)
    .eq("id", id)
    .eq("brand", brand.slug)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ campaign: data });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const { error } = await db
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("brand", brand.slug);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
