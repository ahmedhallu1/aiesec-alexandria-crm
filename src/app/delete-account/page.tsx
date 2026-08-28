export const metadata = {
  title: "Delete your account",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

/** ACCOUNT DELETION REQUEST (v35.1) — public, required by Play.
 *
 *  Google Play requires every listing to link a page describing how a user
 *  requests their account and data be deleted, what is actually deleted, and
 *  what is kept and for how long. Sodio has no self-service delete (there is
 *  no sign-up either — membership is created by the committee), so this page
 *  is the request FORM's front door: it names the app, names the steps, and
 *  states the retention rule plainly, matching what `deleteAccount` and the
 *  member-deactivation flow actually do in `src/server/actions.ts`.
 *
 *  ⚠️ Keep this in sync with what the system actually deletes/keeps — same
 *  discipline as /privacy and AI_CONTEXT.md.
 */
export default function DeleteAccountPage() {
  const updated = "28 August 2026";
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/alex-blue.png"
          alt="AIESEC in Alexandria"
          className="mb-6 h-14 w-auto dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/alex-white.png"
          alt="AIESEC in Alexandria"
          className="mb-6 hidden h-14 w-auto dark:block"
        />
        <h1 className="text-3xl font-bold tracking-tight">
          Delete your Sodio account
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sodio · AIESEC in Alexandria · last updated {updated}
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed text-foreground/90">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">How to request deletion</h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Email{" "}
                <a
                  className="font-medium text-primary underline"
                  href="mailto:ahmedhallul@aiesec.net?subject=Delete%20my%20Sodio%20account"
                >
                  ahmedhallul@aiesec.net
                </a>{" "}
                from the address on your Sodio account (or say which address it
                is), with the subject <b>&ldquo;Delete my Sodio account&rdquo;</b>.
              </li>
              <li>
                Say your <b>full name</b> and, if you know it, your{" "}
                <b>function/role</b> in the committee — that is enough to find
                the record.
              </li>
              <li>
                You will get a reply confirming the request within a few days.
                Deletion follows the retention rule below.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              There is no in-app delete button. Sodio is a private
              committee tool with no public sign-up — membership is created
              and removed by the Information Management team, which is why a
              request goes to a person rather than a form.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What is deleted</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your name, email address, phone number and password.</li>
              <li>Any device registered for phone notifications.</li>
              <li>
                Your Google sign-in link (the OAuth connection itself; Google
                account data is never held by Sodio in the first place).
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What is kept, and why</h2>
            <p>
              Sodio keeps the <b>work you did</b> — the accounts, contacts,
              visits, deals, comments and calls attributed to you — because it
              is the committee&apos;s own operational history and other
              members&apos; records depend on it staying attached to a name.
              This is the same rule applied to any member who leaves: their
              account is <b>deactivated</b>, not erased, and their name stays
              on the work.
            </p>
            <p>
              If you want your name specifically removed from that history
              rather than the record kept as-is, say so in your request and
              it will be handled case by case — this is not something the
              system does automatically, because it can affect other
              people&apos;s records (a deal, a comment thread, an audit
              trail).
            </p>
            <p>
              Records already included in a nightly backup are retained in
              that backup for up to <b>30 days</b> after deletion, after which
              they age out automatically.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Contact</h2>
            <p>
              Information Management, AIESEC in Alexandria —{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:ahmedhallul@aiesec.net"
              >
                ahmedhallul@aiesec.net
              </a>
            </p>
          </section>
        </div>

        <p className="mt-10 border-t pt-4 text-xs text-muted-foreground">
          Powered by Sodio · AIESEC in Alexandria
        </p>
      </div>
    </main>
  );
}
