import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/crm/login-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-4 h-10 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-4 hidden h-10 w-auto dark:block" />
          <h1 className="text-2xl font-bold text-card-foreground">
            AIESEC <span className="text-primary">in Alexandria</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">ICX CRM · IGV & IGT</p>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error === "AccessDenied"
              ? "This email is not on the LC membership list. Ask your VP or the IM team to add you."
              : "Sign-in failed. Try again — if it keeps happening, contact the IM team."}
          </div>
        ) : null}

        <LoginForm />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is limited to AIESEC in Alexandria members listed in the
          membership sheet. On your first login, any password gets you in — you
          set your own right after.
        </p>
        <a
          href="https://wa.me/201099019374?text=Hi%20Ahmed!%20I%27m%20reaching%20out%20about%20the%20AIESEC%20Alexandria%20CRM%20%F0%9F%91%8B"
          target="_blank"
          rel="noreferrer"
          className="mt-4 block text-center text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          System made by <span className="font-semibold">Ahmed Hallul</span>
        </a>
      </div>
    </main>
  );
}
