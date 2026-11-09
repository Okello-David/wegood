import type { LocationPreset, StatusPatch } from "@/types/database";

export const LOCATIONS: { value: LocationPreset; label: string; emoji: string }[] = [
  { value: "home", label: "Home", emoji: "🏠" },
  { value: "campus", label: "Campus", emoji: "🎓" },
  { value: "town", label: "Town", emoji: "🏙️" },
  { value: "work", label: "Work", emoji: "💼" },
  { value: "travelling", label: "Travelling", emoji: "🚌" },
  { value: "sleeping", label: "Sleeping", emoji: "😴" },
  { value: "unknown", label: "Unknown", emoji: "❓" },
];

export const HUNGER = [
  { value: 0, label: "Fine", emoji: "😌" },
  { value: 1, label: "Could eat", emoji: "🙂" },
  { value: 2, label: "Hungry", emoji: "😋" },
  { value: 3, label: "Starving", emoji: "🤤" },
];

export const BRINGING_CHIPS = ["Food", "Groceries", "Water", "Airtime"];

export const ETA_CHIPS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "Tonight", minutes: null },
];

export function locationInfo(value: LocationPreset) {
  return LOCATIONS.find((l) => l.value === value) ?? LOCATIONS[LOCATIONS.length - 1];
}

export function hungerInfo(value: number) {
  return HUNGER[value] ?? HUNGER[0];
}

// Sleeping says nothing about where someone is, so at_home is left alone.
export function locationPatch(value: LocationPreset): StatusPatch {
  if (value === "sleeping") return { location_preset: value };
  if (value === "unknown") {
    return { location_preset: value, at_home: null, at_home_source: null };
  }
  return { location_preset: value, at_home: value === "home", at_home_source: "manual" };
}
