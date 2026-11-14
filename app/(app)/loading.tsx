import { Block, ScreenSkeleton } from "@/components/ui/Skeleton";

// Board: header, leaderboard strip, my big card, two roommate cards.
export default function Loading() {
  return (
    <ScreenSkeleton title="the Board">
      <div className="mb-4 flex items-center justify-between">
        <Block className="h-12 w-44" />
        <Block className="size-14 rounded-full" />
      </div>
      <Block className="mb-4 h-11" />
      <div className="flex flex-col gap-3">
        <Block className="h-40" />
        <Block className="h-32" />
        <Block className="h-32" />
      </div>
    </ScreenSkeleton>
  );
}
