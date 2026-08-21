import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, IBM_Plex_Mono, Karla } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import { PointerEventsGuard } from "@/components/crm/pointer-events-guard";
import { SodioSvgDefs } from "@/components/crm/sodio-mark";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// SODIO'S TYPE: Familjen Grotesk for voice, Karla for work, IBM Plex Mono for
// facts. Karla replaces Lato — same warmth, tighter widths, which is what lets
// a nine-column accounts table stay readable on a laptop without dropping
// below 14px. The mono carries column heads, metadata labels and numerals, so
// columns line up. Grotesk and Karla are VARIABLE (no weight array needed);
// IBM Plex Mono is static, so it names only the two weights actually used.
const sans = Karla({
  subsets: ["latin"],
  variable: "--font-app-sans",
  display: "swap",
});
const display = Familjen_Grotesk({
  subsets: ["latin"],
  variable: "--font-app-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-app-mono",
  display: "swap",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://sodio.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Sodio · AIESEC in Alexandria",
    template: "%s · Sodio",
  },
  description:
    "Sodio — the CRM of AIESEC in Alexandria.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sodio", statusBarStyle: "default" },
  // THE LINK PREVIEW (v33.24). With no openGraph image at all, WhatsApp fell
  // back to scraping the page and grabbed the 192px PWA icon — a small
  // TRANSPARENT PNG, which every chat app composites onto white and then
  // masks into a rounded square: the "low quality with strange white corners"
  // people were seeing. A real 1200×630 OPAQUE card fixes both at once.
  openGraph: {
    type: "website",
    siteName: "Sodio · AIESEC in Alexandria",
    title: "Sodio · AIESEC in Alexandria",
    description: "The CRM of AIESEC in Alexandria.",
    url: APP_URL,
    images: [{ url: "/brand/og-card.png", width: 1200, height: 630, alt: "AIESEC in Alexandria" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sodio · AIESEC in Alexandria",
    description: "The CRM of AIESEC in Alexandria.",
    images: ["/brand/og-card.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0A2540" },
    { media: "(prefers-color-scheme: dark)", color: "#061524" },
  ],
  // without "cover", env(safe-area-inset-*) is always 0 on iOS — the app's
  // notch-safe paddings depend on it
  viewportFit: "cover",
};

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          {/* the mascot's exact brand tint — see SodioSvgDefs */}
          <SodioSvgDefs />
          {/* iOS: release a modal lock that was never cleaned up (v33.24) */}
          <PointerEventsGuard />
          <Toaster richColors position="top-center" />
        </ThemeProvider>
        {GA_ID ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');`}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
