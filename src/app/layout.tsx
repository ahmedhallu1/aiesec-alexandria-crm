import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Lato is AIESEC's official substitute brand typeface (logos.aiesec.org kit)
const sans = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-app-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Sodio · AIESEC in Alexandria",
    template: "%s · Sodio",
  },
  description:
    "Sodio — the ICX CRM of AIESEC in Alexandria. Accounts, visits and pipelines for IGV & IGT.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sodio", statusBarStyle: "default" },
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
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
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
