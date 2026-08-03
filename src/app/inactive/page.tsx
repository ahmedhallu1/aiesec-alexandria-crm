import { signOut } from "@/lib/auth";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Account inactive",
  // the LC's own lighthouse mark, same file the PWA manifest uses
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

/** The screen a DEACTIVATED member lands on (v24): their row exists but
 *  Active = No on the Membership sheet. Public route (proxy matcher) so it
 *  renders whether or not a session survives. */
export default function InactivePage() {
  const doSignOut = async () => {
    "use server";
    await signOut({ redirectTo: "/login" });
  };

  return (
    <main className="aurora relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/alex-blue.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 h-16 w-auto dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 hidden h-16 w-auto dark:block" />
        <h1 className="text-2xl font-bold text-card-foreground">
          Your account is <span className="text-destructive">inactive</span> 😴
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your Sodio membership is currently marked inactive, so the workspace
          is closed for you. If you think this is a mistake — or you&apos;re
          coming back — talk to <b>your manager</b> or the{" "}
          <b>IM team (admin)</b> and they&apos;ll switch you back on.
        </p>
        <form action={doSignOut} className="mt-6">
          <Button type="submit" variant="outline" className="w-full">
            Back to sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
