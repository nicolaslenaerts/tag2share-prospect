import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, readJson } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";
import { labelKey } from "@/lib/segment-matching";
import {
  cleanRow,
  checkRow,
  identityKeys,
  mergeProspect,
  COPYABLE,
  type ImportRow,
  type ImportReport,
} from "@/lib/prospect-import";
import { seedFromOtherBrand } from "@/lib/prospect-seed";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Plafond par requête : le client découpe les gros fichiers en lots. */
const MAX_ROWS = 500;

/**
 * Import d'un lot de prospects issus d'un fichier.
 *
 * Le vivier est cloisonné par marque (migration 0015) : on ne crée jamais un
 * doublon d'un business déjà connu DE CETTE MARQUE (une ligne qui correspond à
 * un prospect existant le complète, voir mergeProspect, et le rattache au
 * segment visé), et on ne touche jamais aux prospects d'une autre marque - on
 * reprend seulement leur enrichissement à la création (lib/prospect-seed).
 *
 * Deux modes de rattachement :
 *  - `segmentId` : tout le fichier va dans le même segment ;
 *  - `segmentMap` : une cible PAR CATÉGORIE (clé de rapprochement -> segment),
 *    résolue et créée en amont par /api/segments/resolve. La clé "" est le
 *    repli des lignes sans catégorie ; sans elle, ces lignes sont ignorées.
 */
export async function POST(req: Request) {
  const { segmentId, segmentMap, rows, filename, offset } = await readJson<{
    segmentId?: string;
    segmentMap?: Record<string, string>;
    rows: ImportRow[];
    filename?: string;
    offset?: number;
  }>(req);

  const hasMap = !!segmentMap && Object.keys(segmentMap).length > 0;
  if (!segmentId && !hasMap) return fail("segmentId ou segmentMap requis.");
  if (!Array.isArray(rows) || rows.length === 0) return fail("Aucune ligne à importer.");
  if (rows.length > MAX_ROWS)
    return fail(`Lot trop grand (${rows.length} lignes, maximum ${MAX_ROWS}).`);

  const brand = await activeBrand(req);
  const db = supabaseAdmin();

  // Tous les segments visés doivent appartenir à la marque active. Une seule
  // requête : le cloisonnement entre marques est applicatif, il ne se délègue
  // pas au client (voir lib/brand-context).
  const targetIds = [...new Set([segmentId, ...Object.values(segmentMap ?? {})].filter(Boolean))] as string[];
  const { data: segmentRows, error: segErr } = await db
    .from("segments")
    .select("id, label")
    .eq("brand", brand.slug)
    .in("id", targetIds);
  if (segErr) return fail(segErr.message, 500);

  const segmentsById = new Map((segmentRows ?? []).map((s) => [s.id, s]));
  const unknown = targetIds.filter((id) => !segmentsById.has(id));
  if (unknown.length) return fail("Segment introuvable.", 404);

  /** Segment cible d'une ligne, selon son libellé de catégorie. */
  const targetFor = (row: ImportRow): string | null =>
    (hasMap ? segmentMap![labelKey(row.category)] : null) ?? segmentId ?? null;

  const report: ImportReport = {
    received: rows.length,
    created: 0,
    merged: 0,
    duplicates: 0,
    droppedEmails: 0,
    skipped: [],
    segments: [],
  };

  /** Compteurs par segment, pour le rapport et le journal. */
  const tallies = new Map<string, { id: string; created: number; merged: number }>();
  const tally = (id: string) => {
    let t = tallies.get(id);
    if (!t) tallies.set(id, (t = { id, created: 0, merged: 0 }));
    return t;
  };

  // Numéro de ligne affiché à l'utilisateur. Le client envoie l'index réel de
  // la première ligne du lot DANS le fichier (en-tête compris s'il y en a un) ;
  // on ne fait que passer d'un index 0 à une numérotation humaine.
  const base = (offset ?? 0) + 1;

  // 1. Nettoyage + validation ligne à ligne. Une ligne dont la catégorie ne
  //    mène à aucun segment est ignorée plutôt que rattachée au hasard.
  const candidates: { row: ImportRow; line: number; target: string }[] = [];
  rows.forEach((raw, i) => {
    const line = base + i;
    const row = cleanRow(raw || {});
    const { reason, droppedEmail } = checkRow(row);
    if (reason) {
      report.skipped.push({ line, reason });
      return;
    }
    const target = targetFor(row);
    if (!target) {
      report.skipped.push({
        line,
        reason: row.category
          ? `catégorie « ${row.category} » non rattachée à un segment`
          : "aucune catégorie et aucun segment de repli",
      });
      return;
    }
    if (droppedEmail) {
      report.droppedEmails++;
      row.email = "";
    }
    candidates.push({ row, line, target });
  });
  if (candidates.length === 0) return ok({ report });

  // 2. Déduplication interne au fichier (deux lignes pour le même business).
  //    Un business listé deux fois sous deux catégories n'est créé qu'une fois,
  //    mais est rattaché aux DEUX segments : le doublon apporte une cible de
  //    plus, il ne la remplace pas.
  type Entry = { row: ImportRow; line: number; targets: Set<string> };
  const seen = new Map<string, Entry>();
  const unique: Entry[] = [];
  for (const c of candidates) {
    const keys = identityKeys(c.row);
    const hit = keys.map((k) => seen.get(k)).find(Boolean);
    if (hit) {
      hit.targets.add(c.target);
      report.duplicates++;
      continue;
    }
    const entry: Entry = { row: c.row, line: c.line, targets: new Set([c.target]) };
    keys.forEach((k) => seen.set(k, entry));
    unique.push(entry);
  }

  // 3. Index du vivier existant. On lit tout le vivier plutôt que de filtrer
  //    par .in() : la liste de clés serait bien trop longue pour une URL, et
  //    le codebase a déjà été mordu par ce problème (voir /api/prospects).
  //
  //    ⚠️ PostgREST plafonne un select à 1000 lignes par défaut. Sans pagination
  //    explicite, la déduplication ignorerait tout le vivier au-delà de la
  //    1000e ligne et recréerait en double des prospects déjà connus.
  //
  //    Deux index en sortent, sur la même lecture :
  //      byKey      : prospects de CETTE marque -> cible d'une fusion ;
  //      donorByKey : prospects des AUTRES marques -> source d'enrichissement
  //                   à la création, jamais modifiée (lib/prospect-seed).
  const PAGE = 1000;
  const byKey = new Map<string, any>();
  const donorByKey = new Map<string, { id: string; status: string | null }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("prospects")
      .select(
        "id, brand, status, name, email, contact_name, website, phone, address, city, country, category"
      )
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return fail(error.message, 500);
    for (const p of data ?? []) {
      if (p.brand === brand.slug) {
        for (const k of identityKeys(p)) if (!byKey.has(k)) byKey.set(k, p);
      } else {
        for (const k of identityKeys(p)) {
          // Une fiche enrichie prime sur une fiche seulement trouvée.
          const cur = donorByKey.get(k);
          if (!cur || (cur.status !== "enriched" && p.status === "enriched"))
            donorByKey.set(k, { id: p.id, status: p.status });
        }
      }
    }
    if (!data || data.length < PAGE) break;
  }

  // 4. Répartition : mise à jour d'un existant, ou création.
  const toInsert: Entry[] = [];
  const toUpdate: { id: string; patch: Record<string, string> }[] = [];
  /** prospect -> segments auxquels le rattacher (étape 7). */
  const links = new Map<string, Set<string>>();
  const addLinks = (prospectId: string, targets: Set<string>) => {
    const set = links.get(prospectId) ?? new Set<string>();
    targets.forEach((t) => set.add(t));
    links.set(prospectId, set);
  };

  for (const c of unique) {
    const match = identityKeys(c.row)
      .map((k) => byKey.get(k))
      .find(Boolean);
    if (match) {
      addLinks(match.id, c.targets);
      report.merged++;
      for (const t of c.targets) tally(t).merged++;
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
    // Enrichissement déjà payé par une autre marque : on ne lit les fiches
    // complètes que pour les lignes réellement créées (le blob `enrichment`
    // est trop lourd pour être paginé sur tout le vivier à l'étape 3).
    const donorIds = [
      ...new Set(
        toInsert
          .map((c) => identityKeys(c.row).map((k) => donorByKey.get(k)?.id).find(Boolean))
          .filter(Boolean) as string[]
      ),
    ];
    const donorById = new Map<string, any>();
    const LOOKUP = 100; // borne la longueur de l'URL PostgREST
    for (let i = 0; i < donorIds.length; i += LOOKUP) {
      const { data: rows, error: dErr } = await db
        .from("prospects")
        .select(
          "id, status, email, contact_name, logo_url, phone, website, address, city, country, enrichment"
        )
        .in("id", donorIds.slice(i, i + LOOKUP));
      if (dErr) return fail(dErr.message, 500);
      for (const d of rows ?? []) donorById.set(d.id, d);
    }
    const donorFor = (row: ImportRow) => {
      const id = identityKeys(row).map((k) => donorByKey.get(k)?.id).find(Boolean);
      return id ? donorById.get(id) : undefined;
    };

    // `segment_id` est le segment d'ORIGINE du prospect (voir schema.sql) :
    // la première cible de la ligne. L'appartenance complète vit dans
    // segment_prospects, écrite à l'étape 7.
    const build = (withSource: boolean) =>
      toInsert.map(({ row, targets }) => {
        const r: Record<string, any> = {
          brand: brand.slug,
          status: "found",
          segment_id: [...targets][0],
        };
        for (const f of COPYABLE) if ((row as any)[f]) r[f] = (row as any)[f];
        Object.assign(r, seedFromOtherBrand(r, donorFor(row)));
        if (withSource) r.source = "csv";
        return r;
      });

    let { data: inserted, error } = await db
      .from("prospects")
      .insert(build(true))
      .select("id, name, email, website, city");

    if (error && /source/i.test(error.message)) {
      report.warning =
        "Colonne `source` absente : import réalisé sans traçabilité d'origine. Jouez la migration 0014_prospects_source.sql.";
      ({ data: inserted, error } = await db
        .from("prospects")
        .insert(build(false))
        .select("id, name, email, website, city"));
    }
    if (error) return fail(error.message, 500);

    report.created = inserted?.length ?? 0;
    // Réassociation id <-> segments cibles par IDENTITÉ plutôt que par
    // position : l'ordre de retour de PostgREST n'est pas contractuel, et se
    // tromper ici rattacherait des prospects au mauvais segment sans erreur.
    const insertedByKey = new Map<string, string>();
    for (const p of inserted ?? [])
      for (const k of identityKeys(p)) if (!insertedByKey.has(k)) insertedByKey.set(k, p.id);
    for (const entry of toInsert) {
      const id = identityKeys(entry.row)
        .map((k) => insertedByKey.get(k))
        .find(Boolean);
      if (!id) continue;
      addLinks(id, entry.targets);
      for (const t of entry.targets) tally(t).created++;
    }
  }

  // 6. Complétion des prospects existants (concurrence bornée).
  const CHUNK = 10;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    await Promise.all(
      toUpdate
        .slice(i, i + CHUNK)
        .map((u) =>
          db.from("prospects").update(u.patch).eq("id", u.id).eq("brand", brand.slug)
        )
    );
  }

  // 7. Rattachement aux segments (idempotent via la clé primaire composée).
  const pairs: { segment_id: string; prospect_id: string }[] = [];
  for (const [prospect_id, targets] of links)
    for (const segment_id of targets) pairs.push({ segment_id, prospect_id });
  if (pairs.length) {
    const { error: linkErr } = await db
      .from("segment_prospects")
      .upsert(pairs, { onConflict: "segment_id,prospect_id", ignoreDuplicates: true });
    if (linkErr) return fail(linkErr.message, 500);
  }

  // 8. Journal : un import apparaît dans l'historique de CHAQUE segment
  //    alimenté, au même titre qu'une recherche Places, avec ses propres
  //    compteurs plutôt que le total du fichier.
  report.segments = [...tallies.values()].map((t) => ({
    ...t,
    label: segmentsById.get(t.id)?.label ?? "",
  }));
  const logs = report.segments
    .filter((t) => t.created + t.merged > 0)
    .map((t) => ({
      brand: brand.slug,
      segment_id: t.id,
      country: null,
      city: null,
      zone: `Import ${filename ? `« ${filename} »` : "fichier"}`,
      max_results: null,
      found_count: t.created + t.merged,
      new_count: t.created,
    }));
  if (logs.length) await db.from("searches").insert(logs);

  return ok({ report });
}
