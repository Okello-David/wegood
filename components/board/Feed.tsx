import { timeAgo } from "@/lib/time";
import type { FeedEventRow } from "@/types/database";

type Props = { events: FeedEventRow[]; now: number };

export default function Feed({ events, now }: Props) {
  return (
    <section className="mt-8" aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="mb-2 text-lg font-bold">
        What&apos;s been happening
      </h2>
      {events.length === 0 ? (
        <p className="rounded-2xl bg-card/60 p-4 text-center text-muted">
          Nothing happened yet. Make some history.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-page rounded-2xl bg-card/70">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline gap-3 px-4 py-3">
              {/* The weekly MVP announcement stands out a little. */}
              <p className={`min-w-0 flex-1 break-words ${event.kind === "mvp" ? "font-bold" : ""}`}>
                {event.message}
              </p>
              <time dateTime={event.created_at} className="shrink-0 text-xs text-muted">
                {timeAgo(event.created_at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
