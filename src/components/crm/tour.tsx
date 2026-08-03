"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

/** Which modules are LIVE for this viewer — mirrors the layout's rbac checks
 *  (hasRaisingAccess / hasTmAccess / hasOgxAccess / hasConsiderationAccess). */
export interface TourModules {
  raising: boolean;
  tm: boolean;
  ogx: boolean;
  consideration: boolean;
}

/** Builds the first-run walkthrough dynamically from the member's role,
 *  function(s) and LIVE modules — an MM sees their duties, a leader sees their
 *  powers, and nobody gets pitched a workspace they don't have. */
function buildSteps(role: string, functions: string[], subFunctions: string[], m: TourModules): TourStep[] {
  const isLeader = role === "LCVP" || role === "Director" || role === "LCP";
  const isTl = role === "Team Leader";
  const hasModule = m.raising || m.tm || m.ogx || m.consideration;

  // no live module → a short, honest welcome (never a workspace pitch)
  if (!hasModule) {
    return [
      {
        icon: "👋",
        title: "Welcome to Elevate",
        body: "Elevate is AIESEC in Alexandria's CRM. Your function's workspace isn't live yet — but your Profile, the Playbook and the Feedback page are already yours.",
      },
      {
        icon: "✨",
        title: "Your module is on the way",
        body: "Elevate currently covers ICX Raising (IGV · IGT · B2B & BD), B2C, OGX Sign-ups, Consideration and Talent Management. You'll get an email the moment your workspace opens. 💙",
      },
    ];
  }

  // Everyone with a module starts with WHAT THE SYSTEM IS — before any tab or
  // button makes sense, you need the one-paragraph version of what Elevate
  // does and why anything you type here matters.
  const steps: TourStep[] = [
    {
      icon: "\u{1F499}",
      title: "What Elevate is",
      body: "Elevate is AIESEC in Alexandria's own CRM \u2014 one place for the work the LC used to spread across a dozen Google Sheets. You log what you actually do; Elevate turns it into the pipeline, the numbers, the reminders and the reports your leaders read. Nothing here is busywork: every number on every dashboard is built from these entries.",
    },
    {
      icon: "\u{1F9ED}",
      title: "How it fits together",
      body: "You work in your function's tab in the sidebar. Everything you log rolls up automatically \u2014 into your Dashboard, your team's plan, the leaderboard and the period reports. The Playbook tab is the full manual, and The Blue Man (the walking figure, bottom right) answers questions about your own data in Arabic or English.",
    },
  ];
  // ONE primary workspace drives the tour (same priority as the home routing:
  // accounts → sign-ups → consideration → members); other live modules get a
  // short pointer step at the end.
  const primary = m.raising
    ? "raising"
    : m.ogx
      ? "ogx"
      : m.consideration
        ? "consideration"
        : "tm";

  if (primary === "raising") {
    const icx = functions.filter((f) => f === "IGV" || f === "IGT");
    // rbac matches B2B/BD/B2C in functions OR sub_functions — mirror it
    const all = [...functions, ...subFunctions];
    const isB2BCrew = all.some((f) => f === "B2B" || f === "BD");
    const isB2CCrew = all.includes("B2C");
    const fnLabel =
      icx.length > 0 ? icx.join(" & ") : isB2BCrew ? "B2B" : isB2CCrew ? "B2C" : "ICX";

    steps.push(
      {
        icon: "👋",
        title: `Your ${fnLabel} workspace`,
        body:
          ROLE_BLURBS[role] ??
          "Your accounts, contacts and visits live here — log everything and keep next steps set.",
      },
      {
        icon: "🏢",
        title: "Raising — your pipeline",
        body: `Every company you raise lives in the Raising tab. Each one moves through the same six stages: Lead → Contacted → Visit Scheduled → Visit Done → Deal Done, with Out of Process as the exit. You never set the stage by hand — it follows what you log.`,
      },
      {
        icon: "➕",
        title: "1. Adding an account",
        body: `Hit "Add account", pick the function and type the company name. Three checks run WHILE you type: is it already in the CRM (and whose is it), is it in the archive — the LC's blacklist of burned names — and is it already on the national Podio. If Podio has it, don't submit it again; if it doesn't, you still need to fill the Podio form. Then add contacts (phones, emails, links — each one tagged) and save.`,
      },
      {
        icon: "✏️",
        title: "2. Opening & editing it",
        body: `Click any row to open the account. The Details card holds everything you entered — every field stays editable, so fix a wrong number or add the CEO's email whenever you learn it. Comments are numbered and permanent: pin the important one and it shows as a ❗ on the list for everyone who can see the account.`,
      },
      {
        icon: "⚡",
        title: "3. The actions that matter",
        body: `The buttons at the top of an account are the whole job: Contact (log a call/WhatsApp/email), Schedule visit, Record deal, and Proposal email — which drafts a ready AIESEC proposal in YOUR Gmail to review and send. Tapping a phone or email anywhere in the list opens the channel AND the contact form, so nothing goes unlogged.`,
      },
      {
        icon: "📞",
        title: "The golden rule",
        body: "Log every attempt, and every account carries a next step with a date — or a scheduled visit. Nothing is allowed to float. 3 attempts with no answer → Elevate asks you to archive it. \"Not interested\" archives it on the spot.",
      },
      {
        icon: "🗓️",
        title: "Visits & reminders",
        body: "Schedule a visit and it lands on the responsible member's Google Calendar with reminders 24h and 1h before (sign in with Google once to enable that). Your TL and VP are invited, and the whole raising crew is notified. After the visit, report it — if you forget, Elevate chases you at +2h and again a week later.",
      },
      {
        icon: "🗄️",
        title: "The archive is shared",
        body: "Archiving is not deleting: an out-of-process account becomes part of the LC-wide blacklist, so nobody wastes a call on a name that's already burned. Everyone can open any archived account read-only to see who worked it and why it died — and Team Leaders and above can bring it back.",
      },
      {
        icon: "📊",
        title: "Dashboard, plan & leaderboard",
        body: isB2CCrew && icx.length === 0 && !isB2BCrew
          ? "The dashboard shows your B2C numbers — deals are the score — and the leaderboard puts your results next to your teammates'. Push it up. 🏆"
          : `The dashboard shows your ${fnLabel} numbers, the plan for the period, and the leaderboard — your results next to your teammates'. Push it up. 🏆`,
      }
    );

    if (isTl) {
      steps.push({
        icon: "👥",
        title: "You lead a team",
        body: "You see and manage your whole team's accounts, choose who's responsible for each one (you or a team member), file your team's plan (it IS the team goal), and get notified on every reported visit.",
      });
    }
    if (isLeader) {
      steps.push({
        icon: "🎯",
        title: role === "LCP" ? "You see the whole LC" : "You own the function",
        body:
          role === "LCP"
            ? "Every function, team and member rolls up to your dashboard. You can reassign anywhere and manage membership — operations stay with your VPs."
            : "Full authority inside your function: every account, reassignments, the archive, and (for VPs) membership management.",
      });
    }
  } else if (primary === "ogx") {
    const ogxFns = functions.filter((f) => f === "OGV" || f === "OGT");
    const fnLabel = ogxFns.length > 0 ? ogxFns.join(" & ") : "OGX";
    steps.push(
      {
        icon: "👋",
        title: `Your ${fnLabel} workspace`,
        body: "Sign-ups in the sidebar is your home: every sign-up from the tracker sheets lives here, two-way synced — the sheet imports every 15 minutes and your edits land back on it instantly.",
      },
      {
        icon: "🆕",
        title: "Claim from the pool",
        body: "Unassigned is the main view — contact a sign-up (WhatsApp and call buttons are right in the row) and hit Claim to make it yours.",
      },
      {
        icon: "📈",
        title: "Move it down the funnel",
        body: "Mark Contacted and Interested and log comments — every entry is stamped with your name and written back to the sheet. Approved is the finish line.",
      }
    );
    if (isTl) {
      steps.push({
        icon: "👥",
        title: "You lead a team",
        body: "The My team view shows your whole team's sign-ups — re-assign within the team and keep everyone claiming and contacting.",
      });
    }
    if (isLeader) {
      steps.push({
        icon: "🎯",
        title: role === "LCP" ? "You see the whole LC" : "You own the funnel",
        body:
          role === "LCP"
            ? "Every function, team and member rolls up to you — operations stay with your VPs."
            : "The All view and the VP-only fields are yours: VP comments, Country, Sub Product, Parents Approval and Out of Process — the Applied → Accepted → Approved stages (Approved = the MOS) belong to each sign-up's owner now.",
      });
    }
  } else if (primary === "consideration") {
    steps.push(
      {
        icon: "👋",
        title: "Your Consideration workspace",
        body: "IR calls with partner LCs live in Consideration in the sidebar — a shared, crew-wide log of every call.",
      },
      {
        icon: "📅",
        title: "Your booking link",
        body: "On the \"My booking link\" card set your weekly availability + slot length, then share your personal link with IRs abroad — their booking lands automatically as a scheduled call, on your Google Calendar, with a bell + email to you.",
      },
      {
        icon: "📝",
        title: "Notes complete the call",
        body: "During (or after) a call, open its notes dialog — the partner's demand, their B2C campaigns, free notes and a screenshot. Saving the notes completes the call.",
      }
    );
  } else {
    // TM — the members directory
    steps.push(
      {
        icon: "👋",
        title: "Your Talent Management workspace",
        body: "Members in the sidebar is the whole LC's directory — every member's info, team, manager and numbers in one place.",
      },
      {
        icon: "📇",
        title: "The directory works for you",
        body: "Per-member KPIs and MOS, plus one-tap email / call / WhatsApp shortcuts — reach anyone in seconds.",
      }
    );
  }

  // other LIVE modules beyond the primary → one short pointer each
  if (m.ogx && primary !== "ogx") {
    steps.push({
      icon: "🧭",
      title: "Also yours: Sign-ups",
      body: "The Sign-ups tab holds the OGX pool — claim, contact, and move sign-ups down the funnel to Approved.",
    });
  }
  if (m.consideration && primary !== "consideration") {
    steps.push({
      icon: "🧭",
      title: "Also yours: Consideration",
      body: "IR calls with partner LCs + your personal booking link live in the Consideration tab.",
    });
  }
  if (m.tm && primary !== "tm") {
    steps.push({
      icon: "🧭",
      title: "Also yours: Members",
      body: "The Members tab is the whole LC's directory — info, KPIs and contact shortcuts for everyone.",
    });
  }

  steps.push({
    icon: "💙",
    title: "This system is built for YOU",
    body: "Anything broken? Any idea? The Feedback card on your Profile goes straight to the IM team — every report makes Elevate better and more reliable for you.",
  });
  return steps;
}

/** One-time guided tour, keyed per member in this browser. */
export function Tour({
  email, role, functions, modules, subFunctions = [],}: {
  email: string;
  role: string;
  functions: string[];
  modules: TourModules;
  subFunctions?: string[];
}) {
  const storageKey = `crm-tour-v2:${email.toLowerCase()}`;
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
  const [replay, setReplay] = useState(false);
  const [i, setI] = useState(0);
  const open = (neverSeen && !dismissed) || replay;

  // "Replay the walkthrough" (Playbook) — before v32 a dismissed tour was gone
  // for good in that browser, which is a poor deal for the one thing that
  // explains the system.
  useEffect(() => {
    const onReplay = () => { setI(0); setDismissed(false); setReplay(true); };
    window.addEventListener("sodio:replay-tour", onReplay);
    return () => window.removeEventListener("sodio:replay-tour", onReplay);
  }, []);

  const steps = buildSteps(role, functions, subFunctions, modules);
  const done = () => {
    try {
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch {}
    setDismissed(true);
    setReplay(false);
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
        {/* no Skip (v29): the tour IS the manual — it gets read once */}
        <div className="mt-2 flex items-center justify-end gap-2">
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
