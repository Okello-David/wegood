"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BlockSheet, { type BlockValues } from "@/components/plan/BlockSheet";
import DayTimeline from "@/components/plan/DayTimeline";
import WhosFree from "@/components/plan/WhosFree";
import Toast from "@/components/ui/Toast";
import { useIsClient } from "@/components/ui/useIsClient";
import { useNow } from "@/components/ui/useNow";
import { useToast } from "@/components/ui/useToast";
import { loadSchedule } from "@/lib/queries";
import { useLiveRows } from "@/lib/realtime/useLiveRows";
import { addDays, occurrences, startOfDay, type Occurrence } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/client";
import type { ProfileRow, ScheduleItemRow } from "@/types/database";

const MINUTE = 60_000;

type Props = {
  myId: string;
  roomId: string;
  profiles: ProfileRow[];
  initialSchedule: ScheduleItemRow[];
  serverNow: number;
};

type Editing =
  | { mode: "new"; start: number; end: number }
  | { mode: "edit"; block: Occurrence };

function dayLabel(offset: number, dayStart: number) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return new Date(dayStart).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function PlanScreen({ myId, roomId, profiles, initialSchedule, serverNow }: Props) {
  const [supabase] = useState(createClient);
  const isClient = useIsClient();
  const now = useNow(serverNow);
  const [view, setView] = useState<"mine" | "free">("mine");
  const [dayOffset, setDayOffset] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const scrolled = useRef(false);

  const schedule = useLiveRows({
    supabase,
    table: "schedule_items",
    roomId,
    initialRows: initialSchedule,
    load: loadSchedule,
  });

  const dayStart = addDays(startOfDay(now), dayOffset);
  const mine = useMemo(
    () => schedule.rows.filter((item) => item.user_id === myId),
    [schedule.rows, myId],
  );
  const blocks = useMemo(
    () => occurrences(mine, dayStart, addDays(dayStart, 1)),
    [mine, dayStart],
  );
  const people = useMemo(
    () => [
      ...profiles.filter((p) => p.id === myId),
      ...profiles
        .filter((p) => p.id !== myId)
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    ],
    [profiles, myId],
  );

  // Open the timeline at "now" instead of 06:00.
  useEffect(() => {
    if (!isClient || view !== "mine" || scrolled.current) return;
    scrolled.current = true;
    document.getElementById("timeline-now")?.scrollIntoView({ block: "center" });
  }, [isClient, view]);

  const at = (minuteOfDay: number) => dayStart + minuteOfDay * MINUTE;
  const iso = (time: number) => new Date(time).toISOString();

  async function run(action: () => PromiseLike<{ error: unknown }>, message: string) {
    setBusy(true);
    const { error } = await action();
    setBusy(false);
    if (error) {
      showToast("Couldn't save that. Try again.");
      await schedule.refetch();
      return false;
    }
    showToast(message);
    return true;
  }

  async function save(values: BlockValues) {
    if (!editing) return;
    if (editing.mode === "new") {
      const ok = await run(
        () =>
          supabase.from("schedule_items").insert({
            room_id: roomId,
            title: values.title,
            type: values.type,
            starts_at: iso(editing.start),
            ends_at: iso(editing.end),
            repeat_days: values.repeatDays,
          }),
        values.repeatDays.length ? "Added, every week 🔁" : "Added to your plan 📅",
      );
      if (ok) {
        setEditing(null);
        await schedule.refetch();
      }
      return;
    }
    const { item } = editing.block;
    const patch = { title: values.title, type: values.type, repeat_days: values.repeatDays };
    schedule.setRows((rows) => rows.map((r) => (r.id === item.id ? { ...r, ...patch } : r)));
    setEditing(null);
    await schedule.hold(item.id, () =>
      run(() => supabase.from("schedule_items").update(patch).eq("id", item.id), "Saved ✅"),
    );
  }

  // Dragging a weekly block moves the whole series: the same shift is
  // applied to the original start/end, which keeps its weekdays.
  async function changeTime(block: Occurrence, startMin: number, endMin: number) {
    const { item } = block;
    const shiftStart = at(startMin) - block.start;
    const shiftEnd = at(endMin) - block.end;
    const patch = {
      starts_at: iso(Date.parse(item.starts_at) + shiftStart),
      ends_at: iso(Date.parse(item.ends_at) + shiftEnd),
    };
    schedule.setRows((rows) => rows.map((r) => (r.id === item.id ? { ...r, ...patch } : r)));
    await schedule.hold(item.id, () =>
      run(
        () => supabase.from("schedule_items").update(patch).eq("id", item.id),
        item.repeat_days.length ? "Moved, every week 🔁" : "Moved ✅",
      ),
    );
  }

  async function skipDay(block: Occurrence) {
    const { item } = block;
    const skipped = [...item.skipped_dates, block.dateKey];
    schedule.setRows((rows) =>
      rows.map((r) => (r.id === item.id ? { ...r, skipped_dates: skipped } : r)),
    );
    setEditing(null);
    await schedule.hold(item.id, () =>
      run(
        () => supabase.from("schedule_items").update({ skipped_dates: skipped }).eq("id", item.id),
        "Skipped this day ⏭️ (won't count for energy)",
      ),
    );
  }

  async function remove(block: Occurrence) {
    const { item } = block;
    schedule.setRows((rows) => rows.filter((r) => r.id !== item.id));
    setEditing(null);
    await run(() => supabase.from("schedule_items").delete().eq("id", item.id), "Deleted 🗑️");
  }

  const tab = (active: boolean) =>
    `min-h-11 flex-1 rounded-xl font-semibold ${active ? "bg-primary text-on-primary" : "text-muted"}`;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28">
      <h1 className="mb-3 text-2xl font-bold">Plan 📅</h1>
      <div role="tablist" className="mb-4 flex gap-1 rounded-2xl bg-card p-1">
        <button role="tab" aria-selected={view === "mine"} type="button" onClick={() => setView("mine")} className={tab(view === "mine")}>
          My day
        </button>
        <button role="tab" aria-selected={view === "free"} type="button" onClick={() => setView("free")} className={tab(view === "free")}>
          Who&apos;s free?
        </button>
      </div>

      {/* Times depend on the phone's time zone, so nothing is drawn on the server. */}
      {!isClient && <p className="text-muted">Loading…</p>}

      {isClient && view === "mine" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label="Previous day" onClick={() => setDayOffset((d) => d - 1)} className="size-11 rounded-full bg-card text-xl">
              ‹
            </button>
            <p className="font-semibold">{dayLabel(dayOffset, dayStart)}</p>
            <button type="button" aria-label="Next day" onClick={() => setDayOffset((d) => d + 1)} className="size-11 rounded-full bg-card text-xl">
              ›
            </button>
          </div>
          <p className="mb-3 text-sm text-muted">
            Tap empty time to add. Hold a block, then drag to move it. Drag its bottom bar to
            make it longer.
          </p>
          <DayTimeline
            dayStart={dayStart}
            blocks={blocks}
            now={now}
            onCreateAt={(startMin) =>
              setEditing({ mode: "new", start: at(startMin), end: at(Math.min(startMin + 60, 24 * 60)) })
            }
            onOpenBlock={(block) => setEditing({ mode: "edit", block })}
            onChangeTime={(block, startMin, endMin) => void changeTime(block, startMin, endMin)}
          />
        </>
      )}

      {isClient && view === "free" && (
        <WhosFree people={people} myId={myId} schedule={schedule.rows} now={now} />
      )}

      {editing && (
        <BlockSheet
          key={editing.mode === "edit" ? editing.block.item.id : "new"}
          mode={editing.mode}
          start={editing.mode === "new" ? editing.start : editing.block.start}
          end={editing.mode === "new" ? editing.end : editing.block.end}
          weekday={new Date(dayStart).getDay()}
          initial={
            editing.mode === "edit"
              ? {
                  title: editing.block.title,
                  type: editing.block.type,
                  repeatDays: editing.block.item.repeat_days,
                }
              : undefined
          }
          busy={busy}
          onSave={(values) => void save(values)}
          onSkipDay={
            editing.mode === "edit" && editing.block.item.repeat_days.length > 0
              ? () => void skipDay(editing.block)
              : undefined
          }
          onDelete={editing.mode === "edit" ? () => void remove(editing.block) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </main>
  );
}
