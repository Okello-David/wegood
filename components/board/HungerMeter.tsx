import { hungerInfo } from "@/lib/status";

export default function HungerMeter({ value }: { value: number }) {
  const { emoji, label } = hungerInfo(value);
  return (
    <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium">
      {emoji} {label}
    </span>
  );
}
