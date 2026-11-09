import { redirect } from "next/navigation";
import OnboardingForm from "@/components/auth/OnboardingForm";
import { getMyRoomId, requireUserId } from "@/lib/room";

export default async function OnboardingPage() {
  const userId = await requireUserId();
  if (await getMyRoomId(userId)) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div className="text-center">
        <p className="text-6xl" aria-hidden="true">
          🚪
        </p>
        <h1 className="mt-2 text-3xl font-bold">Find your people</h1>
      </div>
      <OnboardingForm />
    </main>
  );
}
