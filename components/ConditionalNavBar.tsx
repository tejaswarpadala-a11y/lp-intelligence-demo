"use client";

import { NavBar } from "@/components/NavBar";
import { usePathname } from "next/navigation";

export function ConditionalNavBar() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return null;
  }
  return <NavBar />;
}
