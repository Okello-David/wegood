"use client";

import { activityInfo } from "@/lib/energy";
import { clockTime, occurrences } from "@/lib/schedule";
import type { ProfileRow, ScheduleItemRow } from "@/types/database";

const MINUTE = 60_000;
const HOURS = 6;
const HOUR_PX = 44;
const PX_PER_MIN = HOUR_PX / 60;

type Props = {
  people: ProfileRow[]; // me first
  myId: string;
  schedule: ScheduleItemRow[];
  now: number;
};

// Everyone's next 6 hours side by side: coloured = busy, blank = free.
// Columns scroll sideways inside the box when the room is big (up to ~15).
export default function WhosFree({ people, myId, schedule, now }: Props) {
  const until = now + HOURS * 60 * MINUTE;
  // Hour lines on the clock's whole hours: 14:00, 15:00...
  const firstHour = new Date(now);
  firstHour.setMinutes(0, 0, 0);
  const lines = Array.from({ length: HOURS + 1 }, (_, i) => firstHour.getTime() + (i + 1) * 60 * MINUTE)
    .filter((t) => t < until);
  const y = (time: number) => ((Math.min(Math.max(time, now), until) - now) / MINUTE) * PX_PER_MIN;
  const height = HOURS * HOUR_PX;

  return (
    <div className="flex rounded-2xl bg-white p-2">
      <div className="relative w-11 shrink-0 pt-14" aria-hidden="true">
        <div className="relative" style={{ height }}>
          <span className="absolute -top-2 text-xs font-semibold text-red-600">now</span>
          {lines.map((t) => (
            <span key={t} style={{ top: y(t) - 8 }} className="absolute text-xs text-stone-500">
              {clockTime(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
        {people.map((person) => {
          const blocks = occurrences(
            schedule.filter((item) => item.user_id === person.id),
            now,
            until,
          );
          const busyNow = blocks.find((b) => b.start <= now && b.end > now);
          const nextBusy = blocks.find((b) => b.start > now);
          const summary = busyNow
            ? `busy until ${clockTime(busyNow.end)}`
            : nextBusy
              ? `free until ${clockTime(nextBusy.start)}`
              : "free";

          return (
            <section
              key={person.id}
              aria-label={`${person.display_name}: ${summary}`}
              className="flex min-w-20 flex-1 flex-col"
            >
              <header className="flex h-14 flex-col items-center justify-center text-center">
                <span aria-hidden="true" className="text-2xl leading-none">
                  {person.avatar_emoji}
                </span>
                <span className="w-full truncate text-xs font-semibold">
                  {person.id === myId ? "You" : person.display_name}
                </span>
              </header>
              <div className="relative rounded-lg bg-emerald-50" style={{ height }}>
                {lines.map((t) => (
                  <div
                    key={t}
                    style={{ top: y(t) }}
                    className="absolute inset-x-0 border-t border-stone-200"
                  />
                ))}
                {blocks.map((block) => {
                  const info = activityInfo(block.type);
                  const top = y(block.start);
                  const h = Math.max(y(block.end) - top, 14);
                  return (
                    <div
                      key={`${block.item.id}-${block.dateKey}`}
                      style={{ top, height: h }}
                      title={`${block.title} ${clockTime(block.start)}–${clockTime(block.end)}`}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 px-1 text-[11px] leading-tight ${info.color}`}
                    >
                      <span aria-hidden="true">{info.emoji}</span>{" "}
                      {h >= 28 && <span className="font-semibold">{block.title}</span>}
                    </div>
                  );
                })}
                {!busyNow && (
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">
                    FREE
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
