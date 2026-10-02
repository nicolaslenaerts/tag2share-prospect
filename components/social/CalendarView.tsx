"use client";
/**
 * Vue calendrier mensuelle (lundi → dimanche). Un clic sur un jour crée un
 * post à cette date, un clic sur un post l'ouvre.
 */
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { addMonths, dayKey, formatMonth, formatTime, monthGrid, sameDay } from "@/lib/social/dates";
import { postLabel } from "@/lib/social/rules";
import type { SocialPost } from "@/lib/social/types";
import { ServiceBadge } from "./SocialPreview";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAX_PER_DAY = 4;

export const CHIP_STYLE: Record<SocialPost["status"], string> = {
  draft: "border-dashed border-gray-300 bg-white text-gray-600",
  scheduled: "border-brand/30 bg-brand-50 text-gray-900",
  published: "border-green-200 bg-green-50 text-green-900",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  failed: "border-red-200 bg-red-50 text-red-900",
};

function thumbnailOf(post: SocialPost): string | null {
  const first = post.media.find((m) => m.kind === "image") ?? post.media[0];
  if (!first) return null;
  return first.kind === "image" ? first.url : first.thumbnail_url;
}

export function CalendarView({
  month,
  posts,
  onMonthChange,
  onOpen,
  onNew,
}: {
  month: Date;
  posts: SocialPost[];
  onMonthChange: (d: Date) => void;
  onOpen: (post: SocialPost) => void;
  onNew: (day: Date) => void;
}) {
  const days = monthGrid(month);
  const today = new Date();
  const byDay = new Map<string, SocialPost[]>();
  for (const p of posts) {
    if (!p.scheduled_at) continue;
    const key = dayKey(new Date(p.scheduled_at));
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-bold capitalize text-gray-900">{formatMonth(month)}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Mois précédent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Aujourd&apos;hui
          </Button>
          <Button variant="ghost" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Mois suivant">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-200 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = sameDay(day, today);
          const past = day < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const list = byDay.get(dayKey(day)) ?? [];
          return (
            <div
              key={dayKey(day)}
              className={cn(
                "group relative min-h-[118px] border-gray-100 p-1.5",
                i % 7 !== 6 && "border-r",
                i < days.length - 7 && "border-b",
                !inMonth && "bg-gray-50/70"
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                    isToday ? "bg-brand text-brand-fg" : inMonth ? "text-gray-700" : "text-gray-300"
                  )}
                >
                  {day.getDate()}
                </span>
                {!past && (
                  <button
                    type="button"
                    onClick={() => onNew(day)}
                    className="rounded p-0.5 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-brand group-hover:opacity-100"
                    aria-label="Nouveau post ce jour"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {list.slice(0, MAX_PER_DAY).map((p) => {
                  const thumb = thumbnailOf(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onOpen(p)}
                      className={cn(
                        "flex w-full items-start gap-1 rounded-md border p-1 text-left text-[11px] leading-tight transition hover:shadow",
                        CHIP_STYLE[p.status]
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumb && <img src={thumb} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="font-semibold">{formatTime(p.scheduled_at!)}</span>
                          <span className="ml-auto flex shrink-0 -space-x-1">
                            {[...new Set(p.targets.map((t) => t.service))].map((s) => (
                              <ServiceBadge key={s} service={s} className="h-3.5 min-w-3.5 text-[7px] ring-1 ring-white" />
                            ))}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate">{postLabel(p)}</span>
                      </span>
                    </button>
                  );
                })}
                {list.length > MAX_PER_DAY && (
                  <p className="px-1 text-[11px] font-medium text-gray-500">+{list.length - MAX_PER_DAY} autre(s)</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
