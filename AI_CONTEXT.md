# AI_CONTEXT.md — Single Source of Truth (Sodio — AIESEC in Alexandria ICX CRM)

> **⚠️ LIVING DOCUMENT.** Update this file **in the same commit** as any change
> to the system (feature, rule, route, schema, env var, deployment fact).
> Add a dated entry to the **Changelog** at the bottom. No secrets in this file.

Last updated: 2026-07-11 · Version: v8

---

## 1. What this is

**Sodio** — a **100% free** CRM for AIESEC in Alexandria's ICX functions
(**IGV** & **IGT**), covering the **Raising** process. The brand name is
**Sodio** (shown in the sidebar, tab titles, manifest, emails); the built-in
AI assistant is **The Blue Man**. Members log accounts, contacts, visits and
deals; leaders steer with goals, leaderboards and dashboards. The RBAC engine is
the blueprint for future OGX/other-function modules.

| | |
|---|---|
| Live URL | https://aiesec-alexandria-crm.vercel.app |
| Repo | github.com/ahmedhallu1/aiesec-alexandria-crm (private) |
| Vercel project | `aiesec-alexandria-crm` (scope `ahmedhallu1s-projects`) — deploy with `vercel deploy --prod` |
| Stack | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, project `iesrpuuoduxtihuaqfic`) |
| Auth | Auth.js v5: **FIRST sign-in is Google-only** (grants `calendar` + `gmail.compose`) → onboarding sets a password → afterwards email+password OR Google both work. Password reset = IM clears the hash → member signs in with Google again |
| Google | Service account (Sheets sync) · Gmail API from `ahmedhallul@aiesec.net` · Calendar events on each member's own calendar |
| Cron | Supabase `pg_cron` + `pg_net` → `/api/cron/*` (visit-followups 15 min · membership-import 30 min · sheets-export hourly) |
| Admin | `ADMIN_EMAILS` env (= IM director, treated as LCP) |

**Migrations** live in `supabase/migrations/` and are run **manually** in the
Supabase SQL editor (no CLI on this machine): `0001_init` → `0002_membership_v2`
→ `0003_ops_v2` → `0004_pins_v2` → `0005_deals` → `0006_admin_label` → `0007_visit_scheduled_result` → `0008_notifications_feedback`.

---

## 2. Membership & RBAC

Source of truth = the **"CRM — Membership"** Google Sheet (two-way):
imported every 30 min AND written back by in-app edits (EB membership editor,
member profile/onboarding confirmations). Columns A→J:
`Name · Nickname · Email · Phone · Role · Function (multi) · Sub Function (multi) · Stakeholder (by NAME) · Team Name · Active`.

- **Function/sub-function values are FREE-FORM**: known values are normalized,
  unknown ones (e.g. `TM`) are imported as-is and appear as chips in the editor.
- **Manager defaults** (UI word for Stakeholder): MM (TL/Coordinator/Member) →
  their function's **VP** → else the function's **Director** → else **LCP**;
  VP/Director → LCP. Applied on import + in-app edits when no manager is named.

| Role | Powers |
|---|---|
| LCP | Sees everything; **never receives operational emails**; excluded from member filters (doesn't do market research) |
| LCVP (EB) | Function authority (accounts, goals, archive) + membership editing |
| Director | Function authority like a VP but **NOT EB** — no membership editing |
| Team Leader | Team accounts, picks Responsible (self/member), sets the team goal |
| Coordinator / Member | Own accounts only |

**B2B** (function or sub-function contains "B2B") raises **for the whole ICX**:
they get BOTH IGV & IGT lanes (create/see/filter accounts in either product,
usually bulk deals of 3+ opens). Detected by `isB2B` in `rbac.ts`; feeds
`icxFunctions`, `hasRaisingAccess`, `allowedAccountFunctions`.

**OGX ↔ ICX isolation**: neither side sees the other's operations. IGV-only
members can't create IGT accounts and vice versa (both = dual-function, LCVP, LCP).
Functions without modules see a blurred "Soon" workspace (profile+feedback still work).

Engine: `src/lib/rbac.ts` — every read goes through `accountScope`, every
mutation through a `can*` predicate, **server-side**.

---

## 3. Accounts & pipeline

- Stage is **derived** in the `accounts_pipeline` view: Lead → Contacted →
  Visit Scheduled → Visit Done → Deal Done, exit lane Out of Process.
- **Deals are MANY-per-account** (`deals` table + running `deals_count`/
  `slots_count` totals): 3 slots today + 6 next month = 2 deals · 9 slots.
  `recordDeal` appends; the account stays workable after a deal (more deals,
  more contacts, more visits). Deal history shows in the account timeline.
- **IGV accounts always carry a Project** (Skill Up!, Rooted, …) — required at
  creation/import, shown on the accounts list next to the IGV badge, editable
  in Details, filterable.
- **Unique name across ALL ICX** (normalized); duplicates/archived names are
  blocked at creation with full context (who, stage, why archived).
- **The archive IS the blacklist**: OOP accounts are hidden, unre-addable,
  revivable by TL+. No blacklist tab/sheet.
- **Auto-archive rules**: contact result **"Not Interested"** and Podio request
  state **"Rejected"** both archive the account (with warning confirmations).
- **Tagged contacts** (`accounts.contacts` jsonb): phones with tags
  `[Contact, Whatsapp, Manager, HR, CEO, Owner, Other]`, emails with the same
  list **minus Whatsapp**, links with `[Website, LinkedIn, Instagram, Facebook,
  Other]`. First-of-kind is synced to the legacy flat columns for the mirrors.
  Quick actions use brand glyphs (real WhatsApp logo, LinkedIn, Instagram,
  Facebook — `src/components/crm/icons.tsx`).
- **Phone rule** (`normalizePhone` in `src/lib/types.ts`): Egyptian mobile →
  canonical `+201[0/1/2/5]XXXXXXXX`; landline → `+203XXXXXXX` (Alexandria) /
  `+202…` (Cairo); anything else must be full international `+<7–15 digits>`.
- **Comments**: unlimited, auto-numbered per author class (`Comment #n`,
  `TL/VP/LCP/Admin Comment #n` — the IM director's label is **Admin**, not LCP).
  Any comment can be **pinned** → highlighted in the card AND shown as a ❗
  (CircleAlert) on the accounts list; hover reveals the text.
- **ICX Proposal Email** (`src/lib/email/proposal.ts` + `createProposalDraft`):
  the "Proposal email" button on every account opens a popup (recipient,
  sector, custom note, attachments note — product auto-detected iGV/iGTa/iGTe,
  company prefilled). It creates a ready-to-send DRAFT **in the member's own
  Gmail** via their `gmail.compose` grant; the UI reminds them to review,
  attach files and hit send (email goes out from THEIR address). An
  **"Attach the official proposal"** switch adds the per-product PDF from
  `proposals/<iGV|iGTa|iGTe>.pdf` (bundled via `outputFileTracingIncludes`;
  missing file → clear error). Sets `proposal_sent` on the account. Members
  who signed in before the scope change must re-login with Google once.
- **Contact log results**: No Response / Responded / Interested / Not Interested
  (archives) / Wrong Contact / **Visit Scheduled** (requires date+time and
  BOOKS the visit through the exact same path as the Schedule-visit button —
  calendar reminders included; 'Call Scheduled' is a legacy value kept for old
  rows only). Golden rule: every in-process account carries a next step with a
  date or a pending visit; 3 unanswered attempts → OOP prompt.
- **Visits**: calendar event on the responsible's Google Calendar (24h + 1h
  reminders), +2h follow-up email, report emails to VP + manager (never LCP).
- **Bulk import** (`/accounts/import`): CSV/XLSX parsed client-side (sheetjs),
  editable preview, owner select per reassign rules, ≤500 rows, every row passes
  the exact same checks as a manual add.
- **Accounts list columns**: Date added (filterable range, clamped to today) ·
  Account (+📌, responsible under the name for leaders) · Product badge ·
  Status · Contacts count · Next step · **Quick actions** (WhatsApp = number
  tagged `Whatsapp` else first phone; Call = first non-Whatsapp phone; Email =
  first email; one icon per link; overflow collapses into a "…" menu).

---

## 4. URLs, titles & security

- Accounts are addressed by **slug**: `/accounts/hadana` (slug = unique
  normalized name, spaces→dashes; UUID links still resolve). Browser-tab titles
  are dynamic (= account name / page name).
- `generateMetadata` re-checks authorization before exposing a name; guessing a
  URL outside your scope → 404, never data. All reads/mutations re-check RBAC
  server-side (`getAccount` → `canViewAccount`; every action → `can*`).
- Route protection: `src/proxy.ts` (Auth.js) — everything requires a session
  except `/login`, auth/cron APIs, static assets, `/brand`, PWA files.
  ⚠️ Any new public asset folder must be added to the matcher or the proxy
  307s it to /login.
- `/api/cron/*` guarded by `CRON_SECRET`. Feedback inbox = ONLY
  `ahmedhallul@aiesec.net` + `omareldeeb123@aiesec.net`.

---

## 5. Dashboard

**Teams are real Team Leaders only** — the EB (IRIS) is never a "team": VP/
admin-owned accounts don't create an EB row in team drills/leaderboards, and
the team goal/leaderboard cards only appear when the viewer's manager is an
actual Team Leader.

**Goals live per product lane** — set on IGV / IGTa / IGTe; the IGT goal is
DERIVED: `goal(IGT) = goal(IGTa) + goal(IGTe)` (the All-IGT lane shows the sum
and has no Set button). Filter bar sits on a single h-9 baseline (the date
range is one inline "Added → →" group) and KPI cards have equal-height labels
so the numbers align.

**KPI row (this exact order, nothing else):** Market Research (total accounts) ·
Contacted · Visits (scheduled) · Visits done · Deals (count of deals, not
accounts) · Slots raised · Lead → Deal (% of accounts reaching a deal).
Directly below: the step-to-step **conversion strip** — MR→Contacted,
Contacted→Visits, Visits→Done, Done→Deals. (The old funnel bars and flag KPI
cards were removed on request; flags remain reachable via accounts filters.)

- Lanes gated by the member's functions: `All ICX / IGV / All IGT / IGTa / IGTe`
  (product colors: GV `#F85A40`, GTa `#0CB9C1`, GTe `#F48924`).
- **Everyone in a module sees their whole function's aggregates** (accounts list
  stays scoped); member filter shows only lane members (never the LCP).
- **Goals** (`performance_goals`): VP/Director sets the function goal, TL the
  team goal (month or peak period) — progress bars on everyone's dashboard.
- **Leaderboards**: function + team, medals for slots — never IGV vs IGT.
- Filters: This month chip · team · member · date range (labeled inputs,
  `max=today`, server-side clamp — future dates are impossible).

---

### Deal attribution & hierarchical rollup

- A recorded deal belongs to the **account's Responsible** (whoever the opens
  were raised for), NOT the person clicking the button.
- **Leaderboard rollup is hierarchical**: a member's slots/deals also count for
  their **Team Leader** (member 3 + TL's own 3 → TL shows 6, member shows 3,
  the function total stays 6 — no double count at function level).
- **VPs / the LCP never appear in the by-member board**.

## 6. UX conventions

**Loading = the walking AIESEC human** (`public/brand/walk.png`, looping alpha
**APNG** converted from the official brand `.mov` — WebP was dropped because
its frame disposal stacked frames over each other; component `WalkingLoader`,
used inside `PageSkeleton`). Motion system (all
`prefers-reduced-motion`-safe): `rise-in` entrances, KPI **count-up** numbers,
card hover-lift, button press scale, nav-pending shimmer, and a **confetti
burst** when a deal is recorded.

- **Mobile-first**: card lists replace tables on phones; `<main>` needs
  `min-w-0` (flex) — tables otherwise inflate the page width.
- Loading: `loading.tsx` skeletons per segment + `useTransition` pending
  shimmer (`.nav-pending`) on lane/filter switches.
- `Hint` (tooltip) on every action button; first-run **Tour** dialog dynamic by
  role+function (localStorage `crm-tour-v1:<email>`).
- Passwords always render in `PasswordInput` (eye toggle).
- Branding: official AIESEC logos (`public/brand/`), Lato, light/dark toggle
  (system default), `rise-in` entrance animations, branded gradient emails
  (`src/lib/email/templates.ts`).
- The word **"Manager"** is used in the UI for the sheet's "Stakeholder".

---

## 7. Repository map

```
supabase/migrations/          0001..0004 (run manually in SQL editor)
supabase/cron.sql             pg_cron schedules
src/lib/types.ts              domain types, pick-lists, phone/slug/quick-action helpers
src/lib/rbac.ts               THE RBAC engine
src/lib/auth.ts|auth.config.ts  Auth.js (credentials + Google), welcome email
src/lib/google/{sheets,gmail,calendar}.ts  sheet import/write-back/export · mail · calendar
src/lib/email/templates.ts    branded emails (welcome/visit/feedback/reset/module-ready)
src/server/data.ts            scoped reads, dashboard aggregates, goals, slug lookup
src/server/actions.ts         ALL mutations + business rules
src/server/notify.ts          in-app notifications helper (best-effort inserts)
src/lib/assistant.ts          The Blue Man: RBAC-scoped context + system prompt
src/app/api/assistant/        POST → Gemini 2.5 Flash + Google Search grounding
src/server/auth-actions.ts    login, Google, password-reset request
src/app/(app)/                dashboard, accounts (+import, [id]=slug), membership,
                              feedback(+inbox), profile; loading.tsx everywhere
src/app/welcome/              first-login onboarding
src/components/crm/           views, dialogs, ContactsEditor, QuickActions, Tour, Hint,
                              NotificationsBell (+Broadcast), BlueManChat, FeedbackInboxView…
```

## 8. Where to change what

| Change… | Edit |
|---|---|
| Pick-lists (types, industries, tags, roles) | `src/lib/types.ts` |
| Phone/slug rules | `src/lib/types.ts` (`normalizePhone`, `accountSlug`) |
| Permissions / scopes | `src/lib/rbac.ts` |
| Business rules (archive, goals, comments…) | `src/server/actions.ts` |
| Sheet import/write-back/mirrors | `src/lib/google/sheets.ts` |
| Manager default chain | `defaultManagerId` in `src/lib/google/sheets.ts` |
| Emails | `src/lib/email/templates.ts` |
| Tour steps / role blurbs | `src/components/crm/tour.tsx`, `ROLE_BLURBS` in types |
| DB schema | new file in `supabase/migrations/` (+ run in SQL editor + note here) |
| The Blue Man (prompt / data scope) | `src/lib/assistant.ts` (+ `/api/assistant/route.ts`) |
| Notifications kinds / broadcast | `src/server/notify.ts`, bell UI in `notifications-bell.tsx` |

---

## 9. Pending / operational notes

- **Pending user action:** run `0007_visit_scheduled_result.sql` and
  `0008_notifications_feedback.sql` in the Supabase SQL editor — 0007 fixes the
  "invalid input value for enum contact_status: Visit Scheduled" error; 0008
  creates `notifications` + feedback `anonymous`/`status` columns.
- `GEMINI_API_KEY` must exist in `.env.local` AND Vercel env (The Blue Man).
- **Module-ready announcement email**: template `moduleReadyEmail` is ready;
  send ONLY when Ahmed says go.
- Legacy columns (`project`, `package_plan`, `podio_link`, flat contact
  columns) remain in the DB for mirrors/history but are out of the UI.

---

## 10. Changelog

- **2026-07-11 · v8** — **Sodio** branding everywhere (sidebar, tab titles,
  manifest/PWA, login, emails, tour, onboarding); **The Blue Man** AI assistant
  (floating walking-man button → chat popup; Gemini 2.5 Flash free tier with
  Google Search grounding; context = viewer-scoped Sodio data via
  `buildAssistantContext` + AIESEC sites: aiesec.org, aiesec.org.eg,
  core.aiesec.org.eg, expa.aiesec.org); **B2B = whole-ICX raising** (both
  lanes); **deals attributed to the account's Responsible** with hierarchical
  TL rollup on leaderboards, VPs/LCP excluded from the member board;
  **notifications** (migration 0008): bell + unread badge, welcome/reset/visit/
  follow-up/thanks/broadcast kinds, EB & admin broadcast to all/by function/
  by role/hand-picked (optional BCC email); **feedback v2**: anonymous option
  (🎭), rebuilt inbox cards, thank-you action (in-app + email, with confirm),
  copy-email, done/archive + status filters; **KPI cards hover animation**
  (lift + glow + value lights up); coming-soon page now uses the walking man
  with rotating funny lines; friendly enum-error message pointing at migration
  0007; proposal PDFs (iGV/iGTa/iGTe) bundled in `proposals/`.

- **2026-07-11 · v7** — Walking-man loader re-encoded as **APNG** (WebP frame
  disposal stacked frames); **"Visit Scheduled" contact result** replaces
  "Call Scheduled" and books the visit like the dedicated button (migration
  0007); **goal(IGT) = goal(IGTa) + goal(IGTe)** — goals set per product lane,
  IGT lane derived; dashboard/accounts filter bars aligned on one baseline +
  equal-height KPI cards; **official proposal PDF attachment** switch on the
  Proposal email popup (proposals/<product>.pdf, awaiting the actual files).

- **2026-07-11 · v6** — Account type vs industry lists de-overlapped (type =
  WHAT the business is; industry = its DOMAIN: Software/Marketing/Engineering/
  Architecture/Education/Healthcare/Law/Finance/Real Estate/Tourism/Other);
  team drills/leaderboards exclude the EB (real Team Leaders only); WhatsApp
  glyph in the log-contact method select; walking-AIESEC-human loader
  everywhere; **Admin** comment label for the IM director (migration 0006);
  pinned sign on the list is now a pulsing ❗; **ICX Proposal Email integrated**
  (per-product Gmail drafts in the member's own mailbox, gmail.compose scope);
  animation pass: count-up KPIs, hover-lift cards, press-scale buttons,
  confetti on recorded deals.

- **2026-07-10 · v5** — IGV **Project restored everywhere** (required at
  create/import, badge on detail, text next to the IGV badge on the list,
  filter, editable in Details); real **WhatsApp glyph** replaces the generic
  message icon (quick actions + contact history); **email tags exclude
  Whatsapp**; **Google-first auth** — credentials are rejected until a password
  exists, Google consent asks for `calendar` + `gmail.send` (future features),
  login page reordered with Google primary, all reset copy updated;
  **multi-deal model** — `deals` table (migration 0005), `recordDeal`, account
  stays workable after deals, deal history in the timeline, header shows
  "N deals · M slots"; **dashboard KPIs redesigned** to MR / Contacted /
  Visits / Visits done / Deals / Slots / Lead→Deal + conversion strip, funnel
  card and flag KPIs removed, drill tables use MR/deals.
- **2026-07-10 · v4** — Password eye toggles everywhere; Podio **Rejected**
  archives the account (confirm dialog); tagged contact lists
  (Contact/Whatsapp/Manager/HR/CEO/Owner/Other) + **multi links**
  (Website/LinkedIn/Instagram/Facebook/Other) via shared `ContactsEditor` (add
  dialog + account page); **Egyptian phone normalization** (+20 canonical,
  03/02 landlines); **slug URLs** (`/accounts/hadana`) + dynamic tab titles
  with authorization-checked metadata; **pinned comments** (highlight + 📌 on
  the list with hover preview; migration 0004); accounts list redesigned
  (Date added · Account · Product · Status · Contacts · Next step · quick
  WhatsApp/call/email/social actions with overflow menu) + date-added filter;
  dashboard date inputs labeled (mobile) and future dates blocked client+server;
  this AI_CONTEXT.md created as the living doc.
- **2026-07-10 · v3** — Mobile-first pass (min-w-0 fix, card lists, skeletons,
  transition shimmer); role/function-aware tour + tooltips; goals +
  leaderboards + All-IGT lane + scoped member filter + This month; bulk
  CSV/XLSX import; multi tagged contacts (7–15); "Not Interested" auto-OOP;
  IGTa/IGTe/IGV badges (GTe orange); project removed; free-form sheet values;
  manager defaults; LCP excluded from ops emails; Manager wording; reset CTA;
  nicer emails; logo→home; typo fix.
- **2026-07-09 · v2** — Final membership sheet structure (LCVP/Team Leader/
  Director, multi-select functions, stakeholder by name); password auth +
  onboarding; profile; in-app membership editor with sheet write-back; archive
  replaces blacklist; numbered comments; Call Scheduled; function-gated account
  creation; curated lists; AIESEC branding + dark-mode toggle; feedback page
  (emails IM director + coach, inbox restricted to them); dashboard lanes.
- **2026-07-06 · v1** — Phase 1: schema, RBAC, accounts/contacts/visits,
  Google-only auth, floating feedback, sheets mirror, PWA.
