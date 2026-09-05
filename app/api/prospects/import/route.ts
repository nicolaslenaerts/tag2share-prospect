import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import {
  cleanRow,
  checkRow,
  identityKeys,
  mergeProspect,
  COPYABLE,
  type ImportRow,
  type ImportReport,
} from "@/lib/prospect-import";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Plafond par requête : le client découpe les gros fichiers en lots. */
const MAX_ROWS = 500;

/**
 * Import d'un lot de prospects issus d'un fichier.
 *
 * Le vivier étant partagé entre marques, on ne crée JAMAIS un doublon d'un
 * business déjà connu : une ligne qui correspond à un prospect existant le
 * complète (voir mergeProspect) et le rattache au segment visé. Ce qui est
 * relatif à la marque - le segment - est vérifié en amont.
 */
export async function POST(req: Request) {
  const { segmentId, rows, filename, offset } = await readJson<{
    segmentId: string;
    rows: ImportRow[];
    filename?: string;
    offset?: number;
  }>(req);

  if (!segmentId) return fail("segmentId requis.");
  if (!Array.isArray(rows) || rows.length === 0) return fail("Aucune ligne à importer.");
  if (rows.length > MAX_ROWS)
    return fail(`Lot trop grand (${rows.length} lignes, maximum ${MAX_ROWS}).`);

  const brand = await activeBrand(req);
  const db = supabaseAdmin();

  // Le segment doit appartenir à la marque active.
  const { data: segment, error: segErr } = await db
    .from("segments")
    .select("id, label")
    .eq("id", segmentId)
    .eq("brand", brand.slug)
    .single();
  if (segErr || !segment) return fail("Segment introuvable.", 404);

  const report: ImportReport = {
    received: rows.length,
    created: 0,
    merged: 0,
    duplicates: 0,
    droppedEmails: 0,
    skipped: [],
  };

  // Numéro de ligne affiché à l'utilisateur. Le client envoie l'index réel de
  // la première ligne du lot DANS le fichier (en-tête compris s'il y en a un) ;
  // on ne fait que passer d'un index 0 à une numérotation humaine.
  const base = (offset ?? 0) + 1;

  // 1. Nettoyage + validation ligne à ligne.
  const candidates: { row: ImportRow; line: number }[] = [];
  rows.forEach((raw, i) => {
    const line = base + i;
    const row = cleanRow(raw || {});
    const { reason, droppedEmail } = checkRow(row);
    if (reason) {
      report.skipped.push({ line, reason });
      return;
    }
    if (droppedEmail) {
      report.droppedEmails++;
      row.email = "";
    }
    candidates.push({ row, line });
  });
  if (candidates.length === 0) return ok({ report });

  // 2. Déduplication interne au fichier (deux lignes pour le même business).
  const seen = new Set<string>();
  const unique: { row: ImportRow; line: number }[] = [];
  for (const c of candidates) {
    const keys = identityKeys(c.row);
    if (keys.some((k) => seen.has(k))) {
      report.duplicates++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    unique.push(c);
  }

  // 3. Index du vivier existant. On lit tout le vivier plutôt que de filtrer
  //    par .in() : la liste de clés serait bien trop longue pour une URL, et
  //    le codebase a déjà été mordu par ce problème (voir /api/prospects).
  //
  //    ⚠️ PostgREST plafonne un select à 1000 lignes par défaut. Sans pagination
  //    explicite, la déduplication ignorerait tout le vivier au-delà de la
  //    1000e ligne et recréerait en double des prospects déjà connus.
  const PAGE = 1000;
  const byKey = new Map<string, any>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("prospects")
      .select("id, name, email, contact_name, website, phone, address, city, country, category")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return fail(error.message, 500);
    for (const p of data ?? []) {
      for (const k of identityKeys(p)) if (!byKey.has(k)) byKey.set(k, p);
    }
    if (!data || data.length < PAGE) break;
  }

  // 4. Répartition : mise à jour d'un existant, ou création.
  const toInsert: { row: ImportRow; line: number }[] = [];
  const toUpdate: { id: string; patch: Record<string, string> }[] = [];
  const touched = new Set<string>();

  for (const c of unique) {
    const match = identityKeys(c.row)
      .map((k) => byKey.get(k))
      .find(Boolean);
    if (match) {
      touched.add(match.id);
      report.merged++;
      const patch = mergeProspect(match, c.row);
      if (patch) toUpdate.push({ id: match.id, patch });
    } else {
      toInsert.push(c);
    }
  }

  // 5. Créations. `source` vient de la migration 0014 : si elle n'a pas encore
  //    été jouée, on retombe sur un insert sans la colonne plutôt que de perdre
  //    l'import, et on le signale dans le rapport.
  if (toInsert.length) {
    const build = (withSource: boolean) =>
      toInsert.map(({ row }) => {
        const r: Record<string, any> = { status: "found", segment_id: segmentId };
        for (const f of COPYABLE) if ((row as any)[f]) r[f] = (row as any)[f];
        if (withSource) r.source = "csv";
        return r;
      });

    let { data: inserted, error } = await db
      .from("prospects")
      .insert(build(true))
      .select("id");

    if (error && /source/i.test(error.message)) {
      report.warning =
        "Colonne `source` absente : import réalisé sans traçabilité d'origine. Jouez la migration 0014_prospects_source.sql.";
      ({ data: inserted, error } = await db
        .from("prospects")
        .insert(build(false))
        .select("id"));
    }
    if (error) return fail(error.message, 500);

    report.created = inserted?.length ?? 0;
    for (const p of inserted ?? []) touched.add(p.id);
  }

  // 6. Complétion des prospects existants (concurrence bornée).
  const CHUNK = 10;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    await Promise.all(
      toUpdate
        .slice(i, i + CHUNK)
        .map((u) => db.from("prospects").update(u.patch).eq("id", u.id))
    );
  }

  // 7. Rattachement au segment (idempotent via la clé primaire composée).
  const ids = [...touched];
  if (ids.length) {
    const { error: linkErr } = await db
      .from("segment_prospects")
      .upsert(
        ids.map((prospect_id) => ({ segment_id: segmentId, prospect_id })),
        { onConflict: "segment_id,prospect_id", ignoreDuplicates: true }
      );
    if (linkErr) return fail(linkErr.message, 500);
  }

  // 8. Journal : un import apparaît dans l'historique du segment, au même
  //    titre qu'une recherche Places.
  await db.from("searches").insert({
    brand: brand.slug,
    segment_id: segmentId,
    country: null,
    city: null,
    zone: `Import ${filename ? `« ${filename} »` : "fichier"}`,
    max_results: null,
    found_count: report.created + report.merged,
    new_count: report.created,
  });

  return ok({ report });
}
