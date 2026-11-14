import { Block, ScreenSkeleton } from "@/components/ui/Skeleton";

// Plan: tab switch, day header, the timeline.
export default function Loading() {
  return (
    <ScreenSkeleton title="your plan">
      <Block className="mb-4 h-12" />
      <Block className="mb-3 h-11" />
      <Block className="h-[60dvh]" />
    </ScreenSkeleton>
  );
}
