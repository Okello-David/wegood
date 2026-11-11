import { describe, expect, it } from "vitest";
import { computeEnergy, latestWake, type EnergyActivity, type EnergyCheckin } from "@/lib/energy";

// Local times on Monday 9 Nov 2026 (the test run pins TZ=Africa/Kampala).
// `day` 1 = Tuesday, for overnight cases.
function at(time: string, day = 0) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2026, 10, 9 + day, h, m).getTime();
}

const none: EnergyActivity[] = [];
const noCheckins: EnergyCheckin[] = [];

describe("computeEnergy", () => {
  it("returns null without a wake time (UI shows '? Tap to wake up')", () => {
    expect(computeEnergy(null, none, noCheckins, at("12:00"))).toEqual({
      percent: null,
      basis: null,
    });
  });

  it("starts at 100 right after waking", () => {
    expect(computeEnergy(at("08:00"), none, noCheckins, at("08:00")).percent).toBe(100);
  });

  it("drains 4% per awake hour", () => {
    expect(computeEnergy(at("08:00"), none, noCheckins, at("13:00")).percent).toBe(80);
  });

  it("adds class drain on top (6%/h)", () => {
    const classes = [{ type: "class" as const, start: at("09:00"), end: at("11:00") }];
    // 4 h awake (-16) + 2 h class (-12)
    expect(computeEnergy(at("08:00"), classes, noCheckins, at("12:00")).percent).toBe(72);
  });

  it("football drains 15%/h extra", () => {
    const football = [{ type: "football" as const, start: at("09:00"), end: at("10:30") }];
    // 3 h awake (-12) + 1.5 h football (-22.5) = 65.5, rounded
    expect(computeEnergy(at("08:00"), football, noCheckins, at("11:00")).percent).toBe(66);
  });

  it("a nap gives +20 per 30 min instead of draining", () => {
    const nap = [{ type: "nap" as const, start: at("18:00"), end: at("18:30") }];
    // 08-18 awake: 60, nap +20: 80, 18:30-19:00: -2
    expect(computeEnergy(at("08:00"), nap, noCheckins, at("19:00")).percent).toBe(78);
  });

  it("the latest feel check-in recalibrates, then drain continues", () => {
    const gym = [{ type: "gym" as const, start: at("09:00"), end: at("10:00") }];
    const checkins: EnergyCheckin[] = [
      { kind: "feel", feel: 4, at: at("11:00") },
      { kind: "feel", feel: 2, at: at("12:00") }, // latest wins: 35%
    ];
    // The gym before the check-in is already "inside" the 35%; 2 h later: -8
    expect(computeEnergy(at("08:00"), gym, checkins, at("14:00"))).toEqual({
      percent: 27,
      basis: "feel",
    });
  });

  it("ignores a feel check-in from before waking", () => {
    const checkins: EnergyCheckin[] = [{ kind: "feel", feel: 1, at: at("07:00") }];
    expect(computeEnergy(at("08:00"), none, checkins, at("09:00"))).toEqual({
      percent: 96,
      basis: "wake",
    });
  });

  it("works overnight: woke at 08:00, now 02:00 the next day", () => {
    // 18 h awake: 100 - 72
    expect(computeEnergy(at("08:00"), none, noCheckins, at("02:00", 1)).percent).toBe(28);
  });

  it("never goes below 0, and a nap at 0 charges from 0", () => {
    const acts: EnergyActivity[] = [
      { type: "football", start: at("07:00"), end: at("11:00") },
      { type: "nap", start: at("23:00"), end: at("23:30") },
    ];
    expect(computeEnergy(at("06:00"), acts, noCheckins, at("22:00")).percent).toBe(0);
    expect(computeEnergy(at("06:00"), acts, noCheckins, at("23:30")).percent).toBe(20);
  });

  it("overlapping activities count once, using the hardest one", () => {
    const acts: EnergyActivity[] = [
      { type: "class", start: at("09:00"), end: at("11:00") }, // manual
      { type: "class", start: at("09:00"), end: at("11:00") }, // from schedule
      { type: "gym", start: at("10:00"), end: at("11:00") },
    ];
    // base -16, 09-10 class -6, 10-11 gym -15
    expect(computeEnergy(at("08:00"), acts, noCheckins, at("12:00")).percent).toBe(63);
  });

  it("an activity nobody stopped counts for at most 4 hours", () => {
    const study = [{ type: "study" as const, start: at("09:00"), end: null }];
    // base 10 h -40, study capped at 4 h -20
    expect(computeEnergy(at("08:00"), study, noCheckins, at("18:00")).percent).toBe(40);
  });
});

describe("latestWake", () => {
  it("picks the newest wake within 24 h and ignores older or future ones", () => {
    const checkins: EnergyCheckin[] = [
      { kind: "wake", feel: null, at: at("07:00", -2) },
      { kind: "wake", feel: null, at: at("08:00") },
      { kind: "wake", feel: null, at: at("09:00", 1) }, // after `now`
      { kind: "feel", feel: 3, at: at("10:00") },
    ];
    expect(latestWake(checkins, at("02:00", 1))).toBe(at("08:00"));
    expect(latestWake(checkins, at("07:59", 1))).toBe(at("08:00")); // 23 h 59 min old
    expect(latestWake(checkins, at("08:01", 1))).toBeNull(); // just over 24 h
  });
});
