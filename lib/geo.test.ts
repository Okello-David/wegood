import { describe, expect, it } from "vitest";
import { decideAtHome, haversineMeters } from "@/lib/geo";

const home = { lat: 0.3476, lng: 32.5825 }; // Kampala

describe("haversineMeters", () => {
  it("one degree of latitude is about 111 km", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
  });

  it("is 0 for the same point", () => {
    expect(haversineMeters(home, home)).toBe(0);
  });
});

describe("decideAtHome", () => {
  // 0.0005 degrees of latitude is about 56 m.
  const near = { lat: home.lat + 0.0005, lng: home.lng };
  const far = { lat: home.lat + 0.005, lng: home.lng }; // about 556 m

  it("inside the radius is home", () => {
    expect(decideAtHome({ ...near, accuracy: 20 }, home, 60)).toBe(true);
  });

  it("outside the radius is away", () => {
    expect(decideAtHome({ ...far, accuracy: 20 }, home, 60)).toBe(false);
  });

  it("returns null (no change) when accuracy is worse than the radius", () => {
    expect(decideAtHome({ ...far, accuracy: 200 }, home, 60)).toBeNull();
  });
});
