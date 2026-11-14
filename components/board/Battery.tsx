import { batteryColor, type Energy } from "@/lib/energy";

type Props = {
  // undefined = not worked out yet (first render on the server).
  energy: Energy | undefined;
  isMe?: boolean;
  onOpen?: () => void;
};

// A battery icon with the % inside a 44px+ tap target. Always labelled
// "estimate": it's a guess from wake time and activities, not a measurement.
export default function Battery({ energy, isMe = false, onOpen }: Props) {
  const percent = energy?.percent ?? null;
  const colors = percent === null ? null : batteryColor(percent);

  const body = (
    <>
      <span className="flex items-center" aria-hidden="true">
        <span className="relative flex h-6 w-11 items-center overflow-hidden rounded-md border-2 border-stone-700 bg-white dark:border-stone-300">
          {colors && (
            <span
              className={`absolute inset-y-0 left-0 ${colors.fill} motion-safe:transition-[width] motion-safe:duration-700`}
              style={{ width: `${percent}%` }}
            />
          )}
          <span className="relative w-full text-center text-xs font-bold text-stone-900">
            {energy === undefined ? "…" : percent === null ? "?" : `${percent}%`}
          </span>
        </span>
        <span className="h-2.5 w-1 rounded-r-sm bg-stone-700 dark:bg-stone-300" />
      </span>
      <span className={`text-[11px] leading-tight ${colors?.text ?? "text-muted"}`}>
        {energy !== undefined && percent === null
          ? isMe
            ? "Tap to wake up"
            : "not up yet?"
          : "estimate"}
      </span>
    </>
  );

  const label =
    percent === null ? "Energy unknown" : `Energy about ${percent} percent (estimate)`;
  const className = "flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1";

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} aria-label={`${label}. Update my energy`} className={`${className} bg-chip active:bg-line`}>
        {body}
      </button>
    );
  }
  return (
    <span role="img" aria-label={label} className={className}>
      {body}
    </span>
  );
}
