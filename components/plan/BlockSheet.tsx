"use client";

import { useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { ACTIVITIES, activityInfo } from "@/lib/energy";
import { clockTime } from "@/lib/schedule";
import type { ActivityType } from "@/types/database";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type BlockValues = { title: string; type: ActivityType; repeatDays: number[] };

type Props = {
  mode: "new" | "edit";
  start: number;
  end: number;
  // Weekday of the day being viewed: the default for "Repeat weekly".
  weekday: number;
  initial?: BlockValues;
  busy: boolean;
  onSave: (values: BlockValues) => void;
  onSkipDay?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

// New block: optionally type a title / switch on repeat, then ONE tap on a
// type icon saves it. Edit: change things, then Save.
export default function BlockSheet({
  mode,
  start,
  end,
  weekday,
  initial,
  busy,
  onSave,
  onSkipDay,
  onDelete,
  onClose,
}: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<ActivityType | null>(initial?.type ?? null);
  const [repeatDays, setRepeatDays] = useState<number[]>(initial?.repeatDays ?? []);
  const repeating = repeatDays.length > 0;

  function save(nextType: ActivityType) {
    // Empty title: use the type's name, e.g. "Football".
    onSave({ title: title.trim() || activityInfo(nextType).label, type: nextType, repeatDays });
  }

  function toggleDay(day: number) {
    setRepeatDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  return (
    <Sheet
      title={`${mode === "new" ? "New block" : "Edit block"} · ${clockTime(start)}–${clockTime(end)}`}
      onClose={onClose}
    >
      <input
        aria-label="Title"
        placeholder="Title (optional), e.g. Calculus"
        maxLength={40}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mb-3 min-h-12 w-full rounded-xl border border-line px-4 text-base"
      />

      <button
        type="button"
        role="switch"
        aria-checked={repeating}
        onClick={() => setRepeatDays(repeating ? [] : [weekday])}
        className={`mb-2 flex min-h-12 w-full items-center justify-between rounded-xl px-4 font-semibold ${
          repeating ? "bg-primary text-on-primary" : "bg-chip"
        }`}
      >
        <span>🔁 Repeat weekly</span>
        <span aria-hidden="true">{repeating ? "ON" : "OFF"}</span>
      </button>
      {repeating && (
        <div className="mb-3 grid grid-cols-7 gap-1" role="group" aria-label="Repeat on">
          {DAYS.map((label, day) => (
            <button
              key={label}
              type="button"
              aria-pressed={repeatDays.includes(day)}
              onClick={() => toggleDay(day)}
              className={`min-h-11 rounded-lg text-xs font-semibold ${
                repeatDays.includes(day) ? "bg-primary text-on-primary" : "bg-chip"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 mb-2 font-semibold">{mode === "new" ? "Tap a type to add it" : "Type"}</p>
      <div className="grid grid-cols-4 gap-2">
        {ACTIVITIES.map((activity) => (
          <button
            key={activity.type}
            type="button"
            disabled={busy}
            aria-pressed={type === activity.type}
            onClick={() => (mode === "new" ? save(activity.type) : setType(activity.type))}
            className={`flex min-h-20 flex-col items-center justify-center rounded-xl border-2 text-sm font-semibold disabled:opacity-60 ${
              type === activity.type ? "border-ink" : "border-transparent"
            } ${activity.color.split(" ")[0]}`}
          >
            <span aria-hidden="true" className="text-3xl">
              {activity.emoji}
            </span>
            {activity.label}
          </button>
        ))}
      </div>

      {mode === "edit" && (
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || !type}
            onClick={() => type && save(type)}
            className="min-h-12 rounded-xl bg-primary font-semibold text-on-primary disabled:opacity-60"
          >
            Save
          </button>
          {onSkipDay && (
            <button
              type="button"
              disabled={busy}
              onClick={onSkipDay}
              className="min-h-12 rounded-xl bg-amber-100 font-semibold text-amber-900 disabled:opacity-60"
            >
              ⏭️ Skip it this day only
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="min-h-12 rounded-xl bg-red-50 font-semibold text-red-700 disabled:opacity-60"
            >
              🗑️ Delete{repeating ? " every week" : ""}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
