"use client";

import Sheet from "@/components/ui/Sheet";
import { ACTIVITIES, FEELS, activityInfo } from "@/lib/energy";
import { clockTime } from "@/lib/schedule";
import type { ActivityRow, ActivityType } from "@/types/database";

type Props = {
  percent: number | null;
  awake: boolean;
  running: ActivityRow | null;
  busy: boolean;
  onWake: () => void;
  onStart: (type: ActivityType) => void;
  onStop: () => void;
  onFeel: (feel: number) => void;
  onClose: () => void;
};

export default function EnergySheet({
  percent,
  awake,
  running,
  busy,
  onWake,
  onStart,
  onStop,
  onFeel,
  onClose,
}: Props) {
  const heading = "mb-2 font-semibold";
  const runningInfo = running ? activityInfo(running.type) : null;

  return (
    <Sheet title={percent === null ? "Energy" : `Energy: about ${percent}%`} onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        An estimate from when you woke up and what you&apos;ve been doing. Planned blocks from your
        Plan count automatically.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={onWake}
        className={`mb-5 min-h-14 w-full rounded-xl text-lg font-bold disabled:opacity-60 ${
          awake ? "bg-chip" : "bg-amber-400 text-amber-950"
        }`}
      >
        ☀️ I just woke up
      </button>

      <section className="mb-5">
        <h3 className={heading}>Doing something?</h3>
        {running && runningInfo && (
          <button
            type="button"
            disabled={busy}
            onClick={onStop}
            className="mb-2 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-on-primary disabled:opacity-60"
          >
            ⏹️ Stop {runningInfo.emoji} {runningInfo.label}
            <span className="font-normal opacity-80">
              (since {clockTime(Date.parse(running.started_at))})
            </span>
          </button>
        )}
        <div className="grid grid-cols-4 gap-2">
          {ACTIVITIES.map((activity) => {
            const active = running?.type === activity.type;
            return (
              <button
                key={activity.type}
                type="button"
                disabled={busy || active}
                aria-pressed={active}
                onClick={() => onStart(activity.type)}
                className={`flex min-h-20 flex-col items-center justify-center rounded-xl text-sm font-semibold disabled:opacity-60 ${
                  active ? "bg-primary text-on-primary" : "bg-chip"
                }`}
              >
                <span aria-hidden="true" className="text-3xl">
                  {activity.emoji}
                </span>
                {activity.label}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className={heading}>How do you feel right now?</h3>
        <div className="grid grid-cols-5 gap-2">
          {FEELS.map((feel) => (
            <button
              key={feel.value}
              type="button"
              disabled={busy}
              onClick={() => onFeel(feel.value)}
              aria-label={`${feel.value} of 5: ${feel.label}`}
              className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-chip text-xs font-semibold disabled:opacity-60"
            >
              <span aria-hidden="true" className="text-3xl">
                {feel.emoji}
              </span>
              {feel.label}
            </button>
          ))}
        </div>
      </section>
    </Sheet>
  );
}
