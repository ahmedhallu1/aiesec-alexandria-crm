import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/crm/login-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { SodioMark } from "@/components/crm/sodio-mark";

export const metadata = {
  title: "Sign in",
  // Sodio's own mark, the same file the PWA manifest uses
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; fresh?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error, fresh } = await searchParams;

  return (
    <main className="aurora relative flex min-h-dvh items-start justify-center overflow-hidden bg-sidebar p-4 sm:items-center">
      <ThemeToggle className="absolute right-4 top-4 z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {/* Sodio leads on its own front door — the LC owns it and says so on
              the line underneath, rather than the product being a footnote to
              a logo. The /book pages, which real outsiders reach, still lead
              with AIESEC in Alexandria. */}
          <SodioMark px={64} className="brand-mark mx-auto mb-4 h-16 w-16" title="Sodio" />
          <h1 className="font-display text-3xl font-bold tracking-tight text-card-foreground">
            Sodio
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.13em] text-muted-foreground">
            AIESEC in Alexandria
          </p>
        </div>

        {/* JUST SET A PASSWORD (v33.58) — onboarding ends the session on
            purpose so the new password gets used once, immediately. Without
            this line that sign-out reads as being kicked out. No email or
            phone in the URL: a flag says what happened, never who. */}
        {fresh && !error ? (
          <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-100">
            <b>Your password is set 🔐</b> Sign in with it now — once you&apos;ve
            typed it yourself you&apos;ll remember it, and you&apos;re straight
            into Sodio.
          </div>
        ) : null}

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
