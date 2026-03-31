import { ConditionalNavBar } from "@/components/ConditionalNavBar";
import { FUND_CONFIG, isDemoMode } from "@/lib/config";
import type { Metadata } from "next";
import { JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
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
    <html
      lang="en"
      className={`${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body
        className="min-h-screen bg-white text-gray-900 antialiased"
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
        <div className="min-h-0 bg-white text-gray-900">
          <ConditionalNavBar />
          {children}
        </div>
      </body>
    </html>
  );
}
