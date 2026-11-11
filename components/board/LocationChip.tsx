import { locationInfo } from "@/lib/status";
import type { LocationPreset } from "@/types/database";

type Props = {
  value: LocationPreset;
  // Who decided at_home last: the phone's geofence ("geo") or a tap ("manual").
  source?: string | null;
};

export default function LocationChip({ value, source = null }: Props) {
  const { emoji, label } = locationInfo(value);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-sm font-medium">
      {emoji} {label}
      {source && (
        <span
          title={source === "geo" ? "Set automatically by location" : "Set by hand"}
          className={`rounded-full px-1.5 text-[11px] leading-5 font-semibold uppercase ${
            source === "geo" ? "bg-emerald-200 text-emerald-900" : "bg-stone-200 text-stone-700"
          }`}
        >
          {source === "geo" ? "auto" : "manual"}
        </span>
      )}
    </span>
  );
}
