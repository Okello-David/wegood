import {
  OPEN_ACTIVITY_MAX_MS,
  computeEnergy,
  latestWake,
  type EnergyCheckin,
} from "@/lib/energy";
import { scheduleAsActivities } from "@/lib/schedule";
import type { ActivityRow, EnergyCheckinRow, ScheduleItemRow } from "@/types/database";

// Glue between database rows and the pure energy maths in lib/energy.ts.
// Uses the phone's time zone (weekly schedules), so call it in the browser.

export function energyForUser(
  userId: string,
  activities: ActivityRow[],
  checkins: EnergyCheckinRow[],
  schedule: ScheduleItemRow[],
  now: number,
) {
  const mine: EnergyCheckin[] = checkins
    .filter((c) => c.user_id === userId)
    .map((c) => ({ kind: c.kind, feel: c.feel, at: Date.parse(c.created_at) }));
  const wake = latestWake(mine, now);
  if (wake === null) return computeEnergy(null, [], mine, now);

  const logged = activities
    .filter((a) => a.user_id === userId)
    .map((a) => ({
      type: a.type,
      start: Date.parse(a.started_at),
      end: a.ended_at ? Date.parse(a.ended_at) : null,
    }));
  // Planned blocks count automatically once their time comes, unless skipped.
  const planned = scheduleAsActivities(
    schedule.filter((s) => s.user_id === userId),
    wake,
    now,
  );
  return computeEnergy(wake, [...logged, ...planned], mine, now);
}

// The activity someone started and hasn't stopped (and isn't forgotten).
export function runningActivity(userId: string, activities: ActivityRow[], now: number) {
  return (
    activities
      .filter(
        (a) =>
          a.user_id === userId &&
          a.ended_at === null &&
          now - Date.parse(a.started_at) < OPEN_ACTIVITY_MAX_MS,
      )
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null
  );
}

export function hasWokenUp(userId: string, checkins: EnergyCheckinRow[], now: number) {
  const mine = checkins
    .filter((c) => c.user_id === userId)
    .map((c) => ({ kind: c.kind, feel: c.feel, at: Date.parse(c.created_at) }));
  return latestWake(mine, now) !== null;
}
