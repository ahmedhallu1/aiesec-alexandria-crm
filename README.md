# Sodio — AIESEC in Alexandria ICX CRM

**Sodio** — a **100% free** CRM platform for AIESEC in Alexandria, built for the ICX functions
(**IGV** & **IGT**), starting with the **Raising** sub-process. The RBAC and
dashboard engine is the reusable blueprint for the upcoming OGV/OGT modules.

| | |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui |
| Hosting | Vercel (Free/Hobby tier), GitHub CI/CD |
| Database | Supabase (Free tier, Postgres) — source of truth |
| Sheets mirror | Google Sheets via a service account (one-way export + membership import) |
| Auth | Auth.js (NextAuth v5) — email + password (first login: any password, then the member sets their own) + optional Google sign-in (grants calendar access); allow-listed by the Membership sheet |
| Email | Gmail API, sent from the IM director's mailbox, AIESEC-branded HTML |
| Calendar | Google Calendar API — visit reminders 24h & 1h before, on the member's own calendar |
| Cron | Supabase `pg_cron` + `pg_net` hitting protected API routes |
| Theme | AIESEC Blue `#0A2540` / Cyan `#037EF3`, light & dark via device preference |
| Mobile | Installable PWA; `/.well-known/assetlinks.json` stub ready for a future Play Store TWA |

**Setup instructions live in [SETUP.md](./SETUP.md). The living, always-current
system documentation is [AI_CONTEXT.md](./AI_CONTEXT.md) — update it with every change.**

---

## 1. Architecture

```
Browser ──> Next.js (Vercel)
              ├─ Auth.js  Google OAuth (allow-listed via members table)
              ├─ Server Actions ──> RBAC check ──> Supabase (service role)
              ├─ Gmail API        (welcome, visit reports, follow-up prompts)
              ├─ Calendar API     (visit events on the member's calendar)
              └─ /api/cron/*  <── Supabase pg_cron (every 15–60 min)
                    ├─ visit-followups     (+2h "was it completed?" email)
                    ├─ membership-import   (Membership sheet → members table)
                    └─ sheets-export       (CRM → Google Sheets mirrors)
```

**Data flow rule:** the CRM (Supabase) is the source of truth for accounts,
contacts, visits and comments. Google Sheets holds read-only mirrors that are
regenerated hourly, **plus one two-way sheet**: *CRM — Membership* — imported
into the `members` table (it drives who can sign in and with which role), and
updated back whenever the EB edits membership inside the app or a member
confirms their info.

### Key directories

```
supabase/migrations/0001_init.sql   full schema, pipeline view, RLS, seeds
supabase/cron.sql                   pg_cron schedules (fill in URL + secret)
src/lib/rbac.ts                     THE RBAC engine (read before adding modules)
src/lib/auth.ts / auth.config.ts    Auth.js config (Node / edge split)
src/lib/google/{gmail,calendar,sheets}.ts
src/lib/email/templates.ts          branded HTML email layouts
src/server/data.ts                  scoped reads (everything goes through accountScope)
src/server/actions.ts               all mutations + business rules
src/app/(app)/...                   dashboard, accounts, blacklist, membership, feedback
src/app/api/cron/...                cron endpoints (protected by CRON_SECRET)
```

---

## 2. The RBAC engine (blueprint for future modules)

Roles come from the Membership sheet. Scope resolution lives in
[`src/lib/rbac.ts`](src/lib/rbac.ts) and is applied **server-side on every
read** (`accountScope`) **and every mutation** (`can*` predicates):

| Role | Scope |
|---|---|
| **LCP** | Absolute master access across all functions and roles. |
| **LCVP** | EB — master authority within their function(s). Can edit membership. |
| **Director** | Responsible for a function (e.g. B2C, BD) but **not EB** — function-level account authority, no EB powers (no membership editing). |
| **Team Leader** | Own accounts + accounts of members whose `Stakeholder` is the TL. Picks the Responsible between themself and their members. |
| **Coordinator** | Own accounts only (operational, no team management). |
| **Member** | Own accounts only. |
| **Admin** (`ADMIN_EMAILS`) | Treated as LCP — for the IM director. |

Members can hold **multiple functions** (multi-select in the sheet). IGV-only
members can't add IGT accounts and vice versa — both only for both-function
members, LCVPs and the LCP. Functions without a live module (OGV/OGT/B2C/BD/
F&L/CXP/Consideration-only) see a blurred "Soon" workspace.

Sub-function (`Raising`, `Consideration`, `ICX`, `OGX`) gates which modules a
user sees. Phase 1 ships Raising; `Consideration`-only users see a "coming
soon" workspace. **To add OGV/OGT later:** add the function value, create the
module's tables + a pipeline view, and reuse `accountScope`/`can*` unchanged.

---

## 3. Business rules implemented

1. **Cross-ICX uniqueness (hard block).** An account name can exist once across
   *all* ICX data. Adding a duplicate shows which function holds it, who is
   responsible, its stage and creation date. Enforced by a unique index on the
   normalized name (lowercase, trimmed, collapsed spaces) — race-proof.
2. **Archive (hard block).** Out-of-process accounts are hidden from normal
   views but stay archived — their names can never be added again (the archive
   IS the blacklist). Leaders (TL+) can open the Archive view and revive.
3. **Contact logging.** Every attempt = method (Call/WhatsApp/Email) + result +
   comment, logged from the Contact button.
4. **3-contact limit.** After the 3rd attempt with zero answered contacts, the
   member is prompted to mark the account Out of Process (with reason) or
   deliberately keep it. Flagged on dashboards either way.
5. **Next-step obligation.** After a first contact without a scheduled visit,
   saving requires a next step **with a date**. Accounts violating this appear
   as 🚨 flags on every dashboard level.
6. **Visit reminders.** Scheduling a visit creates a Google Calendar event on
   the responsible member's calendar with reminders **exactly 24h and 1h**
   before (popup + email).
7. **Visit follow-up.** 2 hours after the visit time, the member gets an email
   prompting them to report completed / not completed + comment + next steps.
8. **Manager notification.** The moment a visit is reported, a styled email
   with account, date, comment and next step goes to the **function VP and the
   member's stakeholder** (deduplicated).
9. **Reassignment.** TLs move accounts inside their team; VPs inside the
   function; LCP anywhere. Every change is written to `audit_log`.

---

## 4. Pipeline model

`Lead → Contacted → Visit Scheduled → Visit Done → Deal Done (Slot Raised)`,
with `Out of Process` as the exit lane. The stage is **derived** in the
`accounts_pipeline` SQL view — never stored — so it can't drift. Dashboards
aggregate the same view with drill-down: function → team (TL) → member, plus
conversion rates and goal progress (goals seeded: Slots 100 / Approvals 50 /
Completes 50 per function — edit in the `goals` table).

---

## 5. Free-tier limits to know

- **Vercel Hobby:** no sub-daily crons — that's why scheduling lives in
  Supabase `pg_cron` calling our endpoints.
- **Supabase free:** the project pauses after ~7 days without traffic; the
  cron jobs themselves keep it warm.
- **Gmail API:** ~500 external recipients/day for a normal Gmail-backed
  mailbox — plenty for visit reports; don't repurpose it for mass mailing.
- **Sheets API:** 300 reads/min — fine for hourly mirrors; don't point other
  automations at the CRM's service account.

## 6. Development

```bash
cp .env.example .env.local   # fill in (see SETUP.md)
npm install
npm run dev
```

Feedback lives in the sidebar → `/feedback`; every submission is emailed to
the IM director + IM coach, who alone see `/feedback/inbox`. Analytics: set
`NEXT_PUBLIC_GA_MEASUREMENT_ID` to enable GA4.

More v3 facts: mobile-first UI with card lists; role/function-aware first-run
tour; VPs/TLs set slots **goals** (function/team, per month or peak) shown with
progress + **leaderboards** (never IGV vs IGT); bulk **CSV/XLSX import** at
`/accounts/import` (same rules as manual adds); tagged multi phones/emails per
account; "Not Interested" auto-archives; manager defaults MM→VP→Director→LCP;
the LCP never receives operational report emails.
