"use client";

import { useState, useSyncExternalStore } from "react";
import { ROLE_BLURBS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TourStep {
  icon: string;
  title: string;
  body: string;
}

/** Builds the first-run walkthrough dynamically from the member's role and
 *  function(s) — an MM sees their duties, a leader sees their powers. */
function buildSteps(role: string, functions: string[], hasModule: boolean): TourStep[] {
  const fnLabel = functions.filter((f) => f === "IGV" || f === "IGT").join(" & ") || "ICX";
  const isLeader = role === "LCVP" || role === "Director" || role === "LCP";
  const isTl = role === "Team Leader";

  const steps: TourStep[] = [
    {
      icon: "👋",
      title: `Your ${fnLabel} workspace`,
      body:
        ROLE_BLURBS[role] ??
        "Your accounts, contacts and visits live here — log everything and keep next steps set.",
    },
  ];

  if (!hasModule) {
    steps.push({
      icon: "✨",
      title: "Your module is on the way",
      body: "Sodio currently covers the ICX Raising process. You'll get an email the moment your workspace opens — meanwhile your Profile and Feedback pages are already yours.",
    });
    return steps;
  }

  steps.push(
    {
      icon: "🏢",
      title: "Accounts — your pipeline",
      body: `Every company you raise lives in Accounts. Add them one by one or import a whole market-research sheet. Names are unique across all ICX — if someone already works it or it was archived, the system blocks it and tells you who/why.`,
    },
    {
      icon: "📞",
      title: "Log every contact",
      body: "Use the Contact button after every attempt (call / WhatsApp / email). Golden rule: every account carries a next step with a date — or a scheduled visit. 3 attempts with no answer → Sodio asks you to archive it. \"Not interested\" archives it automatically.",
    },
    {
      icon: "🗓️",
      title: "Visits & reminders",
      body: "Schedule a visit and it lands on the responsible member's Google Calendar with reminders 24h and 1h before (sign in with Google once to enable that). After the visit, report it — your leaders are notified automatically.",
    },
    {
      icon: "📊",
      title: "Dashboard, goal & leaderboard",
      body: `The dashboard shows your ${fnLabel} numbers, the slots goal for the period, and the leaderboard — your results next to your teammates'. Push it up. 🏆`,
    }
  );

  if (isTl) {
    steps.push({
      icon: "👥",
      title: "You lead a team",
      body: "You see and manage your whole team's accounts, choose who's responsible for each one (you or a team member), set your TEAM goal from the dashboard, and get notified on every reported visit.",
    });
  }
  if (isLeader) {
    steps.push({
      icon: "🎯",
      title: role === "LCP" ? "You see the whole LC" : "You own the function",
      body:
        role === "LCP"
          ? "Every function, team and member rolls up to your dashboard. You can reassign anywhere and manage membership — operations stay with your VPs."
          : "Full authority inside your function: every account, reassignments, the function goal, the archive, and (for VPs) membership management.",
    });
  }

  steps.push({
    icon: "💙",
    title: "This system is built for YOU",
    body: "Anything broken? Any idea? The Feedback page in the sidebar goes straight to the IM team — every report makes Sodio better and more reliable for you.",
  });
  return steps;
}

/** One-time guided tour, keyed per member in this browser. */
export function Tour({
  email, role, functions, hasModule,
}: {
  email: string;
  role: string;
  functions: string[];
  hasModule: boolean;
}) {
  const storageKey = `crm-tour-v1:${email.toLowerCase()}`;
  // read once after hydration (server snapshot = false → no tour during SSR)
  const neverSeen = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return !localStorage.getItem(storageKey);
      } catch {
        return false;
      }
    },
    () => false
  );
  const [dismissed, setDismissed] = useState(false);
  const [i, setI] = useState(0);
  const open = neverSeen && !dismissed;

  const steps = buildSteps(role, functions, hasModule);
  const done = () => {
    try {
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch {}
    setDismissed(true);
  };

  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) done(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <div className="mx-auto mb-1 text-5xl">{step.icon}</div>
          <DialogTitle className="text-center">{step.title}</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            {step.body}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-1 flex items-center justify-center gap-1.5">
          {steps.map((_, d) => (
            <span
              key={d}
              className={cn(
                "h-1.5 rounded-full transition-all",
                d === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={done}>
            Skip
          </Button>
          <div className="flex gap-2">
            {i > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setI(i - 1)}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={() => (last ? done() : setI(i + 1))}>
              {last ? "Let's go 🚀" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
