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
        <p className="rounded-2xl bg-white/60 p-4 text-center text-stone-600">
          All quiet. Go run out of sugar or something.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-amber-100 rounded-2xl bg-white/70">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline gap-3 px-4 py-3">
              <p className="min-w-0 flex-1 break-words">{event.message}</p>
              <time dateTime={event.created_at} className="shrink-0 text-xs text-stone-500">
                {timeAgo(event.created_at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
