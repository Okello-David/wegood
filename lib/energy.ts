import type { ActivityType } from "@/types/database";

// The energy battery is a rough, fun ESTIMATE, not a measurement. Everything
// here is a pure function (no database, no clock of its own): the caller
// passes `now`, which makes it easy to unit test.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const ACTIVITIES: {
  type: ActivityType;
  label: string;
  emoji: string;
  // Extra % lost per hour on top of the normal awake drain.
  drain: number;
  // Timeline block colour (Tailwind classes, written out in full so Tailwind
  // finds them when it scans the code).
  color: string;
}[] = [
  { type: "class", label: "Class", emoji: "🎓", drain: 6, color: "bg-sky-200 border-sky-400" },
  { type: "study", label: "Study", emoji: "📚", drain: 5, color: "bg-indigo-200 border-indigo-400" },
  { type: "gym", label: "Gym", emoji: "🏋️", drain: 15, color: "bg-rose-200 border-rose-400" },
  { type: "football", label: "Football", emoji: "⚽", drain: 15, color: "bg-green-200 border-green-400" },
  { type: "town", label: "Town", emoji: "🏙️", drain: 8, color: "bg-orange-200 border-orange-400" },
  { type: "work", label: "Work", emoji: "💼", drain: 7, color: "bg-stone-300 border-stone-500" },
  { type: "chill", label: "Chill", emoji: "🛋️", drain: 0, color: "bg-teal-100 border-teal-300" },
  { type: "nap", label: "Nap", emoji: "😴", drain: 0, color: "bg-purple-200 border-purple-400" },
];

export function activityInfo(type: ActivityType) {
  return ACTIVITIES.find((a) => a.type === type) ?? ACTIVITIES[0];
}

export const AWAKE_DRAIN_PER_HOUR = 4;
// "+20 per 30 min" of nap. A nap replaces the awake drain instead of adding to it.
export const NAP_GAIN_PER_HOUR = 40;
// A "feel" check-in sets the battery to this, then normal drain continues.
export const FEEL_LEVEL: Record<number, number> = { 1: 15, 2: 35, 3: 55, 4: 75, 5: 95 };
export const FEELS = [
  { value: 1, emoji: "💀", label: "Dead" },
  { value: 2, emoji: "😩", label: "Tired" },
  { value: 3, emoji: "😐", label: "Okay" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "⚡", label: "Charged" },
];
// Someone who forgot to tap Stop shouldn't drain to 0 overnight.
export const OPEN_ACTIVITY_MAX_MS = 4 * HOUR;
// "Woke up today" = a wake check-in in the last 24 hours. A fixed window (not
// "since midnight") so staying up past 00:00 doesn't wipe the battery.
export const WAKE_WINDOW_MS = 24 * HOUR;

// Times are epoch milliseconds (Date.now()).
export type EnergyActivity = { type: ActivityType; start: number; end: number | null };
export type EnergyCheckin = { kind: "wake" | "feel"; feel: number | null; at: number };
export type Energy =
  | { percent: null; basis: null }
  | { percent: number; basis: "wake" | "feel" };

const clamp = (value: number) => Math.min(100, Math.max(0, value));

// Latest wake check-in within the window, or null ("? Tap to wake up").
export function latestWake(checkins: EnergyCheckin[], now: number): number | null {
  let wake: number | null = null;
  for (const c of checkins) {
    if (c.kind === "wake" && c.at <= now && now - c.at <= WAKE_WINDOW_MS) {
      if (wake === null || c.at > wake) wake = c.at;
    }
  }
  return wake;
}

export function computeEnergy(
  wakeTime: number | null,
  activities: EnergyActivity[],
  checkins: EnergyCheckin[],
  now: number,
): Energy {
  if (wakeTime === null || wakeTime > now) return { percent: null, basis: null };

  // 1. Starting point: waking up = 100%, unless a later "how do you feel?"
  //    check-in recalibrates it. Only the latest one counts.
  let from = wakeTime;
  let level = 100;
  let basis: "wake" | "feel" = "wake";
  for (const c of checkins) {
    if (c.kind === "feel" && c.feel !== null && c.at >= from && c.at <= now) {
      from = c.at;
      level = FEEL_LEVEL[c.feel] ?? level;
      basis = "feel";
    }
  }

  // 2. Cut every activity to the part between `from` and `now`.
  const spans = activities
    .map((a) => {
      const end = a.end ?? Math.min(now, a.start + OPEN_ACTIVITY_MAX_MS);
      return { type: a.type, start: Math.max(a.start, from), end: Math.min(end, now) };
    })
    .filter((a) => a.end > a.start);

  // 3. Split the time at every activity start/end, so inside one piece the
  //    set of running activities doesn't change, then add up piece by piece.
  const cuts = new Set([from, now]);
  for (const a of spans) {
    cuts.add(a.start);
    cuts.add(a.end);
  }
  const times = [...cuts].sort((a, b) => a - b);

  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    const running = spans.filter((a) => a.start <= t0 && a.end >= t1);
    let ratePerHour: number;
    if (running.some((a) => a.type === "nap")) {
      ratePerHour = NAP_GAIN_PER_HOUR;
    } else {
      // Overlaps (a scheduled class AND a manual "class") count once: the
      // hardest activity at that moment sets the extra drain.
      const extra = Math.max(0, ...running.map((a) => activityInfo(a.type).drain));
      ratePerHour = -(AWAKE_DRAIN_PER_HOUR + extra);
    }
    // Clamped after every piece: a nap at 0% starts charging from 0, not -30.
    level = clamp(level + (ratePerHour * (t1 - t0)) / HOUR);
  }

  return { percent: Math.round(level), basis };
}

export function batteryColor(percent: number) {
  if (percent > 60) return { fill: "bg-green-500", text: "text-green-800 dark:text-green-300" };
  if (percent >= 30) return { fill: "bg-amber-400", text: "text-amber-800 dark:text-amber-300" };
  return { fill: "bg-red-500", text: "text-red-800 dark:text-red-300" };
}
