import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-app-sans" });

export const metadata: Metadata = {
  title: {
    default: "AIESEC in Alexandria CRM",
    template: "%s · AIESEC in Alexandria CRM",
  },
  description:
    "The ICX CRM platform of AIESEC in Alexandria — accounts, visits and pipelines for IGV & IGT.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AIESEC CRM", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0A2540" },
    { media: "(prefers-color-scheme: dark)", color: "#061524" },
  ],
};

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster richColors position="top-center" />
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
