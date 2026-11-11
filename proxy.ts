import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16's name for middleware: runs before every matched route.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static files so the install manifest, icons and service worker load
  // without login. A redirect on sw.js would stop the browser updating it.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)",
  ],
};
