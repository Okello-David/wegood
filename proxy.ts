import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16's name for middleware: runs before every matched route.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static files so the install manifest and icons load without login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
};
