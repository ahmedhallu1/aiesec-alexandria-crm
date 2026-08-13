import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/crm/login-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";

export const metadata = {
  title: "Sign in",
  // the LC's own lighthouse mark, same file the PWA manifest uses
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="aurora relative flex min-h-dvh items-start justify-center overflow-hidden bg-sidebar p-4 sm:items-center">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {/* the LC's OWN logo (v31) — this page is externally reachable */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-blue.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 h-16 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 hidden h-16 w-auto dark:block" />
          <h1 className="text-2xl font-bold text-card-foreground">
            AIESEC <span className="text-primary">in Alexandria</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground"><span className="font-bold text-foreground">Sodio</span></p>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-100">
            {error === "AccessDenied" ? (
              <>
                That Google account isn&apos;t on the LC membership list.{" "}
                <b>Make sure you picked your @aiesec.net account</b> — a personal
                Gmail will never match. If your AIESEC address is right and this
                keeps happening, ask your VP or the IM team.
              </>
            ) : (
              <>
                Sign-in failed. If Google showed an error before this, sign out of
                your other Google accounts (or use a private window) and try once
                more — then tell the IM team if it persists.
              </>
            )}
          </div>
        ) : null}

        <LoginForm />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is limited to AIESEC in Alexandria members listed in the
          membership sheet. First login is with Google (it connects your
          calendar) — then you set a password and can use either.
        </p>
        <a
          href="http://elevate2point0.com/"
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground transition-opacity hover:opacity-80"
          title="Created by 2.0 — elevate2point0.com"
        >
          <span>Created by</span>
          {/* theme-swap: black mark on light bg, white mark on dark bg */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/2.0-light.png" alt="2.0" className="block h-4 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/2.0-dark.png" alt="2.0" className="hidden h-4 w-auto dark:block" />
        </a>
      </div>
    </main>
  );
}
