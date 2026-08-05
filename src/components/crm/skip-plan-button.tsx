"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { skipPlanForNow } from "@/server/actions";
import { Button } from "@/components/ui/button";

/** "I'll do this later" on the first-sign-in planning step (v33.8).
 *
 *  The plan IS the member's period goal, so the ask comes back tomorrow — but
 *  someone who doesn't know their numbers yet will type anything to get past
 *  a wall, and invented numbers are worse than none. */
export function SkipPlanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 text-center">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await skipPlanForNow();
            router.replace("/");
          })
        }
      >
        {pending ? "One moment…" : "Skip for now — I'll fill it from my profile"}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        We&apos;ll ask again tomorrow. Your plan lives on your Profile any time.
      </p>
    </div>
  );
}
