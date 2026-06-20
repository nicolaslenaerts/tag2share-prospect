import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { suppressionMap, normEmail } from "@/lib/suppression";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Détail d'une campagne + destinataires (avec le prospect joint)
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: campaign, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
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
    .select("*, prospect:prospects(*, segment:segments!prospects_segment_id_fkey(*))")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  if (rErr) return fail(rErr.message, 500);

  // Marque les destinataires désinscrits / bouncés / plaints.
  const suppressed = await suppressionMap(
    (recipients ?? []).map((r) => r.to_email || r.prospect?.email).filter(Boolean)
  );

  // Marque les destinataires DÉJÀ contactés (toutes campagnes confondues), par
  // adresse email, d'après le journal immuable des envois réussis. Permet de les
  // regrouper dans la vue avant même toute tentative d'envoi.
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
  if (emailsForCheck.length > 0) {
    const { data: logs } = await db
      .from("email_log")
      .select("to_email, campaign_name, product_name, created_at")
      .eq("status", "sent")
      .in("to_email", emailsForCheck);
    for (const row of logs ?? []) {
      const e = normEmail(row.to_email);
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
    };
  });

  return ok({ campaign, recipients: recipientsMarked });
}

// Mise à jour du template (sujet/corps/nom/statut)
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const fields = await readJson<any>(req);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("campaigns")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) return fail(error.message, 500);
  return ok({ campaign: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { error } = await db.from("campaigns").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: id });
}
