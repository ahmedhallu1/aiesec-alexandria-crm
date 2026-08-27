export const metadata = {
  title: "Privacy policy",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

/** THE PRIVACY POLICY (v35) — public, and required.
 *
 *  Google Play will not accept a listing without a reachable privacy-policy
 *  URL, so this page exists because the Android app exists. It is a PUBLIC
 *  route (see the proxy matcher): a policy behind a sign-in wall is not a
 *  policy anybody can read before deciding to sign in.
 *
 *  ⚠️ THIS IS A STATEMENT THE LC IS MAKING, not boilerplate. It was written
 *  from what the system actually does — the tables it holds, the Google scopes
 *  it asks for, the three processors it runs on. If any of that changes, this
 *  changes in the same commit, exactly like AI_CONTEXT.md.
 */
export default function PrivacyPage() {
  const updated = "27 August 2026";
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
        <h1 className="text-3xl font-bold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sodio · AIESEC in Alexandria · last updated {updated}
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed text-foreground/90">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What Sodio is</h2>
            <p>
              Sodio is the internal CRM of <b>AIESEC in Alexandria</b>. It is not
              a public service: access requires a membership record created by
              the local committee, and there is no way to sign up for it. The
              Android app is the same system in an app icon — it displays
              sodio.vercel.app and holds no separate copy of anything.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What it holds about members</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Identity</b> — name, AIESEC email address, an optional backup
                email, phone number, role, function and manager. This comes from
                the committee&apos;s own membership sheet.
              </li>
              <li>
                <b>Work records</b> — the accounts, contacts, visits, deals,
                sign-ups, calls, comments and attendance a member creates or is
                assigned, and an audit log of changes.
              </li>
              <li>
                <b>Sign-in data</b> — a password hash (never the password), and
                a Google account link where Google sign-in is used.
              </li>
              <li>
                <b>Notification endpoints</b> — if a member turns on phone
                notifications, the address their browser&apos;s push service
                gives us, and the keys needed to encrypt a message to it. It is
                deleted the moment they turn notifications off.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What it holds about other people</h2>
            <p>
              Sodio records the organisations the committee works with and the
              people it speaks to there — a name, a role, a phone number, an
              email address, and notes about the conversation — plus sign-ups
              from AIESEC&apos;s own recruitment forms and CVs shared with the
              committee. This is used to do the work those people got in touch
              about, and for nothing else.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Google access</h2>
            <p>
              Signing in with Google asks for permission to create calendar
              events and to compose email <b>as the member</b> — that is how a
              booked visit lands on their own calendar and how a proposal is
              sent from their own address rather than a shared one. Sodio does
              not read a member&apos;s inbox and does not touch calendar events
              it did not create.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Where the data lives</h2>
            <p>
              Sodio runs on <b>Vercel</b> (hosting), <b>Supabase</b> (database
              and file storage) and <b>Google Workspace</b> (mail, calendar,
              sheets, drive). Data is encrypted in transit. It is not sold, not
              shared with advertisers, and not used to train anything. Questions
              typed to the in-app assistant are sent to Google&apos;s Gemini API
              to be answered.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p>
              Phone notifications are off until a member turns them on, per
              device, and can be turned off in the same place at any time.
              They carry the same words as the in-app bell.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Keeping and deleting</h2>
            <p>
              Records are kept for as long as the committee needs them for its
              operations. A member who leaves is deactivated and loses access;
              their name stays attached to the work they did, which is what
              makes the committee&apos;s own history readable. Anyone —
              member or not — can ask for their personal data to be corrected or
              deleted by writing to the address below, and the committee will
              act on it unless it is required to keep the record.
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
