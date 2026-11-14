// Phase 5: the emoji avatar with a ring in the person's colour. The ring
// pulses gently for 2 minutes after their status changes, and a trophy sits on
// it while they're the Room MVP.

// People who never picked a colour still get a steady one: the same user id
// always lands on the same palette entry.
const PALETTE = ["#f97316", "#0ea5e9", "#a855f7", "#22c55e", "#ec4899", "#eab308", "#14b8a6", "#ef4444"];

export function colorFor(userId: string, color: string | null) {
  if (color) return color;
  let sum = 0;
  for (const char of userId) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[sum % PALETTE.length];
}

export const RECENT_CHANGE_MS = 2 * 60_000;

type Props = {
  userId: string;
  emoji: string;
  color: string | null;
  size?: "md" | "lg";
  // Status changed in the last 2 minutes.
  pulse?: boolean;
  mvp?: boolean;
};

export default function Avatar({ userId, emoji, color, size = "md", pulse = false, mvp = false }: Props) {
  const ring = colorFor(userId, color);
  const box = size === "lg" ? "size-16 text-4xl" : "size-14 text-3xl";
  return (
    <span className="relative inline-flex shrink-0">
      {/* The ring is a border (not Tailwind's ring-*) because the pulse
          animates box-shadow, and ring-* is also a box-shadow. */}
      <span
        aria-hidden="true"
        style={{ borderColor: ring, ["--ring-color" as string]: `${ring}99` }}
        className={`flex ${box} items-center justify-center rounded-full border-4 bg-card ${
          pulse ? "motion-safe:animate-ring-pulse" : ""
        }`}
      >
        {emoji}
      </span>
      {mvp && (
        <span
          role="img"
          aria-label="Room MVP of the week"
          className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-amber-300 text-sm shadow"
        >
          🏆
        </span>
      )}
    </span>
  );
}
