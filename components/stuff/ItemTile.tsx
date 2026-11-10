"use client";

import { useRef, useState, type PointerEvent } from "react";
import { STATE_STYLE } from "@/lib/pantry";
import type { PantryItemRow } from "@/types/database";

const HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

type Props = {
  item: PantryItemRow;
  onTap: () => void;
  onHold: () => void;
};

export default function ItemTile({ item, onTap, onHold }: Props) {
  const [popping, setPopping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  // Set when a hold fired, so the click that follows the finger lifting
  // doesn't also cycle the state.
  const held = useRef(false);
  const style = STATE_STYLE[item.state];

  function cancelHold() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function onPointerDown(event: PointerEvent) {
    held.current = false;
    start.current = { x: event.clientX, y: event.clientY };
    cancelHold();
    timer.current = setTimeout(() => {
      held.current = true;
      navigator.vibrate?.(30); // Android only; iPhone ignores it.
      onHold();
    }, HOLD_MS);
  }

  function onPointerMove(event: PointerEvent) {
    // A scrolling finger isn't a hold.
    const dx = Math.abs(event.clientX - start.current.x);
    const dy = Math.abs(event.clientY - start.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancelHold();
  }

  function onClick() {
    if (held.current) {
      held.current = false;
      return;
    }
    setPopping(true);
    onTap();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      // Stops Android's long-press menu.
      onContextMenu={(event) => event.preventDefault()}
      onAnimationEnd={() => setPopping(false)}
      aria-label={`${item.name}: ${style.label}. Tap to change, hold to delete.`}
      // select-none + touch-callout stop iPhone's text magnifier and menu from
      // taking over the long-press.
      className={`flex min-h-20 touch-manipulation flex-col items-start justify-between rounded-2xl border-2 p-3 text-left transition-colors duration-200 select-none [-webkit-touch-callout:none] motion-reduce:animate-none ${
        style.tile
      } ${popping ? "animate-pop" : ""}`}
    >
      <span className="line-clamp-2 font-bold break-words">{item.name}</span>
      <span className="text-sm font-semibold">
        <span aria-hidden="true">{style.icon}</span> {style.label}
      </span>
    </button>
  );
}
