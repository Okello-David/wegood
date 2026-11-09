import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// For Client Components ("use client"), such as tap handlers and Realtime.
// It uses the public key, so Row Level Security is what protects the data.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
