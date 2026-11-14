import { describe, expect, it } from "vitest";
import { VIBES, VIBE_PERIOD_MS, situationFor, vibeFor, type VibeInput } from "@/lib/vibes";

const base: VibeInput = {
  userId: "user-1",
  location: "unknown",
  hunger: 0,
  bringing: null,
  energy: null,
  now: 1_800_000_000_000,
};
const sit = (patch: Partial<VibeInput>) => situationFor({ ...base, ...patch });

describe("situationFor", () => {
  it("covers the examples from the spec", () => {
    expect(sit({ energy: 5 })).toBe("fumes");
    expect(sit({ hunger: 3, bringing: "Food" })).toBe("starving_bringing_food");
    expect(sit({ location: "home", hunger: 0, energy: 80 })).toBe("fed_rested");
    expect(sit({ location: "travelling" })).toBe("travelling");
  });

  it("checks rules in order: the first match wins", () => {
    // Fumes beats everything, even starving with food on the way.
    expect(sit({ energy: 5, hunger: 3, bringing: "Food", location: "sleeping" })).toBe("fumes");
    // Bringing something that isn't food, while starving.
    expect(sit({ hunger: 3, bringing: "Water" })).toBe("bringing");
    expect(sit({ location: "sleeping", hunger: 3 })).toBe("sleeping");
    expect(sit({ location: "campus", hunger: 3 })).toBe("starving");
    // Fed and rested only at home.
    expect(sit({ location: "campus", hunger: 0, energy: 80 })).toBe("out");
    expect(sit({ location: "home", hunger: 1, energy: 80 })).toBe("home");
    expect(sit({ location: "home", energy: 20 })).toBe("tired");
    expect(sit({ location: "work", hunger: 2 })).toBe("hungry");
  });

  it("can reach every situation", () => {
    const reached = new Set([
      sit({ energy: 5 }),
      sit({ hunger: 3, bringing: "food" }),
      sit({ bringing: "Groceries" }),
      sit({ location: "sleeping" }),
      sit({ location: "travelling" }),
      sit({ hunger: 3 }),
      sit({ location: "home", energy: 90 }),
      sit({ energy: 25 }),
      sit({ hunger: 2 }),
      sit({ location: "town" }),
      sit({ location: "home" }),
      sit({}),
    ]);
    expect([...reached].sort()).toEqual(Object.keys(VIBES).sort());
  });
});

describe("vibeFor", () => {
  it("stays the same within a 10-minute slot", () => {
    const start = Math.floor(base.now / VIBE_PERIOD_MS) * VIBE_PERIOD_MS;
    const first = vibeFor({ ...base, now: start });
    for (let t = start; t < start + VIBE_PERIOD_MS; t += 30_000) {
      expect(vibeFor({ ...base, now: t })).toBe(first);
    }
  });

  it("varies across slots and people", () => {
    const lines = new Set<string>();
    for (let i = 0; i < 40; i++) {
      lines.add(vibeFor({ ...base, now: base.now + i * VIBE_PERIOD_MS }));
      lines.add(vibeFor({ ...base, userId: `user-${i}` }));
    }
    expect(lines.size).toBeGreaterThan(1);
  });

  it("always picks a line from the matching pool", () => {
    const input = { ...base, location: "travelling" as const };
    expect(VIBES.travelling).toContain(vibeFor(input));
  });
});

describe("VIBES", () => {
  const all = Object.values(VIBES).flat();

  it("has at least 40 captions, none empty or repeated", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.every((line) => line.trim().length > 0)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("stays friendly: no money talk or insults", () => {
    // Whole words only: "Currently" contains "rent".
    const banned = /\b(money|cash|broke|rent|debt|stupid|lazy|ugly|fat|idiot)\b/i;
    expect(all.filter((line) => banned.test(line))).toEqual([]);
  });
});
