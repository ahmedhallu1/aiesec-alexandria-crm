"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { GuidedTour, type TourStep } from "./guided-tour";

/** Which modules are LIVE for this viewer — mirrors the layout's rbac checks
 *  (hasRaisingAccess / hasTmAccess / hasOgxAccess / hasConsiderationAccess). */
export interface TourModules {
  raising: boolean;
  tm: boolean;
  ogx: boolean;
  consideration: boolean;
  /** the calendar belongs to every module member (touch points, v29) */
  calendar: boolean;
}

/**
 * The first-run walkthrough.
 *
 * v32.3 replaced a deck of slides with a WALK THROUGH THE SYSTEM: each step
 * points at a real control on a real page and says one short line about it.
 * Nobody reads five paragraphs about a form they cannot see — so we open the
 * form and point at the field.
 *
 * Keep every `body` to one or two plain sentences. If a step needs a
 * paragraph, it belongs in the Playbook, not here.
 */
function buildSteps(role: string, m: TourModules, fns: string[]): TourStep[] {
  const steps: TourStep[] = [];
  const isLeader = role === "LCVP" || role === "Director" || role === "LCP";
  // who TAKES attendance rather than receiving it: MMs and up, and all of TM
  const records =
    isLeader || role === "Team Leader" || role === "Coordinator" || m.tm;
  // the WORLD decides the wording (v33.29): B2C deals are contract-first (no
  // opens, no proposals), BD's MOS is money — telling a B2C member about
  // opens splits was the old blurb's bug
  const isB2c = fns.includes("B2C");
  const isBd = !isB2c && fns.includes("BD") && !fns.some((f) => f === "IGV" || f === "IGT");
  // the Emails tab is MMs and above (canUseMailboxTab)
  const mailbox = isLeader || role === "Team Leader" || role === "Coordinator";

  if (m.raising) {
    steps.push(
      {
        route: "/accounts",
        openBy: '[data-tour="nav:open"]',
        target: "nav:/accounts",
        title: "This is Raising",
        body: "Every company you work lives here. It's the tab you'll spend your time in.",
      },
      {
        route: "/accounts",
        target: "accounts:add",
        title: "Add an account",
        body: "One company at a time. Let's open it and see what it asks for.",
      },
      {
        route: "/accounts",
        openBy: '[data-tour="accounts:add"]',
        target: "add:name",
        title: "The company name",
        body: "Type it and three checks run instantly: is it already in the CRM, is it in the archive, and is it already on Podio.",
      },
      {
        route: "/accounts",
        target: "add:contacts",
        title: "How to reach them",
        body: "Phones, emails and links — each one tagged, so the WhatsApp button knows which number to use.",
        closeBy: '[data-slot="dialog-close"]',
      },
      {
        route: "/accounts",
        target: "accounts:search",
        title: "Finding an account",
        body: "Search by name here. To narrow a column — Status, Product, Responsible — use the small funnel next to its title.",
      },
      {
        route: "/accounts",
        target: "accounts:table",
        title: "Open one to work it",
        desktopOnly: true,
        body: isB2c
          ? "Click any row. Inside you log contacts, book visits from the contact log, and record deals — B2C deals are contract-first, no opens."
          : isBd
            ? "Click any row. Inside you log contacts, book visits from the contact log, and record deals — a BD deal records MONEY (EGP), your MOS."
            : "Click any row. Inside you log contacts, book visits from the contact log ('Visit Scheduled' is a contact result), record deals and send the proposal email.",
      },
      {
        route: "/accounts",
        target: "accounts:direct",
        title: "Walked in off the street?",
        body: "Direct visit logs a walk-in in one form — the research, the contact and the visit together — so it counts instead of going unlogged.",
      }
    );
    if (!isLeader) {
      steps.push({
        route: "/dashboard",
        openBy: '[data-tour="nav:open"]',
        target: "nav:/dashboard",
        title: "Your numbers",
        body: "Everything you log adds up here — your funnel, your plan and the leaderboard.",
      });
    }
  }

  if (m.ogx) {
    steps.push(
      {
        route: "/signups",
        openBy: '[data-tour="nav:open"]',
        target: "nav:/signups",
        title: "This is Sign-ups",
        body: "Every EP from the tracker sheets. Contact one and claim it — it becomes yours.",
      },
      {
        route: "/signups",
        target: "signups:views",
        title: "Unassigned is the pool",
        body: "Unassigned is everyone's; Mine is what you claimed. Leaders also get All and Archived.",
      },
      {
        route: "/signups",
        target: "signups:table",
        title: "Work the pool",
        desktopOnly: true,
        body: "WhatsApp and call buttons sit right in the row, and what you log writes back to the sheet.",
      },
      {
        route: "/signups",
        target: "signups:streak",
        title: "Your streak",
        body: "Contact at least one sign-up a day to keep the flame. Undo the contact and the day is gone — it only counts real work.",
      }
    );
  }

  if (m.consideration) {
    steps.push({
      route: "/consideration",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/consideration",
      title: "This is Consideration",
      body: "IR calls with partner LCs, plus your personal booking link for IRs abroad.",
    });
  }

  if (m.tm) {
    steps.push({
      route: "/members",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/members",
      title: "This is Talent Management",
      body: "The whole LC's directory — everyone's team, manager and numbers, with contact shortcuts.",
    });
  }

  // B2C sells into the OGX sign-up pool (v33.29) — their own door into /signups
  if (isB2c && !m.ogx) {
    steps.push({
      route: "/signups",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/signups",
      title: "B2C calls the sign-up pool",
      body: "The CIC view holds people who already answered an OGX call — your leaders hand them to you, and you pitch courses and events. The OGX funnel is never touched.",
    });
  }

  // the Emails tab (v33.24) — MMs and above write to partners from Sodio
  if (mailbox) {
    steps.push({
      route: "/emails",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/emails",
      title: "The Emails tab",
      body: "Professional letters from YOUR own Gmail — layouts, your real signature, the Violet Man to draft, and every send remembered.",
    });
  }

  // Everyone gets the LC-wide tabs too — they are not anybody's "module", and
  // leaving them out is why the walkthrough felt like it stopped halfway.
  if (m.calendar) {
    steps.push({
      route: "/calendar",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/calendar",
      title: "The calendar",
      body: "Your team's meetings, visits and IR calls on one month view. Click a day to see it or to book on it.",
    });
  }
  steps.push(
    {
      route: "/attendance",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/attendance",
      title: "Attendance",
      // whoever RECORDS attendance is told what they owe, not how to appeal
      // it — a TM Coordinator being taught to appeal their own marks is the
      // system talking to the wrong person (v33.5)
      body: records
        ? "Meetings, working hours and outings are recorded here. Fill yours in — until you do, it keeps reminding you, and appeals come to you."
        : "Meetings, working hours and outings are recorded here. If a mark looks wrong, Appeal it — the person who recorded it gets told.",
    },
    {
      route: "/lc-feedback",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/lc-feedback",
      title: "Feedback about people",
      body: "A 🎉 shout-out reaches the person; a 😟 concern goes only to the LCP, privately. Anonymous is allowed.",
    },
    {
      route: "/profile",
      openBy: '[data-tour="nav:open"]',
      target: "nav:/profile",
      title: "Your profile",
      body: "Your info, your plan, your avatar — and the form for reporting anything broken in Sodio itself.",
    },
    {
      openBy: '[data-tour="nav:open"]',
      target: "nav:/help",
      title: "Help has the rest",
      body: "Search anything — how-tos, FAQs, the fine print — or ask The Violet Man from there. You can replay this walkthrough from Help any time.",
    }
  );

  return steps;
}

/** One-time guided walkthrough, keyed per member in this browser. */
export function Tour({
  email, role, modules, functions, subFunctions,
}: {
  email: string;
  role: string;
  functions?: string[];
  subFunctions?: string[];
  modules: TourModules;
}) {
  // v4 (v33.29): the walkthrough was rebuilt — world-aware wording, the
  // direct-visit and Emails steps, mobile no longer stalls on table targets —
  // so everyone sees it once more
  const storageKey = `crm-tour-v4:${email.toLowerCase()}`;
  const neverSeen = useSyncExternalStore(
    () => () => {},
    () => {
      try { return !localStorage.getItem(storageKey); } catch { return false; }
    },
    () => false
  );
  const [dismissed, setDismissed] = useState(false);
  const [replay, setReplay] = useState(false);

  // "Replay the walkthrough" (Playbook) — a dismissed tour must never be gone
  // for good in that browser
  useEffect(() => {
    const onReplay = () => { setDismissed(false); setReplay(true); };
    window.addEventListener("sodio:replay-tour", onReplay);
    return () => window.removeEventListener("sodio:replay-tour", onReplay);
  }, []);

  const steps = buildSteps(role, modules, [
    ...(functions ?? []),
    ...(subFunctions ?? []),
  ]);
  const open = ((neverSeen && !dismissed) || replay) && steps.length > 0;

  const done = () => {
    try { localStorage.setItem(storageKey, new Date().toISOString()); } catch {}
    setDismissed(true);
    setReplay(false);
  };

  return <GuidedTour steps={steps} open={open} onClose={done} />;
}
