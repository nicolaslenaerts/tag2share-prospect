/**
 * Dates des posts, côté navigateur. Stockage en ISO UTC (timestamptz), saisie
 * et affichage dans le fuseau du navigateur.
 *
 * Module PUR.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → valeur d'un <input type="datetime-local"> (heure locale). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valeur d'un <input type="datetime-local"> → ISO UTC (null si vide). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * Jours affichés par la grille d'un mois : semaines complètes, du lundi au
 * dimanche, débordant sur les mois voisins.
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length: total }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const timeFmt = new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit" });
const longFmt = new Intl.DateTimeFormat("fr-BE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
const shortFmt = new Intl.DateTimeFormat("fr-BE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const monthFmt = new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric" });

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatLong = (iso: string) => longFmt.format(new Date(iso));
export const formatShort = (iso: string) => shortFmt.format(new Date(iso));
export const formatMonth = (d: Date) => monthFmt.format(d);

/** Créneau proposé pour un nouveau post sur un jour donné : 10:00, ou dans une heure si c'est aujourd'hui. */
export function defaultSlot(day?: Date): Date {
  const now = new Date();
  const base = day ? new Date(day) : new Date(now);
  base.setHours(10, 0, 0, 0);
  if (base.getTime() < now.getTime() + 15 * 60_000) {
    const soon = new Date(now.getTime() + 60 * 60_000);
    soon.setMinutes(0, 0, 0);
    return soon;
  }
  return base;
}
