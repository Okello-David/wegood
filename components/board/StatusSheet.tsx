"use client";

import { useEffect, useState, type ReactNode } from "react";
import { markManualOverride } from "@/lib/geo";
import { BRINGING_CHIPS, ETA_CHIPS, HUNGER, LOCATIONS, locationPatch } from "@/lib/status";
import { etaFromChip } from "@/lib/time";
import type { StatusPatch, StatusRow } from "@/types/database";

type Props = {
  status: StatusRow;
  onSave: (patch: StatusPatch, message: string) => void;
  onClose: () => void;
};

function Choice({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-14 rounded-xl px-2 font-semibold ${
        selected ? "bg-primary text-on-primary" : "bg-chip"
      }`}
    >
      {children}
    </button>
  );
}

export default function StatusSheet({ status, onSave, onClose }: Props) {
  const isCustomBringing = status.bringing !== null && !BRINGING_CHIPS.includes(status.bringing);
  const [customText, setCustomText] = useState(isCustomBringing ? status.bringing! : "");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function setBringing(value: string | null) {
    setCustomText("");
    onSave({ bringing: value }, value ? `Bringing ${value} 🛍️` : "Nothing, noted");
  }

  function commitCustomText() {
    const value = customText.trim();
    if (value && value !== status.bringing) {
      onSave({ bringing: value }, `Bringing ${value} 🛍️`);
    }
  }

  const headingClass = "mb-2 font-semibold";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Update my status"
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">What&apos;s the situation?</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-full bg-chip text-lg"
          >
            ✕
          </button>
        </div>

        <section className="mb-5">
          <h3 className={headingClass}>Where are you?</h3>
          <div className="grid grid-cols-3 gap-2">
            {LOCATIONS.map((location) => (
              <Choice
                key={location.value}
                selected={status.location_preset === location.value}
                onClick={() => {
                  // A choice made by hand beats the geofence until the next app open.
                  markManualOverride();
                  onSave(locationPatch(location.value), `${location.emoji} ${location.label}`);
                }}
              >
                <span aria-hidden="true">{location.emoji}</span> {location.label}
              </Choice>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <h3 className={headingClass}>Hunger</h3>
          <div className="grid grid-cols-2 gap-2">
            {HUNGER.map((level) => (
              <Choice
                key={level.value}
                selected={status.hunger === level.value}
                onClick={() => onSave({ hunger: level.value }, `${level.emoji} ${level.label}`)}
              >
                <span aria-hidden="true">{level.emoji}</span> {level.label}
              </Choice>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <h3 className={headingClass}>Bringing home</h3>
          <div className="grid grid-cols-3 gap-2">
            {BRINGING_CHIPS.map((chip) => (
              <Choice key={chip} selected={status.bringing === chip} onClick={() => setBringing(chip)}>
                {chip}
              </Choice>
            ))}
            <Choice selected={status.bringing === null} onClick={() => setBringing(null)}>
              Nothing
            </Choice>
          </div>
          <input
            aria-label="Bringing something else"
            placeholder="Something else…"
            maxLength={80}
            enterKeyHint="done"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            onBlur={commitCustomText}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="mt-2 min-h-12 w-full rounded-xl border border-line px-4 text-base"
          />
        </section>

        <section>
          <h3 className={headingClass}>Back in</h3>
          <div className="grid grid-cols-3 gap-2">
            {ETA_CHIPS.map((chip) => (
              <Choice
                key={chip.label}
                onClick={() =>
                  onSave({ eta: etaFromChip(chip.minutes) }, `ETA set: ${chip.label}`)
                }
              >
                {chip.label}
              </Choice>
            ))}
            <Choice onClick={() => onSave({ eta: null }, "ETA cleared")}>Clear</Choice>
          </div>
        </section>
      </div>
    </div>
  );
}
