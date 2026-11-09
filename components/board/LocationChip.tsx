import { locationInfo } from "@/lib/status";
import type { LocationPreset } from "@/types/database";

export default function LocationChip({ value }: { value: LocationPreset }) {
  const { emoji, label } = locationInfo(value);
  return (
    <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-medium">
      {emoji} {label}
    </span>
  );
}
