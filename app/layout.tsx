import type { Metadata } from "next";
import localFont from "next/font/local";
import { FUND_CONFIG, isDemoMode } from "@/lib/config";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: `LP Intelligence — ${FUND_CONFIG.fundName}`,
  description: `LP prioritization and intelligence for ${FUND_CONFIG.fundName}.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {isDemoMode ? (
          <div
            role="status"
            className="w-full bg-amber-400 px-4 py-2 text-center text-sm text-amber-950"
          >
            🔍 Demo Mode — All LP records are fictional. No real organizations
            are represented.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
