import { Block, ScreenSkeleton } from "@/components/ui/Skeleton";

// Requests: four quick buttons, then request cards.
export default function Loading() {
  return (
    <ScreenSkeleton title="Requests">
      <Block className="mb-3 h-8 w-32" />
      <div className="mb-6 grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-20" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Block className="h-28" />
        <Block className="h-28" />
      </div>
    </ScreenSkeleton>
  );
}
