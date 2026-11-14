import { Block, ScreenSkeleton } from "@/components/ui/Skeleton";

// Home Stuff: tabs, then a grid of item tiles.
export default function Loading() {
  return (
    <ScreenSkeleton title="Home Stuff">
      <Block className="mb-5 h-12" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Block key={i} className="h-20" />
        ))}
      </div>
    </ScreenSkeleton>
  );
}
