import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import { PointerEventsGuard } from "@/components/crm/pointer-events-guard";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Lato is AIESEC's official substitute brand typeface (logos.aiesec.org kit)
const sans = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-app-sans",
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
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
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
