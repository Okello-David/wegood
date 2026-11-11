import type { EnergyActivity } from "@/lib/energy";
import type { ActivityType, ScheduleItemRow } from "@/types/database";

// Schedules live in the phone's LOCAL time: "Class every Monday at 08:00"
// means 08:00 wherever the phone is, so all date maths here uses local Date
// methods (getDay, setHours...). Only call these in the browser, never during
// a server render (the server's time zone is not the user's).

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

export type ScheduleInput = Pick<
  ScheduleItemRow,
  "id" | "user_id" | "title" | "type" | "starts_at" | "ends_at" | "repeat_days" | "skipped_dates"
>;

export type Occurrence = {
  item: ScheduleInput;
  type: ActivityType;
  title: string;
  start: number;
  end: number;
  dateKey: string;
};

// "YYYY-MM-DD" on the phone's calendar (the format Postgres `date` uses).
export function dateKey(time: number | Date) {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(time: number) {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Adding 24 h can land on 23:00 or 01:00 across a daylight-saving change, so
// days are stepped with setDate instead.
export function addDays(time: number, days: number) {
  const d = new Date(time);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// 24-hour clock, e.g. "16:00".
export function clockTime(time: number) {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Every occurrence that overlaps [from, to), sorted by start.
export function occurrences(items: ScheduleInput[], from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of items) {
    const first = Date.parse(item.starts_at);
    const duration = Date.parse(item.ends_at) - first;
    const push = (start: number) => {
      const key = dateKey(start);
      if (item.skipped_dates.includes(key)) return;
      const end = start + duration;
      if (end > from && start < to) {
        out.push({ item, type: item.type, title: item.title, start, end, dateKey: key });
      }
    };

    if (item.repeat_days.length === 0) {
      push(first);
      continue;
    }

    // Weekly: same time of day as the first one, on each chosen weekday, from
    // the first date onwards. Start a day early so an occurrence that began
    // yesterday and is still running is found.
    const firstDay = startOfDay(first);
    const t = new Date(first);
    for (let day = startOfDay(from - DAY_MS); day < to; day = addDays(day, 1)) {
      if (day < firstDay) continue;
      const d = new Date(day);
      if (!item.repeat_days.includes(d.getDay())) continue;
      d.setHours(t.getHours(), t.getMinutes(), 0, 0);
      push(d.getTime());
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// For a Board card: what's on now, and what's next later today.
export function nowAndNext(items: ScheduleInput[], now: number) {
  const list = occurrences(items, now - DAY_MS, addDays(startOfDay(now), 1));
  const current = list.filter((o) => o.start <= now && o.end > now).at(-1) ?? null;
  const next = list.find((o) => o.start > now) ?? null;
  return { now: current, next };
}

// Scheduled blocks that have (partly) happened count for the energy battery
// automatically. Skipped ones are already gone (skipped_dates).
export function scheduleAsActivities(
  items: ScheduleInput[],
  from: number,
  now: number,
): EnergyActivity[] {
  return occurrences(items, from, now)
    .filter((o) => o.start <= now)
    .map((o) => ({ type: o.type, start: o.start, end: Math.min(o.end, now) }));
}
