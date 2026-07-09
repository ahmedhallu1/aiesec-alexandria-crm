"use client";

import { useActionState } from "react";
import { loginWithGoogle, loginWithPassword, type LoginState } from "@/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const initial: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginWithPassword, initial);

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-3">
        {state.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="email">AIESEC email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@aiesec.net"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="First time? Type any password"
            required
          />
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <form action={loginWithGoogle}>
        <Button type="submit" variant="outline" className="w-full" size="lg">
          <svg viewBox="0 0 24 24" className="mr-1 size-4" aria-hidden>
            <path
              fill="currentColor"
              d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a6.3 6.3 0 1 1 0-12.6c1.6 0 3 .6 4.1 1.6l2.1-2.1A9.3 9.3 0 1 0 12 21.3c5.35 0 8.9-3.75 8.9-9 0-.4-.05-.8-.1-1.2Z"
            />
          </svg>
          Continue with Google (enables calendar reminders)
        </Button>
      </form>
    </div>
  );
}
