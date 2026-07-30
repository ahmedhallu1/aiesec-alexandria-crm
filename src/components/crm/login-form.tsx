"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  loginWithGoogle,
  loginWithPassword,
  requestPasswordReset,
  type LoginState,
} from "@/server/auth-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const initial: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginWithPassword, initial);
  const emailRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetPending, startReset] = useTransition();

  const askReset = () =>
    startReset(async () => {
      const res = await requestPasswordReset(resetEmail);
      if (res.ok) {
        toast.success(res.message);
        setResetOpen(false);
      } else {
        toast.error(res.message);
      }
    });

  return (
    <div className="grid gap-4">
      {/* FIRST sign-in is Google-only — it grants the calendar (and future
          Google) access the CRM runs on. Email+password works afterwards. */}
      <form action={loginWithGoogle}>
        <Button type="submit" className="w-full" size="lg">
          <svg viewBox="0 0 24 24" className="mr-1 size-4" aria-hidden>
            <path
              fill="currentColor"
              d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a6.3 6.3 0 1 1 0-12.6c1.6 0 3 .6 4.1 1.6l2.1-2.1A9.3 9.3 0 1 0 12 21.3c5.35 0 8.9-3.75 8.9-9 0-.4-.05-.8-.1-1.2Z"
            />
          </svg>
          Continue with Google
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          <b>First time here?</b> Google sign-in is required once — it connects
          your calendar for visit reminders.
        </p>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or use your password</span>
        <Separator className="flex-1" />
      </div>

      <form action={formAction} className="grid gap-3">
        {state.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="email">AIESEC email or phone</Label>
          <Input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            placeholder="you@aiesec.net · or 01…"
            ref={emailRef}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => {
                setResetEmail(emailRef.current?.value ?? "");
                setResetOpen(true);
              }}
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password · or your phone again (no email yet)"
            required
          />
        </div>
        <Button type="submit" size="lg" variant="outline" className="mt-1 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in with password"}
        </Button>
      </form>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Forgot your password?</DialogTitle>
            <DialogDescription>
              No problem — we&apos;ll <b>email you a fresh password</b> right away.
              Sign in with it, then change it from your Profile whenever you like.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Your AIESEC email</Label>
            <Input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="you@aiesec.net"
            />
          </div>
          <DialogFooter>
            <Button onClick={askReset} disabled={resetPending || !resetEmail.includes("@")}>
              {resetPending ? "Sending…" : "📬 Email me a new password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
