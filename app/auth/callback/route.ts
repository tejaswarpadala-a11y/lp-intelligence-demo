import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || origin;
  const loginUrl = `${siteBase}/login`;
  const homeUrl = `${siteBase}/`;

  if (!code) {
    return NextResponse.redirect(loginUrl);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // ignore in read-only contexts
          }
        },
      },
    },
  );

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(loginUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email) {
    const name =
      (typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null) ??
      (typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null) ??
      user.email.split("@")[0] ??
      "User";

    const { error: insertError } = await supabase.from("users").insert({
      id: user.id,
      email: user.email,
      name,
      role: "gp",
    });

    if (insertError && !isUniqueViolation(insertError)) {
      console.error("users insert:", insertError);
    }
  }

  return NextResponse.redirect(homeUrl);
}
