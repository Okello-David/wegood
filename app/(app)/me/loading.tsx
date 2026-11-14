import { Block, ScreenSkeleton } from "@/components/ui/Skeleton";

// Me: a few settings cards.
export default function Loading() {
  return (
    <ScreenSkeleton title="your settings">
      <div className="flex flex-col gap-6">
        <Block className="h-28" />
        <Block className="h-48" />
        <Block className="h-40" />
      </div>
    </ScreenSkeleton>
  );
}
