import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";

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
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground">
            A
          </div>
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

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" className="w-full" size="lg">
            <svg viewBox="0 0 24 24" className="mr-1 size-4" aria-hidden>
              <path
                fill="currentColor"
                d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a6.3 6.3 0 1 1 0-12.6c1.6 0 3 .6 4.1 1.6l2.1-2.1A9.3 9.3 0 1 0 12 21.3c5.35 0 8.9-3.75 8.9-9 0-.4-.05-.8-.1-1.2Z"
              />
            </svg>
            Continue with your @aiesec.net account
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is limited to AIESEC in Alexandria members listed in the
          membership sheet. Signing in lets the CRM place visit reminders on
          your Google Calendar.
        </p>
        <a
          href="https://wa.me/201099019374?text=Hi%20Ahmed!%20I%27m%20reaching%20out%20about%20the%20AIESEC%20Alexandria%20CRM%20%F0%9F%91%8B"
          target="_blank"
          rel="noreferrer"
          className="mt-4 block text-center text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          System made by <span className="font-semibold">Ahmed Hallul</span> · 💬 WhatsApp
        </a>
      </div>
    </main>
  );
}
