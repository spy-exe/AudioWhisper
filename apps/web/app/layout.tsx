import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

import { TopBar } from "@/components/ui/TopBar";
import { AuthGate } from "@/components/ui/AuthGate";
import { LiveStudio } from "@/components/live/LiveStudio";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { MotionPreferences } from "@/components/ui/MotionPreferences";

import "./globals.css";
import "./workspace.css";
import "./motion.css";

const heading = localFont({
  src: "../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-heading",
  display: "swap",
});
const body = localFont({
  src: "../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AudioWhisper 2.1 · Studio",
  description:
    "Gravação, transcrição e organização de áudio no seu computador.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-screen">
        <AuthGate>
          <SettingsProvider>
            <MotionPreferences>
              <TopBar />
              <LiveStudio />
              <main id="main-content" className="app-content min-w-0">
                {children}
              </main>
            </MotionPreferences>
          </SettingsProvider>
        </AuthGate>
      </body>
    </html>
  );
}
