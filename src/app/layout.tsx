import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PwaRegister from "@/components/pwa-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHER — Generative Music Engine",
  description:
    "A music player unlike any other: every track is composed and synthesized live in your browser with the Web Audio API. No audio files, just mathematics.",
  // Static manifest in public/ — Next emits <link rel="manifest">, which is what
  // makes AETHER installable and lets the service worker own the offline shell.
  manifest: "/manifest.webmanifest",
  applicationName: "AETHER",
  appleWebApp: {
    capable: true,
    title: "AETHER",
    // Matches the dark background_color so the iOS status bar blends into the UI.
    statusBarStyle: "black-translucent",
  },
};

// `viewport-fit=cover` lets the layout extend under the notch/home indicator,
// so the fixed transport can add its own safe-area padding (see globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#050507",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
