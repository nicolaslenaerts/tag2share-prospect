import { supabaseAdmin } from "@/lib/supabase";
import { resendClient } from "@/lib/resend";
import { recordEmailEvent } from "@/lib/email-log";
import { normEmail } from "@/lib/suppression";
import { ok, fail } from "@/lib/http";

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
 * Calcule les taux de délivrabilité par campagne sur les emails envoyés ces
 * 6 derniers jours. Rafraîchit d'abord le dernier événement de chaque email
 * éligible depuis l'API Resend, puis agrège.
 */
export async function POST() {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Emails réellement envoyés dans la fenêtre (les échecs n'ont pas de taux).
  const { data: rows, error } = await db
    .from("email_log")
    .select("id, campaign_id, campaign_name, to_email, resend_id, event, created_at")
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
            await recordEmailEvent(r.resend_id as string, mapped); // pas de rétrogradation
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
      .in("email", emailsInWindow);
    for (const s of sup ?? []) unsubscribedSet.add(normEmail(s.email));
  }

  // 3) Agrégation par campagne. L'event du journal ne stocke que le dernier
  // événement (rang le plus élevé) : delivered ⊂ opened ⊂ clicked.
  type Agg = {
    campaign_id: string | null;
    campaign_name: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    unsubscribed: number;
    _unsubEmails: Set<string>;
  };
  const byCampaign = new Map<string, Agg>();
  const keyOf = (r: { campaign_id: string | null }) => r.campaign_id ?? "__none__";

  for (const r of sent) {
    const key = keyOf(r);
    let a = byCampaign.get(key);
    if (!a) {
      a = {
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name || "(sans campagne)",
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        complained: 0,
        unsubscribed: 0,
        _unsubEmails: new Set(),
      };
      byCampaign.set(key, a);
    }
    a.sent++;

    // Event courant : valeur fraîchement sondée si dispo, sinon celle du journal.
    const ev =
      (r.resend_id && liveEvent.get(r.resend_id as string)) ||
      (r.event as string | null) ||
      null;

    if (ev === "delivered" || ev === "opened" || ev === "clicked") a.delivered++;
    if (ev === "opened" || ev === "clicked") a.opened++;
    if (ev === "clicked") a.clicked++;
    if (ev === "bounced") a.bounced++;
    if (ev === "complained") a.complained++;

    const email = normEmail(r.to_email);
    if (email && unsubscribedSet.has(email)) a._unsubEmails.add(email);
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  const campaigns = Array.from(byCampaign.values())
    .map((a) => {
      a.unsubscribed = a._unsubEmails.size;
      const { _unsubEmails, ...rest } = a;
      return {
        ...rest,
        rates: {
          delivered: pct(a.delivered, a.sent),
          opened: pct(a.opened, a.sent),
          clicked: pct(a.clicked, a.sent),
          bounced: pct(a.bounced, a.sent),
          unsubscribed: pct(a.unsubscribed, a.sent),
        },
      };
    })
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
