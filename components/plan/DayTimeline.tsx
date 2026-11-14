"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { activityInfo } from "@/lib/energy";
import { clockTime, type Occurrence } from "@/lib/schedule";

const MINUTE = 60_000;
export const DAY_START_MIN = 6 * 60; // 06:00
export const DAY_END_MIN = 24 * 60; // 24:00
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP_MIN = 15;
const LONG_PRESS_MS = 300;
// A finger moving more than this before the long-press means "scrolling".
const SCROLL_SLOP_PX = 8;

type Props = {
  dayStart: number; // local midnight of the shown day
  blocks: Occurrence[];
  now: number;
  onCreateAt: (startMin: number) => void;
  onOpenBlock: (block: Occurrence) => void;
  onChangeTime: (block: Occurrence, startMin: number, endMin: number) => void;
};

type Drag = {
  block: Occurrence;
  mode: "move" | "resize";
  pointerId: number;
  pointerType: string;
  startY: number;
  startMin: number;
  endMin: number;
  lifted: boolean;
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  element: HTMLElement;
};

const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;
const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A vertical day (06:00-24:00). Touch-friendly drag with plain pointer events:
// - Tap an empty slot: new block there.
// - Tap a block: edit it.
// - Hold a block ~0.3 s, then drag: move it. Before the hold completes, a
//   finger that moves is treated as scrolling, so the page still scrolls
//   normally when you swipe across blocks.
// - Drag the bar at a block's bottom edge: resize. The bar has
//   touch-action: none, so the browser never scrolls when you grab it.
// Everything snaps to 15 minutes.
export default function DayTimeline({
  dayStart,
  blocks,
  now,
  onCreateAt,
  onOpenBlock,
  onChangeTime,
}: Props) {
  const drag = useRef<Drag | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ id: string; startMin: number; endMin: number } | null>(
    null,
  );

  const minuteOf = (time: number) => (time - dayStart) / MINUTE;

  // While a block is lifted, stop the page from scrolling under the finger.
  // React's touch listeners are "passive" (they can't preventDefault), so
  // this one is added by hand with passive: false.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const stopScroll = (event: TouchEvent) => {
      if (drag.current?.lifted) event.preventDefault();
    };
    element.addEventListener("touchmove", stopScroll, { passive: false });
    return () => element.removeEventListener("touchmove", stopScroll);
  }, []);

  function lift(d: Drag) {
    d.lifted = true;
    // Capture: keep getting this pointer's moves even when the finger leaves
    // the block (it moves away quickly while dragging).
    try {
      d.element.setPointerCapture(d.pointerId);
    } catch {
      // The pointer is already gone; pointerup/cancel will clean up.
    }
    navigator.vibrate?.(10); // A tiny buzz on Android; ignored on iPhone.
    setPreview({ id: d.block.item.id, startMin: d.startMin, endMin: d.endMin });
  }

  function begin(event: ReactPointerEvent<HTMLElement>, block: Occurrence, mode: Drag["mode"]) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startMin = clampNum(minuteOf(block.start), DAY_START_MIN, DAY_END_MIN);
    const endMin = clampNum(minuteOf(block.end), DAY_START_MIN, DAY_END_MIN);
    const d: Drag = {
      block,
      mode,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startY: event.clientY,
      startMin,
      endMin,
      lifted: false,
      moved: false,
      timer: null,
      element: event.currentTarget,
    };
    drag.current = d;
    // Resizing starts straight away (its handle can't scroll the page).
    // Moving with a finger waits for the long-press; a mouse lifts on move.
    if (mode === "resize") lift(d);
    else if (event.pointerType !== "mouse") {
      d.timer = setTimeout(() => {
        if (drag.current === d && !d.moved) lift(d);
      }, LONG_PRESS_MS);
    }
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    const dy = event.clientY - d.startY;

    if (!d.lifted) {
      if (Math.abs(dy) <= SCROLL_SLOP_PX) return;
      d.moved = true;
      if (d.pointerType === "mouse") lift(d);
      else {
        // Finger moved before the long-press: it's a scroll, let it go.
        if (d.timer) clearTimeout(d.timer);
        drag.current = null;
        return;
      }
    }

    const delta = snap(dy / PX_PER_MIN);
    const length = d.endMin - d.startMin;
    if (d.mode === "move") {
      const startMin = clampNum(d.startMin + delta, DAY_START_MIN, DAY_END_MIN - length);
      setPreview({ id: d.block.item.id, startMin, endMin: startMin + length });
    } else {
      const endMin = clampNum(d.endMin + delta, d.startMin + SNAP_MIN, DAY_END_MIN);
      setPreview({ id: d.block.item.id, startMin: d.startMin, endMin });
    }
  }

  function end(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    if (d.timer) clearTimeout(d.timer);
    drag.current = null;

    if (!cancelled && d.lifted && preview && preview.id === d.block.item.id) {
      if (preview.startMin !== d.startMin || preview.endMin !== d.endMin) {
        onChangeTime(d.block, preview.startMin, preview.endMin);
      }
    } else if (!cancelled && !d.lifted && !d.moved) {
      onOpenBlock(d.block); // A plain tap.
    }
    setPreview(null);
  }

  // Tap on empty space: a 1-hour block starting at that half hour.
  function createFromTap(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = DAY_START_MIN + (event.clientY - rect.top) / PX_PER_MIN;
    const startMin = clampNum(Math.floor(minute / 30) * 30, DAY_START_MIN, DAY_END_MIN - 60);
    onCreateAt(startMin);
  }

  const hours = Array.from(
    { length: (DAY_END_MIN - DAY_START_MIN) / 60 },
    (_, i) => DAY_START_MIN / 60 + i,
  );
  const nowMin = minuteOf(now);
  const showNow = nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN;
  const top = (minute: number) => (minute - DAY_START_MIN) * PX_PER_MIN;

  return (
    <div ref={container} className="relative flex select-none [-webkit-touch-callout:none]">
      {/* Hour labels */}
      <div className="w-12 shrink-0" aria-hidden="true">
        {hours.map((hour) => (
          <div key={hour} style={{ height: HOUR_PX }} className="-mt-2 text-xs text-muted">
            {String(hour).padStart(2, "0")}:00
          </div>
        ))}
      </div>

      {/* The grid: tapping empty space creates a block. */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Empty time: tap to add a block"
        onClick={createFromTap}
        style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN }}
        className="relative flex-1 cursor-pointer rounded-xl bg-card"
      >
        {hours.map((hour) => (
          <div
            key={hour}
            style={{ top: top(hour * 60) }}
            className="pointer-events-none absolute inset-x-0 border-t border-line"
          />
        ))}

        {showNow && (
          <div
            id="timeline-now"
            style={{ top: top(nowMin) }}
            className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
          >
            <span className="absolute -top-1.5 -left-1.5 size-3 rounded-full bg-red-500" />
          </div>
        )}

        {blocks.map((block) => {
          const info = activityInfo(block.type);
          const isPreview = preview?.id === block.item.id;
          const startMin = isPreview
            ? preview.startMin
            : clampNum(minuteOf(block.start), DAY_START_MIN, DAY_END_MIN);
          const endMin = isPreview
            ? preview.endMin
            : clampNum(minuteOf(block.end), DAY_START_MIN, DAY_END_MIN);
          if (endMin <= startMin) return null; // Entirely before 06:00.
          const height = (endMin - startMin) * PX_PER_MIN;
          const startAt = dayStart + startMin * MINUTE;
          const endAt = dayStart + endMin * MINUTE;

          return (
            <div
              key={`${block.item.id}-${block.dateKey}`}
              role="button"
              tabIndex={0}
              aria-label={`${block.title}, ${clockTime(startAt)} to ${clockTime(endAt)}. Tap to edit, hold and drag to move.`}
              onPointerDown={(event) => begin(event, block, "move")}
              onPointerMove={move}
              onPointerUp={(event) => end(event)}
              onPointerCancel={(event) => end(event, true)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpenBlock(block);
              }}
              onContextMenu={(event) => event.preventDefault()}
              style={{ top: top(startMin), height }}
              className={`absolute inset-x-1 z-10 rounded-lg border-l-4 px-2 py-1 text-sm ${
                info.color
              } ${isPreview ? "z-30 scale-[1.02] shadow-lg ring-2 ring-ink" : "shadow-sm"} transition-shadow`}
            >
              <div className="h-full overflow-hidden">
              <p className="truncate font-semibold">
                {info.emoji} {block.title}
                {block.item.repeat_days.length > 0 && (
                  <span aria-label="repeats weekly"> 🔁</span>
                )}
              </p>
              {height >= 36 && (
                <p className="text-xs text-ink">
                  {clockTime(startAt)}–{clockTime(endAt)}
                </p>
              )}
              </div>
              {/* Resize handle: a small visible bar; the 28px hit area reaches
                  below the block so even a 15-minute block can be grabbed. */}
              <div
                aria-hidden="true"
                onPointerDown={(event) => begin(event, block, "resize")}
                onPointerMove={move}
                onPointerUp={(event) => end(event)}
                onPointerCancel={(event) => end(event, true)}
                className="absolute inset-x-0 -bottom-3 z-10 flex h-7 cursor-ns-resize touch-none items-center justify-center"
              >
                <span className="h-1 w-8 rounded-full bg-muted/50" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
