import type { ProfileRow } from "@/types/database";

type Props = {
  rows: { user_id: string; points: number }[];
  profiles: Record<string, ProfileRow>;
};

// This week's points, as one row of chips under the Board header. Scrolls
// sideways if a big room doesn't fit on a 375px screen.
export default function Leaderboard({ rows, profiles }: Props) {
  const shown = rows.filter((row) => profiles[row.user_id]);
  return (
    <section aria-label="Room points this week" className="mb-4">
      {shown.length === 0 ? (
        <p className="rounded-2xl bg-card/60 px-4 py-2 text-sm text-muted">
          🏆 No points yet this week. Be the hero.
        </p>
      ) : (
        <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <li className="flex shrink-0 items-center text-sm font-semibold" aria-hidden="true">
            🏆 This week
          </li>
          {shown.map((row, index) => (
            <li
              key={row.user_id}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ${
                index === 0 ? "bg-amber-300 font-bold text-amber-950" : "bg-card"
              }`}
            >
              <span aria-hidden="true">{profiles[row.user_id].avatar_emoji}</span>
              <span>{profiles[row.user_id].display_name}</span>
              <span className="font-bold">{row.points}</span>
              <span className="sr-only">points</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
