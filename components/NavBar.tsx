"use client";

import { getMostRecentShortlistNav } from "@/app/actions/shortlists";
import { FUND_CONFIG, isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type NavShortlist = {
  id: string;
  name: string;
  lp_count: number;
};

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [shortlist, setShortlist] = useState<NavShortlist | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadUserAndShortlist = useCallback(async () => {
    if (isDemoMode) {
      setUserLabel(FUND_CONFIG.gpName);
      setUserEmail(null);
      try {
        const nav = await getMostRecentShortlistNav();
        setShortlist(nav);
      } catch {
        setShortlist(null);
      }
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUserLabel(null);
      setUserEmail(null);
      setShortlist(null);
      return;
    }
    const label =
      (typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null) ??
      (typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null) ??
      user.email?.split("@")[0] ??
      "User";
    setUserLabel(label);
    setUserEmail(user.email ?? null);

    try {
      const nav = await getMostRecentShortlistNav();
      setShortlist(nav);
    } catch {
      setShortlist(null);
    }
  }, []);

  useEffect(() => {
    void loadUserAndShortlist();
  }, [loadUserAndShortlist]);

  useEffect(() => {
    if (isDemoMode) return;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadUserAndShortlist();
    });
    return () => subscription.unsubscribe();
  }, [loadUserAndShortlist]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function signOut() {
    if (isDemoMode) {
      setMenuOpen(false);
      return;
    }
    const supabase = createClient();
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const displayName =
    userLabel?.trim() || userEmail?.trim() || FUND_CONFIG.gpName;
  const initial = displayName.charAt(0).toUpperCase() || "?";

  const navLink = (href: string, label: string) => {
    const active =
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={`border-b-2 pb-1 ${
          active
            ? "border-emerald-500 text-slate-900"
            : "border-transparent text-slate-500 hover:text-slate-700"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            href="/"
            className="truncate font-serif text-sm font-semibold text-slate-900 hover:text-slate-700"
          >
            {FUND_CONFIG.fundName}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {navLink("/", "Filter & Search")}
            <span className="text-slate-200">|</span>
            {navLink("/shortlist", "Shortlist")}
          </nav>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-4">
          {shortlist ? (
            <Link
              href="/shortlist"
              className="hidden max-w-[220px] truncate text-sm text-slate-500 hover:text-slate-700 sm:block"
            >
              Current: {shortlist.name} · {shortlist.lp_count} LPs
            </Link>
          ) : null}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm hover:bg-slate-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 font-mono text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                {initial}
              </span>
              <span className="max-w-[120px] truncate text-slate-700">
                {displayName || "…"}
              </span>
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-50 mt-1 w-44 rounded-sm border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
