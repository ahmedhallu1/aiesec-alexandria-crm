import { cache } from "react";
import { headers } from "next/headers";
import { getBookingPage } from "@/server/data";
import { isValidZone } from "@/lib/timezones";
import { db } from "@/lib/supabase";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { BookingView, BookingCredit } from "@/components/crm/booking-view";

/** PUBLIC (v27, no auth — exempted in src/proxy.ts like /inactive): the
 *  Sodio-branded booking page an IR abroad opens from a member's link. All
 *  slot math happens server-side in Cairo time (getBookingPage); the client
 *  only renders precomputed days/slots and submits bookIrCall. */

// the slot list is LIVE data — never let the full-route cache serve a stale
// page (the route uses no dynamic APIs, so Next would otherwise cache it)
export const dynamic = "force-dynamic";

// one fetch per request — generateMetadata and the page share it
const load = cache(getBookingPage);

// the public pages carry the LC's own AIESEC in Alexandria lighthouse mark
// (v31 — same file the PWA manifest uses, public/icons)
const BOOK_ICONS = {
  icon: "/icons/icon-192.png",
  apple: "/icons/icon-192.png",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await load(slug);
  const title = data
    ? `Book an IR call with ${data.memberName}`
    : "Book an IR call";
  const description = data
    ? `Pick a time that suits you — ${data.slotMinutes} minutes with ${data.memberName}, AIESEC in Alexandria. Times are shown in your own time zone.`
    : "AIESEC in Alexandria — international relations calls.";
  // the LINK PREVIEW an IR sees in WhatsApp before they ever open the page
  // (v33.24): the full logo on solid brand blue, never the transparent icon
  return {
    title,
    description,
    icons: BOOK_ICONS,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "AIESEC in Alexandria",
      images: [{ url: "/brand/og-card.png", width: 1200, height: 630, alt: "AIESEC in Alexandria" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/brand/og-card.png"] },
  };
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await load(slug);
  // the KNOWN partner LCs (names + countries only — they're AIESEC entities,
  // not secrets): the booking form suggests them so IRs stop re-typing their
  // LC into a duplicate ("kocaeli" / "Lc kocaeli" / "AIESEC in Kocaeli"), and
  // a recognized name auto-fills the country (v33.17)
  const { data: lcRows } = data
    ? await db().from("partner_lcs").select("name, country").order("name").limit(1000)
    : { data: [] };
  const knownLcs = ((lcRows ?? []) as { name: string; country: string | null }[]);

  // WHERE THE REQUEST APPEARS TO COME FROM (v33.23).
  //
  // The page's clock comes from the BROWSER — that is the device the IR's own
  // calendar runs on, and it is what Google Calendar reads too. But a browser
  // reports the machine's zone, so someone testing through a VPN sees no
  // change at all, and a traveller's laptop can lag behind them.
  //
  // Vercel resolves the caller's IP to a zone at the edge, for free. It is a
  // SECOND opinion, never the verdict: when it disagrees with the browser the
  // page offers a one-tap switch and says where it thinks they are, rather
  // than overriding a clock we can actually trust.
  const h = await headers();
  const ipZoneRaw = h.get("x-vercel-ip-timezone");
  const ipZone = isValidZone(ipZoneRaw) ? ipZoneRaw : null;

  return (
    <main className="aurora relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      {data ? (
        <BookingView
          slug={slug}
          memberName={data.memberName}
          slotMinutes={data.slotMinutes}
          days={data.days}
          knownLcs={knownLcs}
          ipZone={ipZone}
        />
      ) : (
        <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-blue.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 h-16 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 hidden h-16 w-auto dark:block" />
          <h1 className="text-2xl font-bold text-card-foreground">
            This booking link is not active 😴
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The link may have been switched off or renamed. Ask the AIESEC in
            Alexandria member who sent it for a fresh one.
          </p>
          <BookingCredit />
        </div>
      )}
    </main>
  );
}
