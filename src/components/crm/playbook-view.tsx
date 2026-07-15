"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** ⚠️ Bump with EVERY release (same commit as the feature) — the playbook is
 *  handed to the next generations and must always describe the live system. */
export const PLAYBOOK_VERSION = "v14";

interface Props {
  role: string;
  isAdmin: boolean;
  isB2B: boolean;
  isTm: boolean;
}

interface Section {
  id: string;
  emoji: string;
  title: string;
  audience: string;
  color: string; // accent (AIESEC blue / product colors)
  points: React.ReactNode[];
}

/** Which section ids matter most for a role — powers the "That's you" badges. */
function sectionsForRole(
  role: string, isAdmin: boolean, isB2B: boolean, isTm: boolean
): Set<string> {
  const mine = new Set(["what", "start", "rules"]);
  if (role === "Member" || role === "Coordinator") mine.add("raising");
  if (role === "Team Leader") { mine.add("raising"); mine.add("leaders"); mine.add("data"); }
  if (role === "LCVP" || role === "Director" || role === "LCP") { mine.add("eb"); mine.add("data"); }
  if (isB2B) mine.add("b2b");
  if (isTm) mine.add("tm");
  if (isAdmin) { mine.add("im"); mine.add("data"); }
  return mine;
}

const SECTIONS: Section[] = [
  {
    id: "what",
    emoji: "💙",
    title: "What is Sodio?",
    audience: "Everyone",
    color: "#037EF3",
    points: [
      <>A <b>100% free CRM</b> built by AIESEC in Alexandria&apos;s IM team for the ICX <b>Raising</b> process — IGV, IGT and B2B.</>,
      <>Everything lives here: <b>accounts → contacts → visits → deals</b>, plus goals, leaderboards and dashboards.</>,
      <>It automates the boring parts: calendar reminders, follow-up emails, Google Sheets mirrors, notifications.</>,
      <>The one rule everything else builds on: <b>if it&apos;s not in Sodio, it didn&apos;t happen.</b></>,
    ],
  },
  {
    id: "start",
    emoji: "🚀",
    title: "Getting started",
    audience: "Everyone",
    color: "#0CB9C1",
    points: [
      <>First sign-in is <b>Google only</b> (it grants your calendar reminders + Gmail drafts). Onboarding then sets your password.</>,
      <>After that, sign in with <b>email or phone + password</b>, or Google — whatever you like.</>,
      <>Forgot the password? The login page emails you a fresh one instantly. Your old one keeps working until you change it.</>,
      <>Meet <b>The Blue Man</b> 🚶 (bottom-right) — he answers questions using your real CRM data and AIESEC sources.</>,
      <>The first-run <b>tour</b> walks you through your workspace. Rewatch it any time from your Profile.</>,
    ],
  },
  {
    id: "raising",
    emoji: "📇",
    title: "The raising cycle",
    audience: "Members & Coordinators",
    color: "#F85A40",
    points: [
      <><b>Add the account first</b> — duplicates and archived (blacklisted) names are blocked with full context. Bulk import exists for whole research sheets.</>,
      <><b>Log every contact attempt</b> with its result. Picking <b>&quot;Visit Scheduled&quot;</b> books the visit — calendar invite and reminders included.</>,
      <>Every in-process account carries a <b>next step with a date</b> or a pending visit. Three no-responses → the CRM suggests archiving.</>,
      <>The <b>Proposal email</b> button builds a branded, AIESEC-blue outreach draft in <b>your own Gmail</b> — review, attach, send.</>,
      <>Two hours after a visit, you (and your TL) get the <b>report-it email</b> — report from it, the top button, or by clicking the pending visit in History. Ignore it a week and the reminder comes back firmer — report it or archive the account.</>,
      <>The <b>Calendar</b> page (sidebar) shows your whole function&apos;s visits, one color per member — see the rhythm, plan around it.</>,
      <>Deal signed → <b>Record deal</b> 🏆: opens per product, optional <b>contract upload</b> (any file format — add later from History; the account grows a <b>Contracts</b> button to preview & download them).</>,
      <>&quot;Not interested&quot; is a valid result: mark the account <b>Out of Process</b> with its reason. The archive IS the blacklist — those names never come back.</>,
    ],
  },
  {
    id: "leaders",
    emoji: "👥",
    title: "Leading a team",
    audience: "Team Leaders",
    color: "#F48924",
    points: [
      <>You see and work <b>your whole team&apos;s accounts</b>, pick the Responsible on each, and can revive archived accounts.</>,
      <><b>Set the team goal</b> every period. When a period ends, Sodio emails you the goal-vs-achieved recap with a button to set the next one — your team is notified automatically once you do.</>,
      <>You&apos;re on your members&apos; <b>visit follow-up emails</b> (and the week-later &quot;forgotten&quot; nags). A nag means an account is frozen — unfreeze it together.</>,
      <>Leaderboards rank <b>Members & Coordinators</b> on their own accounts; deals always belong to the account&apos;s Responsible.</>,
      <>Use the dashboard&apos;s team filter (and <b>My numbers</b> for your own raising) to steer the week.</>,
    ],
  },
  {
    id: "eb",
    emoji: "🧭",
    title: "Steering a function",
    audience: "VPs & Directors",
    color: "#037EF3",
    points: [
      <>Dashboards run per lane: <b>IGV / IGTa / IGTe</b> (All-IGT shows IGTa + IGTe combined — its goal is derived, never set directly).</>,
      <><b>Set the lane goal</b> each period. Period over → you get the recap email with the set-new-goal button; everyone in the lane hears about the new goal automatically.</>,
      <>The <b>Membership sheet</b> is the source of truth for people — edit in the app or in the sheet, both stay in sync (30-min imports + instant write-back).</>,
      <>Visit reports and function-wide visit announcements reach you automatically. The LCP never receives operational email.</>,
      <>Archive powers: remove wrong entries, import pre-CRM blacklists (Archived tab).</>,
    ],
  },
  {
    id: "b2b",
    emoji: "🤝",
    title: "B2B & BD — raising for the whole ICX",
    audience: "B2B & BD crew",
    color: "#0CB9C1",
    points: [
      <>One function, two names (<b>B2B & BD</b> — may split in future peaks): either grants the same whole-ICX raising access.</>,
      <>When adding an account you <b>choose its label: B2B or BD</b>. Both split every deal&apos;s opens across <b>IGV / IGTa / IGTe</b> — each lane&apos;s dashboard picks up its share.</>,
      <>You see and feed <b>every lane</b>; IGV/IGT VPs & Directors see all your data too and can filter their dashboard by the <b>B2B lane</b>.</>,
      <><b>Podio worklist</b> (MMs & Director/VP): the &quot;Podio pending&quot; filter lists accounts not yet requested — copy names for the form, set the request state inline, or <b>Ask to submit</b>: the owner gets an in-app notification and the account pins to the top of their list until they act.</>,
      <><b>BD deals are measured in MONEY</b>: recording a deal on a BD account asks for the <b>amount (EGP)</b> + other benefits — opens are optional extras. The account header and Drive sheet show the EGP totals.</>,
      <>Proposal emails: B2B accounts get the <b>all-programs variant</b> (aiesec.org/partners); <b>BD accounts get the Talent-Solutions pitch</b> (aiesec.org.eg/partner.html) with no ready-made attachments.</>,
    ],
  },
  {
    id: "tm",
    emoji: "🧠",
    title: "Talent Management",
    audience: "TM crew",
    color: "#8E44AD",
    points: [
      <>The <b>Members</b> page (sidebar) is your module: the whole LC in one view — role, functions, team, manager, and every member&apos;s <b>MOS/KPIs</b> (MR · Contacted · Visits · Done · Deals · Opens).</>,
      <>Search and filter by function or role; reach anyone instantly with the <b>email / call / WhatsApp</b> buttons.</>,
      <>More TM tools are on the roadmap — this is v1.</>,
    ],
  },
  {
    id: "data",
    emoji: "📊",
    title: "Where the data lives",
    audience: "Leaders & IM",
    color: "#F48924",
    points: [
      <>Google Drive mirrors (hourly): <b>CRM — Raising Accounts</b> = ALL accounts in one sheet — filter by the <b>Function / Product / Archived?</b> flag columns; <b>CRM — Archived Accounts</b> = the blacklist view; plus Contact Log and Visits.</>,
      <><b>CRM — Membership</b> is the only two-way sheet (with its <b>Teams</b> tab naming EB/LB/Function/MM teams). Everything else is a read-only mirror — <b>the CRM is the truth</b>.</>,
      <>Automatic emails: welcome, passwords, visit invites/reports/follow-ups/nags, goal reminders & announcements, broadcasts. All AIESEC-branded.</>,
      <>In-app 🔔 notifications mirror the important ones and open the related page on click.</>,
    ],
  },
  {
    id: "im",
    emoji: "🛠️",
    title: "IM & maintenance",
    audience: "IM team / Admin",
    color: "#F85A40",
    points: [
      <><b>Ship rule:</b> every change goes <b>commit → merge to main → push to GitHub → <code>vercel deploy --prod</code></b>. Never leave finished work on a side branch.</>,
      <><b>Test view</b>: from your Profile, view & use the whole app as ANY member (banner at the bottom exits). Actions taken in a test view are real — look, don&apos;t touch.</>,
      <>DB migrations run <b>manually, in order</b> in the Supabase SQL editor (<code>supabase/migrations/0001 → 0012</code>). Cron schedules live in <code>supabase/cron.sql</code>.</>,
      <><code>AI_CONTEXT.md</code> in the repo is the technical single source of truth — update it (and <b>this playbook + its version</b>) in the same commit as any change.</>,
      <>Secrets live in <code>.env.local</code> + Vercel env — never in the repo. The feedback inbox is restricted to the IM director + coach.</>,
      <>Google side: a service account syncs the Drive sheets; Gmail sends from the IM mailbox; each member&apos;s own Google grant powers their calendar + drafts.</>,
    ],
  },
  {
    id: "rules",
    emoji: "📜",
    title: "The golden rules",
    audience: "Everyone",
    color: "#037EF3",
    points: [
      <><b>1.</b> If it&apos;s not in Sodio, it didn&apos;t happen.</>,
      <><b>2.</b> Every in-process account has a next step with a date — always.</>,
      <><b>3.</b> Log the result the same day you get it.</>,
      <><b>4.</b> &quot;Not interested&quot; is a result. Archive it — don&apos;t hoard dead accounts.</>,
      <><b>5.</b> The archive is sacred: archived names are never re-added.</>,
      <><b>6.</b> Deals belong to the account&apos;s Responsible — record every deal, upload the contract.</>,
      <><b>7.</b> When the report email arrives, report the visit. Don&apos;t wait for the nag.</>,
      <><b>8.</b> Track yourself: hit <b>My numbers</b> on the dashboard and own your KPIs.</>,
    ],
  },
];

export function PlaybookView({ role, isAdmin, isB2B, isTm }: Props) {
  const mine = sectionsForRole(role, isAdmin, isB2B, isTm);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Hero */}
      <div className="rise-in overflow-hidden rounded-2xl border bg-gradient-to-br from-[#037EF3] via-[#0a5fd0] to-[#0A2540] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            The Sodio Playbook
          </h1>
          <Badge className="border-white/30 bg-white/15 text-white">{PLAYBOOK_VERSION}</Badge>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
          Everything you need to work with Sodio — organized by role, so you
          only read what&apos;s yours. This playbook lives with the system, is
          updated with <b>every release</b>, and is written to be handed to the
          next generations of AIESEC in Alexandria. 💙
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-white/60">
          Sections marked “That&apos;s you” are the ones to read first.
        </p>
      </div>

      {/* Index */}
      <nav className="rise-in rise-in-1 flex flex-wrap gap-1.5" aria-label="Playbook index">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted",
              mine.has(s.id) && "border-transparent text-white"
            )}
            style={mine.has(s.id) ? { backgroundColor: s.color } : undefined}
          >
            <span>{s.emoji}</span> {s.title}
          </a>
        ))}
      </nav>

      {/* Sections */}
      {SECTIONS.map((s, i) => (
        <Card
          key={s.id}
          id={s.id}
          className={cn("rise-in scroll-mt-20 border-l-4", i < 3 && `rise-in-${i + 1}`)}
          style={{ borderLeftColor: s.color }}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              <span className="text-xl">{s.emoji}</span> {s.title}
              <Badge
                variant="outline"
                className="ml-auto font-semibold"
                style={{ color: s.color, borderColor: s.color }}
              >
                For: {s.audience}
              </Badge>
              {mine.has(s.id) ? (
                <Badge className="border-transparent text-white" style={{ backgroundColor: s.color }}>
                  That&apos;s you
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-relaxed">
              {s.points.map((p, j) => (
                <li key={j} className="flex gap-2.5">
                  <span
                    className="mt-[7px] size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Sodio Playbook · {PLAYBOOK_VERSION} — updated with every release.
        Something unclear? Say it on the <b>Feedback</b> page — it reaches the IM team directly. 💙
      </p>
    </div>
  );
}
