import { cache } from "react";
import { getManageBooking } from "@/server/data";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { BookingCredit } from "@/components/crm/booking-view";
import { ManageBookingView } from "@/components/crm/manage-booking-view";

/** PUBLIC (v28, no auth — the src/proxy.ts matcher already exempts everything
 *  under /book): the accountless manage page from the IR's confirmation email
 *  — see the booking, RESCHEDULE onto the member's current free slots, or
 *  CANCEL with a reason. The token is the only key; unknown tokens get a
 *  branded "not valid" card. */

// live data (free slots + status) — never serve a cached page
export const dynamic = "force-dynamic";

const load = cache(getManageBooking);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await load(token);
  return {
    title: data ? `Your IR call with ${data.memberName}` : "Manage your IR call",
    // same AIESEC in Alexandria lighthouse mark the app/PWA uses (public/icons)
    icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  };
}

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await load(token);

  return (
    <main className="aurora relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      {data ? (
        <ManageBookingView token={token} data={data} />
      ) : (
        <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-blue.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 h-16 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 hidden h-16 w-auto dark:block" />
          <h1 className="text-2xl font-bold text-card-foreground">
            This manage link is not valid 🤔
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The link may be incomplete — open it straight from your
            confirmation email. If it still fails, reply to that email and the
            team in Alexandria will sort it out.
          </p>
          <BookingCredit />
        </div>
      )}
    </main>
  );
}
