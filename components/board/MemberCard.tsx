import HungerMeter from "@/components/board/HungerMeter";
import LocationChip from "@/components/board/LocationChip";
import { etaText, isFuture, isStale, timeAgo } from "@/lib/time";
import type { ProfileRow, StatusRow } from "@/types/database";

type Props = {
  profile: ProfileRow;
  status: StatusRow;
  now: number;
  isMe?: boolean;
  onOpen?: () => void;
};

export default function MemberCard({ profile, status, now, isMe = false, onOpen }: Props) {
  const stale = isStale(status.updated_at, now);

  const content = (
    <>
      <div className="flex items-center gap-3">
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
        <LocationChip value={status.location_preset} />
        <HungerMeter value={status.hunger} />
      </div>

      {status.bringing && (
        <p className="mt-2 break-words">🛍️ Bringing: {status.bringing}</p>
      )}
      {isFuture(status.eta, now) && <p className="mt-1">⏱️ Back {etaText(status.eta, now)}</p>}
    </>
  );

  const cardClass = `w-full rounded-2xl bg-white text-left shadow-sm transition-opacity ${
    isMe ? "p-5" : "p-4"
  } ${stale ? "opacity-60" : ""}`;

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={cardClass}>
        {content}
      </button>
    );
  }
  return <article className={cardClass}>{content}</article>;
}
