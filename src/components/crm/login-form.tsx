"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  identifyMember,
  loginWithGoogle,
  loginWithPassword,
  requestPasswordReset,
  type LoginState,
} from "@/server/auth-actions";
import type { LoginRoute } from "@/lib/login-routing";
import { ADMIN_WHATSAPP } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

const initial: LoginState = { error: null };

/** IDENTIFY FIRST, THEN SHOW ONE DOOR (v36).
 *
 *  The old page put a Google button and a fully operable password form side by
 *  side and left the member to guess. That guess is wrong for a large part of
 *  the LC, and it is wrong in a way the page then blamed them for:
 *
 *   · 6 members have never had a password, so the password box could only ever
 *     fail for them — and its placeholder ("Your password") told them they had
 *     one. The Google-first rule was stated once, in 11px grey, underneath.
 *   · 15 members have no AIESEC address at all and sign in with their phone in
 *     BOTH fields. Nothing on the page said so before they failed.
 *   · Anyone typing a personal Gmail, and anyone not on the membership sheet,
 *     got the SAME sentence as a real member who simply hadn't signed in yet —
 *     and were sent to the Google button, where they would fail again for a
 *     different reason.
 *
 *  So Sodio asks who you are first and then shows only the door that is
 *  actually yours. The decision is `routeLogin` in src/lib/login-routing.ts —
 *  pure, tested, and shared with the server — so what the page offers and what
 *  the server accepts cannot drift apart. */
export function LoginForm() {
  const [route, setRoute] = useState<LoginRoute | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [identifying, startIdentify] = useTransition();
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  const identify = () =>
    startIdentify(async () => {
      setIdentifyError(null);
      const res = await identifyMember(identifier);
      if (res.error) {
        setIdentifyError(res.error);
        return;
      }
      setRoute(res.route);
    });

  // STEP ONE — one field, one question.
  if (!route) {
    return (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          identify();
        }}
      >
        {identifyError ? <ErrorBox>{identifyError}</ErrorBox> : null}
        <div className="grid gap-1.5">
          <Label htmlFor="identifier">Your AIESEC email, or your phone number</Label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="you@aiesec.net · or 01…"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Sodio will show you the right way to sign in — you don&apos;t have to
            know which one it is.
          </p>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={identifying}>
          {identifying ? "Checking…" : "Continue"}
        </Button>
      </form>
    );
  }

  // STEP TWO — the one door that is theirs.
  return (
    <div className="grid gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-sm">
          {route.firstName ? (
            <>
              Welcome back, <b>{route.firstName}</b>.
            </>
          ) : (
            <span className="text-muted-foreground break-all">{route.identifier}</span>
          )}
        </p>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
          onClick={() => {
            setRoute(null);
            setIdentifyError(null);
          }}
        >
          Not you?
        </button>
      </div>

      {route.door === "google_first" ? <GoogleFirst route={route} /> : null}
      {route.door === "password" ? <PasswordDoor route={route} /> : null}
      {route.door === "phone_both" ? <PhoneBothDoor route={route} /> : null}
      {route.door === "unknown" ? <UnknownDoor route={route} /> : null}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-100">
      {children}
    </div>
  );
}

function GoogleButton({ label }: { label: string }) {
  return (
    <form action={loginWithGoogle}>
      <Button type="submit" className="w-full" size="lg">
        <svg viewBox="0 0 24 24" className="mr-1 size-4" aria-hidden>
          <path
            fill="currentColor"
            d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a6.3 6.3 0 1 1 0-12.6c1.6 0 3 .6 4.1 1.6l2.1-2.1A9.3 9.3 0 1 0 12 21.3c5.35 0 8.9-3.75 8.9-9 0-.4-.05-.8-.1-1.2Z"
          />
        </svg>
        {label}
      </Button>
    </form>
  );
}

/** Never signed in, and they have an AIESEC address. Google, once — and the
 *  page says WHY, because "because we said so" is what makes people try the
 *  password box instead. */
function GoogleFirst({ route }: { route: LoginRoute }) {
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <p className="font-medium">This is your first sign-in.</p>
        <p className="mt-1 text-muted-foreground">
          Use Google this once, with <b>{route.identifier}</b>. It connects your
          calendar for visit reminders and lets Sodio send proposals from your own
          Gmail. You&apos;ll pick a password straight afterwards, and every sign-in
          after that can use it.
        </p>
      </div>
      <GoogleButton label="Continue with Google" />
      <p className="text-center text-xs text-muted-foreground">
        Pick your <b>@aiesec.net</b> account on the Google screen — a personal
        Gmail will never match the membership list.
      </p>
      {/* ⚠️ okTemp (auth.ts) lets an emailed temporary password through even
          on a first sign-in, precisely so nobody is ever locked out. If one is
          waiting for them, the page must not tell them Google is their only
          option — that would be a false statement about their own account. */}
      {route.hasTempPassword ? (
        <p className="text-center text-xs text-muted-foreground">
          We also emailed you a password recently — that works too, if Google is
          giving you trouble.
        </p>
      ) : null}
    </div>
  );
}

/** They have a password (their own, or an emailed one). */
function PasswordDoor({ route }: { route: LoginRoute }) {
  const [state, formAction, pending] = useActionState(loginWithPassword, initial);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState(route.looksLikeEmail ? route.identifier : "");
  const [resetPending, startReset] = useTransition();

  const askReset = () =>
    startReset(async () => {
      const res = await requestPasswordReset(resetEmail);
      if (res.ok) {
        toast.success(res.message);
        setResetOpen(false);
      } else toast.error(res.message);
    });

  return (
    <>
      <form action={formAction} className="grid gap-3">
        {state.error ? (
          <ErrorBox>
            {state.error}
            {state.needsHuman ? <WhatsAppOut /> : null}
          </ErrorBox>
        ) : null}
        <input type="hidden" name="identifier" value={route.identifier} />
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Your password</Label>
            {/* ⚠️ Offered ONLY when a reset can actually deliver something.
                For the members with no inbox anywhere it is a button that
                silently does nothing, which is worse than not having it. */}
            {route.canResetByEmail ? (
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => setResetOpen(true)}
              >
                Forgot password?
              </button>
            ) : null}
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        {!route.canResetByEmail ? (
          <p className="text-xs text-muted-foreground">
            Forgotten it? We have no inbox on file for you, so a reset can&apos;t
            reach you — <WhatsAppLink>message the IM team</WhatsAppLink> and
            they&apos;ll sort it in a minute.
          </p>
        ) : null}
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <GoogleButton label="Continue with Google instead" />

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Forgot your password?</DialogTitle>
            <DialogDescription>
              We&apos;ll <b>email you a fresh one</b> right away. Your old password
              keeps working until you change it, so this can never lock you out.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Your email</Label>
            <Input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="you@aiesec.net"
            />
            <p className="text-xs text-muted-foreground">
              Your AIESEC address — or the backup Gmail on your profile, if
              that&apos;s the inbox you actually have.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={askReset} disabled={resetPending || !resetEmail.includes("@")}>
              {resetPending ? "Sending…" : "📬 Email me a new password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** NO AIESEC ADDRESS YET — the phone is both the username and the password.
 *
 *  A fifth of the active LC signs in this way, and until now the only place
 *  that was ever said was a placeholder they read after already failing. It
 *  gets its own screen, with the password field PREFILLED, because asking
 *  somebody to type the same number twice to prove they know it is theatre. */
function PhoneBothDoor({ route }: { route: LoginRoute }) {
  const [state, formAction, pending] = useActionState(loginWithPassword, initial);
  return (
    <form action={formAction} className="grid gap-3">
      {state.error ? (
        <ErrorBox>
          {state.error}
          {state.needsHuman ? <WhatsAppOut /> : null}
        </ErrorBox>
      ) : null}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
        <p className="font-medium">You don&apos;t have an AIESEC email on the list yet.</p>
        <p className="mt-1 text-muted-foreground">
          Until it arrives, <b>your phone number is your password too</b> — it is
          filled in below, so just press Sign in. Once your @aiesec.net lands, ask
          the IM team to add it and you&apos;ll sign in with Google instead.
        </p>
      </div>
      <input type="hidden" name="identifier" value={route.identifier} />
      <div className="grid gap-1.5">
        <Label htmlFor="password">Your phone number (again)</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          defaultValue={route.identifier}
          required
        />
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Not working? <WhatsAppLink>Message the IM team</WhatsAppLink> — they can
        see your row on the membership sheet and fix it while you wait.
      </p>
    </form>
  );
}

/** Not on the membership sheet under what they typed. THREE different people
 *  land here and they need three different sentences — the old page gave them
 *  all the same one and pointed them at the Google button, where they would
 *  fail again for a different reason. */
function UnknownDoor({ route }: { route: LoginRoute }) {
  const personalGmail = /@(gmail|hotmail|outlook|yahoo|icloud)\./i.test(route.identifier);
  return (
    <div className="grid gap-3">
      <ErrorBox>
        {personalGmail ? (
          <>
            <b>{route.identifier}</b> is a personal address, and Sodio only knows
            your <b>@aiesec.net</b> one. Try that instead.
          </>
        ) : route.looksLikeEmail ? (
          <>
            We can&apos;t find <b>{route.identifier}</b> on the membership list.
            Check the spelling — or your AIESEC address may not have been added
            yet, in which case sign in with your <b>phone number</b> instead.
          </>
        ) : (
          <>
            No member on the list has the phone number <b>{route.identifier}</b>.
            Check the digits, or try your AIESEC email.
          </>
        )}
      </ErrorBox>
      <p className="text-sm text-muted-foreground">
        Still stuck? <WhatsAppLink>Message the IM team</WhatsAppLink> — they can
        see the membership sheet and will tell you exactly what it says about you.
      </p>
    </div>
  );
}

function WhatsAppLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={`https://wa.me/${ADMIN_WHATSAPP}`}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary hover:underline"
    >
      {children}
    </a>
  );
}

/** Shown under an error that retrying cannot fix. */
function WhatsAppOut() {
  return (
    <p className="mt-2 font-normal">
      Trying again won&apos;t help this one — <WhatsAppLink>message the IM team</WhatsAppLink>.
    </p>
  );
}
