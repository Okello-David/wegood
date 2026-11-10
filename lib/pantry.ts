import type { PantryItemRow, PantryState } from "@/types/database";

export const NEXT_STATE: Record<PantryState, PantryState> = {
  have: "low",
  low: "out",
  out: "have",
};

// Colour plus a word and an icon, so it still reads for colour-blind roommates.
export const STATE_STYLE: Record<PantryState, { label: string; icon: string; tile: string }> = {
  have: { label: "Have", icon: "✅", tile: "bg-green-100 border-green-500 text-green-900" },
  low: { label: "Low", icon: "⚠️", tile: "bg-amber-100 border-amber-500 text-amber-900" },
  out: { label: "Out", icon: "❌", tile: "bg-red-100 border-red-500 text-red-900" },
};

export const STATE_TOAST: Record<PantryState, (name: string) => string> = {
  have: (name) => `${name} restocked ✅`,
  low: (name) => `${name} running low ⚠️`,
  out: (name) => `${name} is out, added to shopping list 🛒`,
};

export function shoppingList(items: PantryItemRow[]) {
  const byName = (a: PantryItemRow, b: PantryItemRow) => a.name.localeCompare(b.name);
  return {
    out: items.filter((item) => item.state === "out").sort(byName),
    low: items.filter((item) => item.state === "low").sort(byName),
  };
}

// WhatsApp shows *text* in bold.
export function whatsAppText(items: PantryItemRow[]) {
  const { out, low } = shoppingList(items);
  const lines = ["🛒 *WeGood? shopping list*"];
  if (out.length) lines.push("", "*Out:*", ...out.map((item) => `• ${item.name}`));
  if (low.length) lines.push("", "*Running low:*", ...low.map((item) => `• ${item.name}`));
  return lines.join("\n");
}
