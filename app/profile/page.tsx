import { redirect } from "next/navigation";

// The profile screen moved to the "Me" tab in Phase 2; old links still work.
export default function ProfilePage() {
  redirect("/me");
}
