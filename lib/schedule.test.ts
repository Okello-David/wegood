import { describe, expect, it } from "vitest";
import {
  clockTime,
  dateKey,
  nowAndNext,
  occurrences,
  scheduleAsActivities,
  type ScheduleInput,
} from "@/lib/schedule";

// Monday 9 Nov 2026, local time (TZ pinned to Africa/Kampala for tests).
function at(time: string, day = 0) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2026, 10, 9 + day, h, m).getTime();
}
const iso = (time: number) => new Date(time).toISOString();

function item(overrides: Partial<ScheduleInput>): ScheduleInput {
  return {
    id: "x",
    user_id: "u",
    title: "Item",
    type: "class",
    starts_at: iso(at("08:00")),
    ends_at: iso(at("10:00")),
    repeat_days: [],
    skipped_dates: [],
    ...overrides,
  };
}

// Mondays and Wednesdays 08:00-10:00, starting this Monday.
const lecture = item({ id: "lec", title: "Calculus", repeat_days: [1, 3] });

describe("occurrences", () => {
  it("repeats weekly on the chosen days at the same time", () => {
    const week = occurrences([lecture], at("00:00"), at("00:00", 7));
    expect(week.map((o) => [o.dateKey, clockTime(o.start), clockTime(o.end)])).toEqual([
      ["2026-11-09", "08:00", "10:00"],
      ["2026-11-11", "08:00", "10:00"],
    ]);
  });

  it("drops skipped dates", () => {
    const skipped = { ...lecture, skipped_dates: ["2026-11-11"] };
    expect(occurrences([skipped], at("00:00"), at("00:00", 7))).toHaveLength(1);
  });

  it("doesn't repeat before the first date", () => {
    expect(occurrences([lecture], at("00:00", -7), at("00:00"))).toHaveLength(0);
  });

  it("includes a one-off only when it overlaps the range", () => {
    const once = item({ starts_at: iso(at("16:00")), ends_at: iso(at("18:00")) });
    expect(occurrences([once], at("17:00"), at("20:00"))).toHaveLength(1);
    expect(occurrences([once], at("18:00"), at("20:00"))).toHaveLength(0);
  });
});

describe("nowAndNext", () => {
  const football = item({
    id: "fb",
    title: "Football",
    type: "football",
    starts_at: iso(at("16:00")),
    ends_at: iso(at("17:30")),
  });

  it("finds what's on now and what's next today", () => {
    const { now, next } = nowAndNext([lecture, football], at("09:00"));
    expect(now?.title).toBe("Calculus");
    expect(clockTime(now!.end)).toBe("10:00");
    expect(next?.title).toBe("Football");
    expect(clockTime(next!.start)).toBe("16:00");
  });

  it("doesn't show tomorrow's item as next", () => {
    expect(nowAndNext([lecture], at("20:00", 1))).toEqual({ now: null, next: null });
  });
});

describe("scheduleAsActivities", () => {
  it("counts the part of a block that has already happened", () => {
    expect(scheduleAsActivities([lecture], at("06:00"), at("09:00"))).toEqual([
      { type: "class", start: at("08:00"), end: at("09:00") },
    ]);
  });

  it("leaves out skipped blocks", () => {
    const skipped = { ...lecture, skipped_dates: [dateKey(at("08:00"))] };
    expect(scheduleAsActivities([skipped], at("06:00"), at("12:00"))).toEqual([]);
  });
});
