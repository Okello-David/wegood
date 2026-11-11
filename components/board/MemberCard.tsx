import Battery from "@/components/board/Battery";
import HungerMeter from "@/components/board/HungerMeter";
import LocationChip from "@/components/board/LocationChip";
import { activityInfo, type Energy } from "@/lib/energy";
import { clockTime, type Occurrence } from "@/lib/schedule";
import { etaText, isFuture, isStale, timeAgo } from "@/lib/time";
import type { ProfileRow, StatusRow } from "@/types/database";

type Props = {
  profile: ProfileRow;
  status: StatusRow;
  now: number;
  isMe?: boolean;
  // Open visitor notes for this person: highlighted so they can't miss them.
  notes?: string[];
  // Phase 4. undefined until the browser has worked them out (time zone).
  energy?: Energy;
  plan?: { now: Occurrence | null; next: Occurrence | null };
  onOpen?: () => void;
  onOpenEnergy?: () => void;
};

export default function MemberCard({
  profile,
  status,
  now,
  isMe = false,
  notes = [],
  energy,
  plan,
  onOpen,
  onOpenEnergy,
}: Props) {
  const stale = isStale(status.updated_at, now);

  const content = (
    <>
      {/* pr leaves room for the battery, which sits on top in the corner. */}
      <div className="flex items-center gap-3 pr-18">
        <span className={isMe ? "text-5xl" : "text-4xl"} aria-hidden="true">
          {profile.avatar_emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate font-bold ${isMe ? "text-2xl" : "text-lg"}`}>
            {profile.display_name}
            {isMe && <span className="font-normal text-stone-500"> (you)</span>}
          </h2>
          <p className="text-sm text-stone-600">
            updated {timeAgo(status.updated_at, now)}
            {stale && <span className="font-semibold"> · status may be old</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LocationChip value={status.location_preset} source={status.at_home_source} />
        <HungerMeter value={status.hunger} />
      </div>

      {(plan?.now || plan?.next) && (
        <p className="mt-2 text-sm text-stone-700">
          {plan.now && (
            <span>
              <b>Now:</b> {activityInfo(plan.now.type).emoji} {plan.now.title} until{" "}
              {clockTime(plan.now.end)}
            </span>
          )}
          {plan.now && plan.next && <span aria-hidden="true"> · </span>}
          {plan.next && (
            <span>
              <b>Next:</b> {activityInfo(plan.next.type).emoji} {plan.next.title} at{" "}
              {clockTime(plan.next.start)}
            </span>
          )}
        </p>
      )}
      {status.bringing && (
        <p className="mt-2 break-words">🛍️ Bringing: {status.bringing}</p>
      )}
      {isFuture(status.eta, now) && <p className="mt-1">⏱️ Back {etaText(status.eta, now)}</p>}
      {notes.map((note, index) => (
        <p key={index} className="mt-2 rounded-xl bg-amber-100 px-3 py-2 break-words text-amber-900">
          📬 {note}
        </p>
      ))}
    </>
  );

  const padding = isMe ? "p-5" : "p-4";
  const cardClass = `relative w-full rounded-2xl bg-white text-left shadow-sm transition-opacity ${
    stale && notes.length === 0 ? "opacity-60" : ""
  } ${notes.length > 0 ? "ring-4 ring-amber-400" : ""}`;

  // Two separate tap targets (status and battery), because a button inside
  // a button isn't allowed in HTML.
  return (
    <article className={cardClass}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={`block w-full rounded-2xl text-left ${padding}`}>
          {content}
        </button>
      ) : (
        <div className={padding}>{content}</div>
      )}
      <div className={`absolute ${isMe ? "top-4 right-4" : "top-3 right-3"}`}>
        <Battery energy={energy} isMe={isMe} onOpen={onOpenEnergy} />
      </div>
    </article>
  );
}
