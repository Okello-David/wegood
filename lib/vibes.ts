import type { LocationPreset } from "@/types/database";

// Phase 5: a playful one-line caption for each Board card.
//
// How it works:
// 1. `situationFor` picks ONE situation from the status. The rules are checked
//    in order and the first match wins, so the most interesting thing about a
//    person is what gets a joke ("running on fumes" beats "on campus").
// 2. `vibeFor` picks a line from that situation's pool. The pick comes from a
//    hash of (user id + situation + which 10-minute slot we're in), not from
//    Math.random(). The same inputs always give the same line, so the card
//    doesn't flicker every time the Board re-renders, yet the line changes
//    every 10 minutes, and two people in the same situation usually get
//    different lines.
//
// House rules for writing lines: friendly, no insults, nothing about money or
// private matters, and no names or pronouns (the app doesn't know anyone's).

export type Situation =
  | "fumes"
  | "starving_bringing_food"
  | "bringing"
  | "sleeping"
  | "travelling"
  | "starving"
  | "fed_rested"
  | "tired"
  | "hungry"
  | "out" // campus, work, town
  | "home"
  | "unknown";

export const VIBES: Record<Situation, string[]> = {
  fumes: [
    "Running on fumes. Approach with food.",
    "Battery critical. Please plug in a nap.",
    "Currently held together by willpower.",
    "Low power mode: activated.",
  ],
  starving_bringing_food: [
    "Starving but heroic. Food incoming 🍚",
    "Hungry hands, full bag. Respect.",
    "Bringing food and trying not to eat it on the way.",
    "The hero this room needs 🍲",
  ],
  bringing: [
    "Arriving with supplies 🛍️",
    "Delivery service, five stars so far.",
    "Hands full, heart fuller.",
    "Loot incoming. Clear the table.",
  ],
  sleeping: [
    "Do not disturb: dreaming in HD 😴",
    "Recharging. Please hold.",
    "Gone to the land of nod.",
    "Snoozing like a professional.",
  ],
  travelling: [
    "Somewhere between here and there 🛵",
    "In transit. Thoughts loading…",
    "On the move. ETA: vibes.",
    "Boda-riding through life.",
  ],
  starving: [
    "Could eat a whole pot of posho right now.",
    "Stomach is filing a formal complaint.",
    "Hunger level: legendary.",
    "Will trade friendship for snacks.",
  ],
  fed_rested: [
    "Fed, rested, dangerous.",
    "Fully charged and ready to do the dishes. Maybe.",
    "Peak performance unlocked ✨",
    "In their prime era.",
  ],
  tired: [
    "Running low. Be gentle.",
    "Yawning in 4K.",
    "Brain at 20%, vibes at 100%.",
    "One more thing and then a nap.",
  ],
  hungry: [
    "Thinking about food. Constantly.",
    "Peckish and plotting.",
    "Snack radar: on.",
    "Accepting chapati donations.",
  ],
  out: [
    "Absorbing knowledge, one lecture at a time 🎓",
    "Out here being productive.",
    "Busy being a legend somewhere else.",
    "Out in the wild. Back eventually.",
  ],
  home: [
    "Holding down the fort 🏠",
    "Home sweet home.",
    "Couch status: occupied.",
    "Guarding the fridge.",
  ],
  unknown: [
    "Location: a mystery. Vibe: also a mystery.",
    "Off the grid 🕵️",
    "Whereabouts unknown, probably fine.",
    "Somewhere out there, being awesome.",
  ],
};

export type VibeInput = {
  userId: string;
  location: LocationPreset;
  hunger: number;
  bringing: string | null;
  // null = not known (hasn't woken up / no check-in yet).
  energy: number | null;
  now: number;
};

export const VIBE_PERIOD_MS = 10 * 60_000;

export function situationFor({ location, hunger, bringing, energy }: VibeInput): Situation {
  const bringingFood = bringing !== null && /food/i.test(bringing);
  if (energy !== null && energy < 10) return "fumes";
  if (hunger === 3 && bringingFood) return "starving_bringing_food";
  if (bringing) return "bringing";
  if (location === "sleeping") return "sleeping";
  if (location === "travelling") return "travelling";
  if (hunger === 3) return "starving";
  if (location === "home" && hunger === 0 && energy !== null && energy > 70) return "fed_rested";
  if (energy !== null && energy < 30) return "tired";
  if (hunger === 2) return "hungry";
  if (location === "campus" || location === "work" || location === "town") return "out";
  if (location === "home") return "home";
  return "unknown";
}

// FNV-1a: a tiny, well-known string hash. Good enough to spread picks evenly;
// it's not for security.
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function vibeFor(input: VibeInput): string {
  const situation = situationFor(input);
  const pool = VIBES[situation];
  const slot = Math.floor(input.now / VIBE_PERIOD_MS);
  return pool[hash(`${input.userId}|${situation}|${slot}`) % pool.length];
}
