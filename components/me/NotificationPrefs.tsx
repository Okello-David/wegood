"use client";

import { useState } from "react";
import Toast from "@/components/ui/Toast";
import { useToast } from "@/components/ui/useToast";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPrefsPatch, NotificationPrefsRow } from "@/types/database";

type Settings = Pick<
  NotificationPrefsRow,
  | "requests"
  | "visitor_notes"
  | "food"
  | "bringing"
  | "pings"
  | "fun"
  | "quiet_enabled"
  | "quiet_start"
  | "quiet_end"
>;

// Must match the column defaults in the migration: no row means these.
const DEFAULTS: Settings = {
  requests: true,
  visitor_notes: true,
  food: true,
  bringing: true,
  pings: true,
  fun: true,
  quiet_enabled: true,
  quiet_start: "23:00",
  quiet_end: "06:00",
};

type ToggleKey = "requests" | "visitor_notes" | "food" | "bringing" | "pings" | "fun";

const TYPES: { key: ToggleKey; icon: string; label: string }[] = [
  { key: "requests", icon: "🙋", label: "Requests (clothes, errands)" },
  { key: "visitor_notes", icon: "📬", label: "Visitor notes for me" },
  { key: "food", icon: "🍽️", label: "Food is finished" },
  { key: "bringing", icon: "🛍️", label: "Someone is bringing something" },
  { key: "pings", icon: "📣", label: "Ping home" },
  { key: "fun", icon: "😂", label: "Fun messages (starving alerts, weekly MVP)" },
];

function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={`flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
          checked ? "justify-end bg-green-600" : "justify-start bg-line"
        }`}
      >
        <span className="size-5 rounded-full bg-[#fff]" />
      </span>
    </button>
  );
}

export default function NotificationPrefs({
  userId,
  initial,
}: {
  userId: string;
  initial: NotificationPrefsRow | null;
}) {
  const [supabase] = useState(createClient);
  const [settings, setSettings] = useState<Settings>(() =>
    initial
      ? {
          ...initial,
          // Postgres returns "23:00:00"; a time input wants "23:00".
          quiet_start: initial.quiet_start.slice(0, 5),
          quiet_end: initial.quiet_end.slice(0, 5),
        }
      : DEFAULTS,
  );
  const { toast, showToast, clearToast } = useToast();

  async function change(patch: NotificationPrefsPatch) {
    const previous = settings;
    setSettings({ ...settings, ...patch }); // Show it at once, undo if saving fails.
    // Upsert: creates my row the first time, updates only these columns after.
    const { error } = await supabase.from("notification_prefs").upsert({
      user_id: userId,
      ...patch,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (error) {
      setSettings(previous);
      showToast("Couldn't save that. Try again.");
    } else {
      showToast("Saved");
    }
  }

  const timeClass = "min-h-12 rounded-xl border border-line bg-card px-3 text-base";

  return (
    <section className="mb-6 rounded-2xl bg-card p-4">
      <h2 className="mb-1 text-lg font-bold">What should buzz me?</h2>
      <div className="divide-y divide-line">
        {TYPES.map((type) => (
          <Switch
            key={type.key}
            checked={settings[type.key]}
            onChange={(next) => void change({ [type.key]: next })}
          >
            <span aria-hidden="true">{type.icon}</span> {type.label}
          </Switch>
        ))}
      </div>

      <h3 className="mt-4 font-semibold">Quiet hours</h3>
      <Switch
        checked={settings.quiet_enabled}
        onChange={(next) => void change({ quiet_enabled: next })}
      >
        🌙 No buzzing at night
      </Switch>
      {settings.quiet_enabled && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <label className="flex flex-1 flex-col text-sm text-muted">
              From
              <input
                type="time"
                required
                value={settings.quiet_start}
                onChange={(event) => {
                  if (event.target.value) void change({ quiet_start: event.target.value });
                }}
                className={timeClass}
              />
            </label>
            <label className="flex flex-1 flex-col text-sm text-muted">
              Until
              <input
                type="time"
                required
                value={settings.quiet_end}
                onChange={(event) => {
                  if (event.target.value) void change({ quiet_end: event.target.value });
                }}
                className={timeClass}
              />
            </label>
          </div>
          <p className="mt-2 text-sm text-muted">🔥 Urgent requests still get through.</p>
        </>
      )}

      <Toast toast={toast} onDone={clearToast} />
    </section>
  );
}
