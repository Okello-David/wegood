import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // A refreshed token must reach both the page rendering now (request)
        // and the browser (response), or the two fall out of sync.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims verifies the token, unlike getSession, which only reads a cookie.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  let redirectTo: string | null = null;
  if (!signedIn && !isPublicPath(pathname)) redirectTo = "/login";
  if (signedIn && pathname === "/login") redirectTo = "/";

  if (redirectTo) {
    const redirect = NextResponse.redirect(new URL(redirectTo, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
