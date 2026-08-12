"use client";

import { useEffect, useState } from "react";
import { loginWithGoogle } from "@/server/auth-actions";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const KEY = "sodio-grant-nudge";

/** THE GRANT NUDGE (v33.40). Members who joined before their @aiesec.net
 *  existed sign in by phone/password — and when the AIESEC address finally
 *  lands on their row, nothing told them to sign in with Google once. So they
 *  kept working WITHOUT the grant: no calendar events for their visits, no
 *  Gmail drafts, invites falling back to the mailbox. This banner shows until
 *  the grant exists; dismissing it snoozes it for a day, never forever. */
export function GoogleGrantBanner({ email }: { email: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // deferred a tick: the snooze check needs localStorage (client-only), and
    // a synchronous set inside the effect would cascade a re-render
    const t = setTimeout(() => {
      try {
        const snoozedUntil = Number(localStorage.getItem(KEY) ?? 0);
        setVisible(Date.now() > snoozedUntil);
      } catch {
        setVisible(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
      <span className="min-w-0 flex-1">
        ✨ Your AIESEC email (<b className="break-all">{email}</b>) is ready —
        sign in with Google <b>once</b> to unlock your powers: calendar
        reminders for your visits, Gmail drafts and invites from your own name.
      </span>
      <form action={loginWithGoogle}>
        <Button size="sm" className="h-8">
          Sign in with Google
        </Button>
      </form>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-amber-800/70 hover:text-amber-800 dark:text-amber-300/70"
        aria-label="Remind me tomorrow"
        onClick={() => {
          try {
            localStorage.setItem(KEY, String(Date.now() + 24 * 60 * 60 * 1000));
          } catch {}
          setVisible(false);
        }}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
