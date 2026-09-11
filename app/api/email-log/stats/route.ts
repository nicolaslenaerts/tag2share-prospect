import { supabaseAdmin } from "@/lib/supabase";
import { resendClient } from "@/lib/resend";
import { recordEmailEvent } from "@/lib/email-log";
import { normEmail, GLOBAL_SCOPE } from "@/lib/suppression";
import { ok, fail } from "@/lib/http";
import { activeBrand } from "@/lib/brand-context";

export const runtime = "nodejs";

// Fenêtre de calcul : on ne traite QUE les emails envoyés ces N derniers jours.
const WINDOW_DAYS = 6;
// Garde-fou : nombre max d'appels Resend par exécution (rate-limit + temps).
const MAX_REFRESH = 500;
const BATCH = 5; // appels Resend simultanés
const BATCH_PAUSE_MS = 600; // pause entre lots (≈ respect du rate-limit)

// last_event Resend → vocabulaire interne du journal. Les autres valeurs
// (sent, queued, scheduled, delivery_delayed, failed, canceled) sont ignorées.
const EVENT_MAP: Record<string, string> = {
  delivered: "delivered",
  opened: "opened",
  clicked: "clicked",
  bounced: "bounced",
  complained: "complained",
};

// Événements « non terminaux » qu'il reste utile de re-sonder (un email délivré
// peut encore être ouvert puis cliqué). On ne re-sonde pas clicked/bounced/complained.
const REFRESHABLE = new Set([null, "delivered", "opened"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calcule les taux de délivrabilité sur les emails envoyés ces 6 derniers
 * jours, POUR LA MARQUE ACTIVE, par campagne PUIS par variante de template
 * à l'intérieur de chaque campagne (c'est la lecture A/B : même campagne,
 * même période, textes différents). Rafraîchit d'abord le dernier événement
 * de chaque email éligible depuis l'API Resend (compte unique, partagé par
 * toutes les marques), puis agrège.
 */
export async function POST(req: Request) {
  const brand = await activeBrand(req);
  const db = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Emails réellement envoyés dans la fenêtre (les échecs n'ont pas de taux).
  const { data: rows, error } = await db
    .from("email_log")
    .select(
      "id, campaign_id, campaign_name, variant_id, variant_name, to_email, resend_id, event, created_at"
    )
    .eq("brand", brand.slug)
    .eq("status", "sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);

  const sent = rows ?? [];

  // 1) Rafraîchissement Resend : on resonde les events encore susceptibles d'évoluer.
  const toRefresh = sent
    .filter((r) => r.resend_id && REFRESHABLE.has((r.event as string | null) ?? null))
    .slice(0, MAX_REFRESH);

  let refreshed = 0;
  let refreshErrors = 0;
  const resend = resendClient();
  const liveEvent = new Map<string, string>(); // resend_id -> dernier event mappé

  for (let i = 0; i < toRefresh.length; i += BATCH) {
    const chunk = toRefresh.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(async (r) => {
        try {
          const res = await resend.emails.get(r.resend_id as string);
          const last = res.data?.last_event;
          const mapped = last ? EVENT_MAP[last] : undefined;
          if (mapped) {
            liveEvent.set(r.resend_id as string, mapped);
            // pas de rétrogradation
            await recordEmailEvent(r.resend_id as string, mapped, brand.slug);
            refreshed++;
          }
        } catch {
          refreshErrors++;
        }
      })
    );
    if (i + BATCH < toRefresh.length) await sleep(BATCH_PAUSE_MS);
  }

  // 2) Désinscriptions : emails de la fenêtre présents dans la liste de suppression.
  const emailsInWindow = Array.from(
    new Set(sent.map((r) => normEmail(r.to_email)).filter(Boolean))
  );
  const unsubscribedSet = new Set<string>();
  if (emailsInWindow.length > 0) {
    const { data: sup } = await db
      .from("suppressions")
      .select("email")
      .eq("reason", "unsubscribe")
      .in("brand", [brand.slug, GLOBAL_SCOPE])
      .in("email", emailsInWindow);
    for (const s of sup ?? []) unsubscribedSet.add(normEmail(s.email));
  }

  // 3) Agrégation à deux niveaux : campagne, puis variante de template.
  //    L'event du journal ne stocke que le dernier événement (rang le plus
  //    élevé) : delivered ⊂ opened ⊂ clicked.
  //
  //    Les compteurs sont accumulés par une seule fonction, appelée pour la
  //    campagne ET pour la variante. Dupliquer la règle d'inclusion aux deux
  //    niveaux la ferait tôt ou tard diverger, et des sous-totaux qui ne
  //    recomposent pas le total de la campagne sont pires que pas de détail.
  type Counters = {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    /** Emails désinscrits, dédoublonnés : un même contact peut avoir reçu
     *  plusieurs emails dans la fenêtre, il ne compte qu'une désinscription. */
    _unsubEmails: Set<string>;
  };

  const newCounters = (): Counters => ({
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    _unsubEmails: new Set(),
  });

  const accumulate = (c: Counters, ev: string | null, email: string) => {
    c.sent++;
    if (ev === "delivered" || ev === "opened" || ev === "clicked") c.delivered++;
    if (ev === "opened" || ev === "clicked") c.opened++;
    if (ev === "clicked") c.clicked++;
    if (ev === "bounced") c.bounced++;
    if (ev === "complained") c.complained++;
    if (email && unsubscribedSet.has(email)) c._unsubEmails.add(email);
  };

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  /** Counters → payload public : compteurs + taux en % des envoyés. */
  const shape = (c: Counters) => {
    const unsubscribed = c._unsubEmails.size;
    return {
      sent: c.sent,
      delivered: c.delivered,
      opened: c.opened,
      clicked: c.clicked,
      bounced: c.bounced,
      complained: c.complained,
      unsubscribed,
      rates: {
        delivered: pct(c.delivered, c.sent),
        opened: pct(c.opened, c.sent),
        clicked: pct(c.clicked, c.sent),
        bounced: pct(c.bounced, c.sent),
        unsubscribed: pct(unsubscribed, c.sent),
      },
    };
  };

  type VariantAgg = Counters & { variant_id: string | null; variant_name: string };
  type CampaignAgg = Counters & {
    campaign_id: string | null;
    campaign_name: string;
    variants: Map<string, VariantAgg>;
  };

  const NO_KEY = "__none__";
  const NO_VARIANT_LABEL = "(sans variante)";
  const byCampaign = new Map<string, CampaignAgg>();

  for (const r of sent) {
    const cKey = r.campaign_id ?? NO_KEY;
    let camp = byCampaign.get(cKey);
    if (!camp) {
      camp = {
        ...newCounters(),
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name || "(sans campagne)",
        variants: new Map(),
      };
      byCampaign.set(cKey, camp);
    }

    // Event courant : valeur fraîchement sondée si dispo, sinon celle du journal.
    const ev =
      (r.resend_id && liveEvent.get(r.resend_id as string)) ||
      (r.event as string | null) ||
      null;
    const email = normEmail(r.to_email);

    accumulate(camp, ev, email);

    const vKey = (r.variant_id as string | null) ?? NO_KEY;
    let variant = camp.variants.get(vKey);
    if (!variant) {
      variant = {
        ...newCounters(),
        variant_id: (r.variant_id as string | null) ?? null,
        variant_name: (r.variant_name as string | null) || NO_VARIANT_LABEL,
      };
      camp.variants.set(vKey, variant);
    }
    accumulate(variant, ev, email);
  }

  const campaigns = Array.from(byCampaign.values())
    .map((camp) => ({
      campaign_id: camp.campaign_id,
      campaign_name: camp.campaign_name,
      ...shape(camp),
      // Tri par NOM (A, B, C…) et non par volume : les variantes se lisent en
      // comparaison côte à côte, et un tri par volume les ferait sauter de
      // place d'un calcul à l'autre. « (sans variante) » ferme la liste.
      variants: Array.from(camp.variants.values())
        .sort((x, y) => {
          const xNone = x.variant_id === null;
          const yNone = y.variant_id === null;
          if (xNone !== yNone) return xNone ? 1 : -1;
          return x.variant_name.localeCompare(y.variant_name, "fr");
        })
        .map((v) => ({
          variant_id: v.variant_id,
          variant_name: v.variant_name,
          ...shape(v),
          /** Part réelle des envois de la campagne : permet de vérifier que la
           *  répartition observée colle aux poids configurés (35/35/30…). */
          share: pct(v.sent, camp.sent),
        })),
    }))
    .sort((x, y) => y.sent - x.sent);

  return ok({
    windowDays: WINDOW_DAYS,
    since,
    totalSent: sent.length,
    refreshed,
    refreshErrors,
    campaigns,
  });
}
