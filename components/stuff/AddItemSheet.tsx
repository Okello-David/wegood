"use client";

import { useState, type FormEvent } from "react";
import Sheet from "@/components/ui/Sheet";
import type { PantryKind } from "@/types/database";

type Props = {
  onAdd: (name: string, kind: PantryKind) => Promise<boolean>;
  onClose: () => void;
};

const KINDS: { value: PantryKind; label: string }[] = [
  { value: "grocery", label: "🧂 Grocery" },
  { value: "ready_food", label: "🍲 Ready food" },
];

export default function AddItemSheet({ onAdd, onClose }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PantryKind>("grocery");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    const ok = await onAdd(trimmed, kind);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Sheet title="Add an item" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
              className={`min-h-14 rounded-xl font-semibold ${
                kind === option.value ? "bg-stone-900 text-white" : "bg-stone-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          autoFocus
          required
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === "grocery" ? "e.g. Tomatoes" : "e.g. Leftover pilau"}
          aria-label="Item name"
          // text-base (16px) stops iPhone zooming into the field.
          className="min-h-12 rounded-xl border border-stone-300 bg-white px-4 text-base"
        />
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="min-h-14 rounded-xl bg-stone-900 font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Sheet>
  );
}
