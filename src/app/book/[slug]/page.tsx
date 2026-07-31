import { cache } from "react";
import { getBookingPage } from "@/server/data";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { BookingView } from "@/components/crm/booking-view";

/** PUBLIC (v27, no auth — exempted in src/proxy.ts like /inactive): the
 *  Sodio-branded booking page an IR abroad opens from a member's link. All
 *  slot math happens server-side in Cairo time (getBookingPage); the client
 *  only renders precomputed days/slots and submits bookIrCall. */

// the slot list is LIVE data — never let the full-route cache serve a stale
// page (the route uses no dynamic APIs, so Next would otherwise cache it)
export const dynamic = "force-dynamic";

// one fetch per request — generateMetadata and the page share it
const load = cache(getBookingPage);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await load(slug);
  return {
    title: data ? `Book an IR call with ${data.memberName}` : "Book an IR call",
  };
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await load(slug);

  return (
    <main className="aurora relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      {data ? (
        <BookingView
          slug={slug}
          memberName={data.memberName}
          slotMinutes={data.slotMinutes}
          days={data.days}
        />
      ) : (
        <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-4 h-10 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-4 hidden h-10 w-auto dark:block" />
          <h1 className="text-2xl font-bold text-card-foreground">
            This booking link is not active 😴
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The link may have been switched off or renamed. Ask the AIESEC in
            Alexandria member who sent it for a fresh one.
          </p>
        </div>
      )}
    </main>
  );
}
