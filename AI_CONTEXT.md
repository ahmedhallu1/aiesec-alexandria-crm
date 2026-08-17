# AI_CONTEXT.md — Single Source of Truth (Sodio — AIESEC in Alexandria CRM)

> **⚠️ LIVING DOCUMENT.** Update this file **in the same commit** as any change
> to the system (feature, rule, route, schema, env var, deployment fact).
> Add a dated entry to the **Changelog** at the bottom. No secrets in this file.
>
> **⚠️ SHIP RULE (every session, no exceptions):** finished work goes
> **commit → merge to `main` → push to GitHub → `vercel deploy --prod`**.
> Never leave features on a side branch — that's how `0011_teams.sql` "went
> missing" once. Also update the in-app **Help center**
> (`src/lib/help-articles.ts` + `HELP_VERSION` in `help-content.ts`) with every release.

Last updated: 2026-08-16 · Version: v33.52

---

## 1. What this is

**Sodio** (briefly renamed **Elevate** in v28 — REVERTED in v32.1; internal
keys/cookies were always sodio-*, so nothing user-facing was ever lost) — a **100% free** CRM for AIESEC in
Alexandria: the ICX functions
(**IGV** & **IGT** raising, **B2B/BD**, **B2C**) plus — since v25 — the **OGX
sign-ups module** (OGT & OGV, two-way synced with the LC's tracker sheets). The brand name is
**Sodio** (shown in the sidebar, tab titles, manifest, emails); the built-in
AI assistant is **The Blue Man**. Members log accounts, contacts, visits and
deals; leaders steer with goals, leaderboards and dashboards. The RBAC engine is
the blueprint for future OGX/other-function modules.

| | |
|---|---|
| Live URL | https://sodio.vercel.app (+ aiesec-alexandria-crm.vercel.app; **elevate-alex.vercel.app was removed in v32.1**) |
| Repo | github.com/ahmedhallu1/aiesec-alexandria-crm (private) |
| Vercel project | `aiesec-alexandria-crm` (scope `ahmedhallu1s-projects`) — deploy with `vercel deploy --prod` |
| Stack | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, project `iesrpuuoduxtihuaqfic`) |
| Auth | Auth.js v5: **FIRST sign-in is Google-only** (grants `calendar` + `gmail.compose`) → onboarding sets a password → afterwards **email OR phone + password**, or Google, all work. **Members with NO email yet (v24) sign in with their phone in BOTH fields** until a password is set; adding their email closes that door (Google once, then password). Deactivated members land on **/inactive**. **Forgot password emails a fresh password** (`issueTempPassword` in `server/password.ts`); the old password still works until the member changes it (no lockouts) |
| Google | Service account (Sheets sync, folder creation) · **the IM mailbox token carries mail + calendar + drive + sheets** — every Drive FILE is written as the mailbox, because a service account has no storage quota · Calendar events on each member's own calendar |
| Cron | Supabase `pg_cron` + `pg_net` → `/api/cron/*`, **10 jobs** (visit-followups 15 min · signups-import 15 min · membership-import 30 min · sheets-export hourly :05 · **backup daily 02:00 UTC** · podio-updates daily 05:00 · period-reports daily 07:00 · streak-nags daily 16:00 · touch-point-feedback daily 19:00 · attendance-reminders daily 20:59) |
| Admin | `ADMIN_EMAILS` env (= IM director, treated as LCP) |

**Migrations** live in `supabase/migrations/` and are run **manually** in the
Supabase SQL editor (no CLI on this machine): `0001_init` → `0002_membership_v2`
→ `0003_ops_v2` → `0004_pins_v2` → `0005_deals` → `0006_admin_label` → `0007_visit_scheduled_result` → `0008_notifications_feedback` → `0009_b2b_deals_v9` → `0010_notif_link` → `0011_teams` → `0012_contracts_reminders` → `0013_director_label` → `0014_bd_podio` → `0015_bd_deal_amount` →
`0016_comment_archive` → `0017_planning_lcfeedback_testmode` →
`0018_tl_plans_deal_allocations_unassigned` → `0019_b2c_module` →
`0020_name_worlds` → `0021_podio_updates_all_fns_email_optional` →
`0022_team_registry` → `0023_email_unique_fix_phone_identity` →
`0024_function_leaders_type` → `0025_ogx_signups` → … → `0032_ir_booker_role` →
`0033_change_journal_lc_test` → `0033_touch_point_announced` →
`0034_bd_service_world` → `0035_ir_booker_phone` →
`0036_virtual_touch_points_and_routines` → `0037_admin_member_role` → … →
`0045_cic_signup_logs_ir_event_source` → `0046_lc_feedback_inbox` →
`0047_ir_call_timezone` → `0048_ir_product_and_lc_comments` →
`0049_direct_visits_mailbox_ir_notes` → `0050_ir_call_reschedule_history` →
`0051_fallback_email_bounces_b2c_cic` → `0052_three_name_worlds` →
`0053_calendar_item_visibility` → `0054_function_settings` →
`0055_touch_point_rating` → `0056_touch_point_members` →
`0057_touch_point_feedback_nudge` → `0058_ir_max_per_day` →
`0059_lc_partnerships` → `0060_ir_per_day_overrides` →
`0061_touch_point_location` → `0062_close_rls_gaps` → `0063_prank_mode`
(**all applied**, 0046–0063 during v33.22–v33.51).

**Google Drive sheets (deliberately FEW — flag columns instead of per-product
sheets):** `CRM — Membership` (two-way, + a **"Teams" tab** naming the standing
teams — sheet types `EB / LB / Function / Function leaders / Team`;
"Function leaders" is stored as **MM**, "Team" rows are skipped (TL team names
live in the Membership tab); the Function cell may hold SEVERAL functions
("B2B, BD") → one `teams` row per function; imported into the `teams` table.
The whole Drive folder is shared with **every EB member as commenter**) ·
`CRM — Raising Accounts` (ALL accounts in ONE mirror — IGV + IGT + B2B, active
AND archived — with `Function / Product / Archived?` flag columns for
filtering) · `CRM — Archived Accounts` (the focused blacklist view: OOP +
manual names) · `CRM — Contact Log` · `CRM — Visits`. Spreadsheets are found
BY TITLE in the Drive folder; ids are cached in `app_settings`
(`sheet:<title>`). The old per-product sheets (`CRM — IGV Accounts`,
`CRM — IGT Accounts`) and the separate `CRM — Teams` spreadsheet are GONE.

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

**B2B & BD are ONE function** (same membership today — may split in future
peaks): `isB2B` in `rbac.ts` (and `memberIsB2B` in `types.ts` for plain member
rows) matches **either** "B2B" or "BD" in functions or sub-functions, and
everything below applies to both names. **Accounts carry either label** —
the crew picks B2B or BD when adding (both behave identically: whole-ICX
opens mix; migration 0014 adds the `BD` account function). The dashboard's
B2B lane shows both; BD gets its own drill row and badge color.

**Podio submission worklist** (B2B/BD only): the "Podio pending" filter on
the accounts list — visible to `canRequestPodioSubmit` (the function's MMs +
Director/VP + LCP/admin) — shows B2B/BD accounts with `requested_podio=false`
and no request state. Each row gets a **copy-name button** (for the national
Podio form), an **inline request-state select** (Checking/Approved — also
marks requested; Rejected stays on the account page behind its confirm), and
**"Ask to submit"** (`requestPodioSubmit`): in-app notification ONLY to the
owner + `accounts.podio_submit_requested_at` — the account then **pins to the
top of the owner's accounts list** with a "Submit on Podio" badge until they
mark it requested / set a state (auto-cleared in `updateAccount`).

**TM module** (`/members`, `hasTmAccess` = TM function + LCP/admin — v1, more
later): the whole-LC members directory — info, team, manager, per-member
MOS/KPIs (own accounts: MR·Contacted·Visits·Done·Deals·Opens) and
email/call/WhatsApp shortcuts. TM users without raising access enter the
shell for `/members` + `/playbook` (GateClient `extra` prefixes) — the page
ALSO gates server-side (`redirect` + `listMembersDirectory` returns `[]`).

**Profile "my people" card** (`profilePeople` in data.ts): Team Leader → their
direct team · VP/Director → their whole function · LCP/admin → the EB
(LCVPs) · Members/Coordinators → nothing. Each person row has
email/call/WhatsApp buttons.

**Admin "Test view" (View-As)**: the admin's profile has a member picker —
`startViewAs` sets an httpOnly cookie (`sodio-view-as`, 4h expiry) and
`getViewer()` then returns the impersonated member (`viewer.impersonated`)
so THE WHOLE APP behaves as them; the real session is never touched
(`getRealViewer` powers the admin checks + the picker itself, so it works
mid-test-view). A fixed bottom banner shows "Test view: X — Exit". The
/welcome redirect is skipped while impersonating. ⚠️ Actions taken in a test
view are REAL and attributed to the target member (by design — it's a test
tool; audit_log records view_as_start/stop by the real admin).

**BD deals' MOS = MONEY** (migration 0015: `deals.amount` EGP +
`deals.benefits`): recording a deal on a BD account requires the amount
(opens optional); deal history shows `EGP X` + benefits, the account header
badge sums EGP across deals, and "CRM — Raising Accounts" gains a
"Deal Amount (EGP)" column. Dashboards/leaderboards still rank opens —
money is per-account/sheet for now (a money KPI can come later).

**B2B** (function or sub-function contains "B2B"/"BD") raises **for the whole ICX**:
they add accounts as **product "B2B" or "BD"** (not IGV/IGT), and every deal
records its opens **split across IGV / IGTa / IGTe** (e.g. 3 IGV · 2 IGTe ·
1 IGTa). Those per-product opens feed the IGV / IGTa / IGTe dashboard lanes,
while the accounts live in the B2B lane/drill. Detected by `isB2B` in
`rbac.ts`; feeds `scopeFunctions`, `hasRaisingAccess`, `allowedAccountFunctions`.
**v15 isolation: the B2B/BD crew's own dashboard shows ONLY their B2B lane**
(their accounts + the B2B lane goal) — `icxFunctions` no longer widens them to
IGV/IGT and `dashboardViewer` scopes them to B2B+BD. The **B2B lane has its
own function goal** (`performance_goals.function = 'B2B'`), set by the B2B/BD
**VP or Director** (the "function leaders" team's leader — e.g. Suits → Yara),
never by its TLs; **team goals require an actual team** (a TL with zero
members can't set one — server-checked). The calendar (`/calendar`) is also
**own-function only** (LCP/admin see all).

**Account visibility** (`accountScope` in `rbac.ts`):
- Member / Coordinator → own accounts only.
- Team Leader → own + their team members' accounts.
- VP (LCVP) → all accounts of their function(s) **+ B2B** (B2B raises for them).
- Director → all accounts of their function(s) **+ B2B** (e.g. Yara, Director of
  B2B → every B2B account; an IGV/IGT Director also sees B2B).
- LCP / admin → everything.
`scopeFunctions(v)` returns a leader's `AccountFunction[]` — always appends
`"B2B"` when the leader owns IGV/IGT or is B2B, so IGV & IGT VPs/Directors see
B2B accounts.

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
- **Deal opens can be SPLIT across members** (v22, `deal_allocations` —
  deal_id, member_id, per-product splits; every deal gets ≥1 allocation, the
  default is 100% to the responsible): the Record-deal popup has a "Split the
  opens" switch (member list = everyone in the account's function via
  `listFunctionMembers`; splits must sum exactly — server-checked). ALL
  per-MEMBER opens numbers read allocations (leaderboards, members directory,
  period-report person rows, "My numbers" slots, TL-plan actuals) with an
  account-counters fallback when the table is empty (pre-0018); LANE totals
  still come from the deals' per-product split columns. Deal history shows
  "Opens split: A (3) · B (3)" when custom.
- **Unassigned accounts** (v22): `accounts.responsible_id` is NULLABLE (the
  pipeline view LEFT-JOINs members). The imported market research lands
  unassigned; member/TL scopes never match NULL so only VPs/Directors/LCP see
  those rows (accounts filter Responsible → "— Unassigned", value `none`) and
  distribute them via (bulk) reassign. Guards: scheduleVisit / requestPodioSubmit
  / recordDeal-without-split fail with "assign first" messages; UI renders
  "Unassigned".
- **B2C module (v23)**: `AccountFunction` gains `B2C` (enum + check via 0019).
  B2C accounts carry ONE **Type** — `B2C_TYPES` = Courses / Events / Student
  activities — stored in `account_type` (no industry, no product/project).
  **Podio continuous updates**: every B2C account must be refreshed on Podio
  every `podio_update_every_days` days (default `PODIO_UPDATE_DEFAULT_DAYS` = 14 since v24.1,
  editable 1–90 on the account's "Podio — continuous update" card, which shows
  the countdown); `markPodioUpdated` stamps `podio_updated_at` and clears
  `podio_update_notified_at`. The daily **podio-updates cron** (05:00 UTC,
  `/api/cron/podio-updates`, scheduled in pg_cron) notifies (bell kind
  `podio_update` + `podioUpdateDueEmail`) the responsible + the B2C
  LCVP/Directors ONCE per cycle when due. **B2C deals carry NO details**
  (deals check relaxed to `slots >= 0` in 0019): the Record-deal popup links
  the contract Google Form (`B2C_CONTRACT_FORM_URL`) and offers one "Deal
  signed" button — no opens/splits/amount/files. **No proposal emails**
  (button hidden + server-rejected). RBAC: `isB2C`/`memberIsB2C` (functions OR
  sub_functions), B2C appended to `scopeFunctions`/`allowedAccountFunctions`,
  `hasRaisingAccess` includes the crew; the **B2C dashboard lane** is
  isolated like B2B (crew + LCP/admin only), deals-centric (no Slots KPI,
  "Lead → Deal", leaderboards ranked by Deals, B2C excluded from All-ICX);
  members-directory MOS `b2c` = deals; visits announce to the B2C crew only.
- **The accounts list is PAGINATED** (v22): `listAccountsPage` (page size 100,
  `?page=` 1-based, exact count, Prev/Next footer; filter changes reset the
  page). Full-set readers (`listAccounts`, dashboard, mirrors, directory,
  reports) page through Supabase's 1000-row response cap via `fetchAll`
  (stable order + id tiebreak, 20k sanity ceiling).
- **Deal contracts (optional)**: any file format, uploaded at record time or
  later from the deal's History entry (`deals.contracts` jsonb, migration
  0012). Files go browser → private Supabase Storage bucket `contracts` via
  **signed upload URLs** (`requestContractUploads` → PUT → `confirmContractUploads`
  — Vercel caps action bodies ~4.5 MB, so bytes never touch the server); viewing
  uses 10-min signed links (`getContractUrl`, anyone who can view the account).
- **IGV accounts always carry a Project** (Skill Up!, Rooted, …) — required at
  creation/import, shown on the accounts list next to the IGV badge, editable
  in Details, filterable.
- **Unique name — WORLD-AWARE (v23.2)**: ACTIVE names are unique across every
  function, but the ARCHIVE block is per world — ICX-raising (IGV/IGT/B2B/BD,
  incl. the manual blacklist) vs B2C each keep their own archive
  (`checkAccountName(name, fn)`; a cross-world archived match is a
  non-blocking heads-up in the add dialog). The DB index is
  `accounts_normalized_name_world_key (normalized_name, function='B2C')`
  (0020), so a name can exist archived in one world AND active in the other:
  slug lookups prefer the ACTIVE row; archived list rows link by UUID.
- **The archive IS the blacklist**: OOP accounts are hidden, unre-addable,
  revivable by TL+. No blacklist tab/sheet. **The Archived tab is LC-WIDE
  (v22.2)** — every member browses ALL archived names (scope skipped) and can
  OPEN any archived account read-only (`canViewAccount` passes for archived;
  editing stays scoped via `canEditAccount`); add/import archived stays TL+
  (`canManageArchive`).
- **Auto-archive rules**: contact result **"Not Interested"** and Podio request
  state **"Rejected"** both archive the account (with warning confirmations).
- **Out-of-Process reasons** (`OOP_REASONS` in `types.ts`) are a fixed pick-list
  — Not responding · Financial issues · Not Interested · Backed out · Other Plans
  · Needs too technical background EPs · Conflict of Values between AIESEC and
  organization · Blacklisted — plus **Other** (free text).
- **Manual archive** (Archived tab, TL+): **Add archived** (name — the reason
  is OPTIONAL) and **Import archived** (CSV/XLSX with Name + optional Reason,
  editable preview, ≤1000 rows, free-form reasons kept as-is) blacklist names
  that were burned before the CRM existed — no active account needed. Entries
  live in the `blacklist` table and block re-adding exactly like an OOP
  account; VP+ can remove an entry.
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
  `TL/VP/Director/LCP/Admin Comment #n` — a Director is labeled **Director**,
  NOT VP (migration 0013); the IM director's label is **Admin**, not LCP).
  Any comment can be **pinned** → highlighted in the card AND shown as a ❗
  (CircleAlert) on the accounts list; hover reveals the text. Any comment can
  also be **archived** (migration 0016 `account_comments.archived`;
  `toggleCommentArchive`, RBAC = `canEditAccount`) — archiving unpins it and
  hides it behind an **"Archived (n)"** toggle on the comments card; numbering
  runs over the FULL list so `#n` never shifts.
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
  **Design = the LC's original proposal tool** (card layout: AIESEC logo +
  program badge header, headline, intro, "Why this could be a strong fit"
  callout, Opportunity-snapshot + About-AIESEC cards, meeting-request callout,
  "More about {program}" link, member signature) — **ONE brand color for all
  products (AIESEC blue `#037EF3`)**, only the CONTENT is per-function;
  **NO company-logo section and NO "Dear …" greeting** (both by request — the
  recipient-name field was removed from the popup too). The signature title is
  product-based, NOT the CRM role (`Global Volunteer/Talent/Teacher Manager`,
  B2B → `Business Development Manager`) and the phone links to
  `wa.me/<number>`. B2B accounts default to a **general all-programs variant**
  linking to `aiesec.org/partners` (can still pick a specific product's body).
  **B2B/BD accounts attach NOTHING by default** (v20 — the attach set starts
  empty; the member opts in per product), whereas IGV/IGT prefill their own
  product PDF.
- **Contact log results**: No Response / Responded / Interested / Not Interested
  (archives) / Wrong Contact / **Visit Scheduled** (requires date+time and
  BOOKS the visit through the exact same path as the Schedule-visit button —
  calendar reminders included; 'Call Scheduled' is a legacy value kept for old
  rows only). Golden rule: every in-process account carries a next step with a
  date or a pending visit; 3 unanswered attempts → OOP prompt.
- **Visits**: calendar event on the responsible's Google Calendar (24h + 1h
  reminders), +2h follow-up email, report emails to VP + manager (never LCP).
  `scheduleVisit` returns a `calendarHint` (`linked`/`no_grant`/`relogin`/
  `error`) so the UI says exactly why a reminder wasn't created (dead Google
  grant → re-login) instead of failing silently.
  - **Follow-up reminders (v11)**: the +2h "was it completed?" email goes to
    the responsible **AND their team leader/manager** when the responsible is
    a Member/Coordinator (details table included); TL-and-above get it alone;
    the LCP never. **One week later with still no report** → a firmer
    "you forgot about it" email to the same people (report the result, or
    mark the account Out of Process if not interested — no wasted resources).
    Tracked by `visits.followup_prompt_sent_at` + `forgotten_nag_sent_at`
    (migration 0012), both passes in `/api/cron/visit-followups`.
  - **Shared with leaders** (calendar attendees, Google invite): a **Member's**
    visit is shared with their **Team Leader + function VP(s)**; a **Team Leader
    or Coordinator's** with the **VP(s)**. Raising only (not consideration).
  - **Function-wide announcement**: booking a visit **emails + in-app notifies
    the whole product's raising crew + B2B** (IGV visit → IGV raising + B2B;
    IGT → IGT raising + B2B; B2B → IGV + IGT raising + B2B) — an FYI, no
    calendar reminder for them. `resolveVisitRecipients` + `visitAnnouncementEmail`;
    notification kind `visit_announcement`.
- **Next-step reminders**: whenever an account's next step gets a date, a
  calendar follow-up event is upserted on the responsible's calendar (at the
  step's time, or **11:00** when date-only) — kept in sync on change and removed
  when the step clears / the account is archived. `syncNextStepReminder` +
  `upsertFollowupEvent`; stored in `accounts.next_step_event_id`.
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

**GOALS COME FROM PLANNING — nothing is set in-app (v22).** The
`performance_goals` machinery is retired (setPerformanceGoal, GoalDialog,
Set-goal buttons, the goal-reminders cron + its email templates are all gone;
the table stays in the DB, unread). Instead: the **lane goal = the PlanCard**
(plan_cells opens vs `laneOpensActual`, sprint/month toggle — product lanes
only; the B2B lane has no planned goal because the planning sheet skips
B2B/BD) and the **team goal = the TL's filed plan** (`tl_plans`, see below) —
`getDashboard` returns `teamPlan` {planned vs allocation-attributed actual for
the current month} rendered as TeamPlanCard (a TL with no filed month sees a
nudge to their profile). Funnel conversion percentages are **capped at 100%**
everywhere (dashboard strip/KPI/drills + planning conversions — plan-progress
bars stay uncapped). The **"My numbers" chip is hidden for VP/Director/LCP/
admin** (they already see the whole function). Filter bar sits on a single h-9
baseline (the date range is one inline "Added → →" group) and KPI cards have
equal-height labels so the numbers align.

**Raising MM plans (v22, `tl_plans`)**: raising MMs — **Team Leaders AND
Coordinators** of IGV/IGT or B2B/BD (`isPlanningTl`; consideration/OGX MMs
keep the applicants/accepted/approvals `mm_plans` flow, never both — so EVERY
MM plans) — file OPENS per month of the peak on first sign-in
(`/welcome/plan-tl`, layout redirect via `needsTlPlan`) and edit any time from
the profile **"My plan" card** (`tlPlanForProfile` — plan + actual opens per
month, allocation-attributed; a TL's actuals cover the whole team, a
Coordinator's their own). `saveTlPlan` upserts (peak re-derived server-side,
sandbox-journaled). /planning gains a **"Raising MM plans"** card
(`listTlPlans`) next to the MM plans. Only a TL's plan feeds the dashboard
team card.

**KPI row (this exact order, nothing else):** Market Research (total accounts) ·
Contacted · Visits (scheduled) · Visits done · Deals (count of deals, not
accounts) · Slots raised · **Lead → Open** (% of accounts that raised opens).
Directly below: the step-to-step **conversion strip** — MR→Contacted,
Contacted→Visits, Visits→Done, and **Visit Done → Deal**. (The old funnel bars and flag KPI
cards were removed on request; flags remain reachable via accounts filters.)

- Lanes gated by the member's functions: `All ICX / IGV / All IGT / IGTa / IGTe`
  (product colors: GV `#F85A40`, GTa `#0CB9C1`, GTe `#F48924`).
- **Everyone in a module sees their whole function's aggregates** (accounts list
  stays scoped); member filter shows only lane members (never the LCP).
- **Goals** (`performance_goals`): VP/Director sets the function goal, TL the
  team goal (month or peak period) — progress bars on everyone's dashboard.
  **Goal reminder cycle (v11)**: when a period ends with no successor goal,
  the daily `goal-reminders` cron emails the owners (lane → its VPs/Directors,
  team → the TL) last period's **goal vs achieved** + a set-the-new-goal
  button (once per goal — `ended_reminder_sent_at`, migration 0012; goals
  ended >14 days ago are marked silently). Setting a NEW goal emails +
  notifies everyone it applies to (lane members incl. B2B, or the TL's team)
  via `newGoalEmail` — updates to an existing period stay quiet.
- **"My numbers" chip** in the dashboard filter bar: any member can toggle the
  KPIs + conversion strip to just their own accounts (`member=<their id>` URL
  param — the personal KPIs/MOS tracker). **The member filter scopes the KPI
  totals + conversions ONLY** — leaderboards, product/team drills and goal
  progress always show the full picture (`responsibleId` is stripped from the
  DB query and applied in JS to `total` alone).
- **B2B lane** on the dashboard for the LCP/admin, VPs & Directors (B2B
  affects their functions) and the B2B crew — `rowInLane`/`laneSlots` already
  spoke B2B; v12 exposes the `views` chip + `parseFnParam` case.
- The last conversion is labeled **"Visit Done → Deal"** (v20 — the share of
  visit-done accounts that reached a deal; `pct(dealAccounts, visitDone)`).
- **Visits calendar** (`/calendar`, sidebar for every raiser): month view of
  the WHOLE function's visits (B2B included), one stable color per member,
  legend with counts, Saturday-first weeks, agenda cards on phones, click-through
  to the account. `listFunctionVisits` in `data.ts`; `?m=YYYY-MM` picks the month.
- **Leaderboards**: ONE **wide** board per scope (function + team) listing
**Members & Coordinators only** (never Team Leaders, VPs, Directors or the LCP),
full-width, showing **every** funnel number per member at once — **MR ·
Contacted (count of accounts with ≥1 contact, not contact-log count) · Visits ·
Visits done · Deals · Opens**, in funnel order. **Clicking any KPI header
re-sorts** with a **FLIP glide animation** (`useFlipReorder`); default sort is
**Opens**. Deals belong to the account's **Responsible**. The old By-member drill
table and the Flags column were removed. Product/team drills remain.
- Filters: This month chip · team · member · date range (labeled inputs,
  `max=today`, server-side clamp — future dates are impossible).

---

### Deal attribution & per-product opens

- A recorded deal belongs to the **account's Responsible** (whoever the opens
  were raised for), NOT the person clicking the button.
- **Opens are recorded per product** (`deals.slots_igv/igta/igte`, mirrored to
  `accounts.slots_igv_count/igta_count/igte_count`): IGV accounts sign IGV opens;
  IGT accounts split IGTa + IGTe; B2B accounts mix all three. `slots_count` is
  their sum. The dashboard lane attributes each lane's slots from these splits,
  so a B2B account's IGV opens land in the IGV lane.
- **Leaderboards list Members & Coordinators only** — no TL rollup, no VPs/LCP.
  Each member's row is their own accounts' numbers for the active lane.

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
supabase/migrations/          0001..0012 (run manually in SQL editor)
supabase/cron.sql             pg_cron schedules
src/lib/types.ts              domain types, pick-lists (OOP_REASONS), phone/slug, fmtDateTime
src/lib/rbac.ts               THE RBAC engine (scopeFunctions = leader visibility, B2B-aware)
src/lib/auth.ts|auth.config.ts  Auth.js (credentials email/phone + Google)
src/lib/google/{sheets,gmail,calendar}.ts  sheets (+archived mirror) · mail · calendar (visit + next-step events)
src/lib/avatars.ts            fun DiceBear avatar choices
src/lib/core-analytics.ts     CORE live digest (national rankings + Alexandria funnel)
src/lib/email/templates.ts    branded emails (welcome/visit/feedback/newPassword/module-ready)
src/server/data.ts            scoped reads, dashboard per-lane aggregates, goals, slug, manual-archive list
src/server/actions.ts         ALL mutations (deals per product, manual archive, avatars…)
src/server/password.ts        forgot-password: generate + email a fresh password
src/server/notify.ts          in-app notifications helper (best-effort inserts)
src/lib/assistant.ts          The Blue Man: RBAC-scoped context + CORE digest + prompt
src/app/api/assistant/        POST → Gemini 2.5 Flash + Google Search grounding
src/server/auth-actions.ts    login (email/phone), Google, forgot-password (emails a password)
src/app/(app)/                dashboard, accounts (+import, [id]=slug), membership,
                              playbook, feedback(+inbox), profile; loading.tsx everywhere
src/lib/help-content.ts       Help center machinery (types, categories, search)
src/lib/help-articles.ts      THE KNOWLEDGE BASE (bump HELP_VERSION with every release)
src/components/crm/help-view.tsx  the /help UI (search, categories, articles, FAQs)
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
| CORE digest (scraping / entity ids) | `src/lib/core-analytics.ts` |
| Notifications kinds / broadcast | `src/server/notify.ts`, bell UI in `notifications-bell.tsx` |
| Avatars (styles / seeds) | `src/lib/avatars.ts`; picker in `profile-view.tsx` |
| Leader visibility (who sees which accounts) | `scopeFunctions` in `src/lib/rbac.ts` |
| The Help center (articles/FAQs) | `src/lib/help-articles.ts` (+ bump `HELP_VERSION` in `help-content.ts`) · diagrams in `help-diagrams.tsx` |
| Lane goal display (plan vs actual) | `lanePlan` in `getDashboard` · `PlanCard` in `dashboard-view.tsx` |
| TL plans (who files, flow, card) | `isPlanningTl`/`needsTlPlan`/`tlPlanForProfile` in `data.ts` · `saveTlPlan` in `actions.ts` · `tl-plan-form.tsx` · `/welcome/plan-tl` |
| Deal opens splits | `recordDeal` allocations in `actions.ts` · `deal_allocations` reads in `data.ts` · DealDialog in `account-detail-view.tsx` |
| Accounts list pagination | `listAccountsPage` in `data.ts` · pagination footer in `accounts-view.tsx` |
| Follow-up / forgotten-visit reminders | `/api/cron/visit-followups/route.ts`, templates in `email/templates.ts` |
| Deal contract uploads | `requestContractUploads`/`confirmContractUploads`/`getContractUrl` in `actions.ts` |
| Sprint/peak/quarter calendar math | `src/lib/plan.ts` |
| Planning sheet parsing / re-import | `importPlanningSheet` in `src/lib/google/sheets.ts` |
| Planning page / dashboard plan card | `planning-view.tsx` · `PlanCard` in `dashboard-view.tsx` · `lanePlan` in `getDashboard` |
| MM plan flow (who must file, when) | `isPlanningMm`/`needsMmPlan` in `data.ts` · `peakForPlanning` in `plan.ts` · `/welcome/plan` |
| Period reports (content / cadence / recipients) | `buildFunctionReport` in `data.ts` · `periodReportEmail` in `templates.ts` · `/api/cron/period-reports` |
| Sandbox test view (undo / suppression) | `src/server/sandbox.ts` · `startViewAs`/`stopViewAs` in `actions.ts` · chip in `view-as-banner.tsx` |
| Test data seeding | `seedTestAccounts`/`removeTestData` in `actions.ts` |
| Guided walkthrough (steps / anchors) | `tour.tsx` (steps) · `guided-tour.tsx` (engine) · `data-tour="…"` in the views |
| Column filters | `ColumnFilter` in `data-table-kit.tsx` · `columnFilter()` in accounts-view / signups-view |
| Podio existence check (parser / cache / TTL) | `src/lib/podio.ts` · `checkPodioNameLive` in `actions.ts` · verdict UI in `add-account-dialog.tsx` |
| Dashboard lane list & who sees it | `raisingFunctions`/`considerationFunctions`/`seesEveryLane`/`ogxLanes` in `rbac.ts` · `views` in `dashboard/page.tsx` |
| Change journal / undo / LC test session | `src/server/sandbox.ts` · `startLcTestSession`/`stopLcTestSession`/`undoAuditEntries` in `actions.ts` · `/admin` |
| Stale plans when membership changes | `stillPlans`/`prunePlansForMember`/`pruneStalePlans` in `data.ts` |
| First-run walkthrough | `buildSteps` in `tour.tsx` (bump `crm-tour-v*` to re-show it) |
| Nightly backup (tables, retention, destinations) | `src/server/backup.ts` · `/api/cron/backup` |
| Security headers / CSP | `next.config.ts` |
| Tests | `tests/*.test.ts` (Vitest — `npm test`) |
| Feedback categories | `FEEDBACK_CATEGORIES` in `types.ts` |
| LC people feedback | `submitLcFeedback` in `actions.ts` · `lc-feedback-view.tsx` · inbox via `listLcFeedback` |
| Function defaults (shape + what unset means) | `src/lib/function-settings.ts` (pure) · reader `src/server/function-settings.ts` · `saveFunctionSettings` in `actions.ts` · card in `profile-view.tsx` |
| Who may read a whole function (per-role) | `openViewFns`/`fnSettings` on the Viewer (`viewerFunctionSettings` in data.ts) · `canViewAccount`/`openViewFunctions` in rbac · the `openFns` OR in `applyScope` |
| OGX referrals | `addSignupReferral` in `actions.ts` · `ReferralDialog` in `signups-view.tsx` (source='referral' — never synced to a tracker tab) |
| IR email checks (pre-booking) | `src/lib/email-check.ts` |
| IR bounce watcher + host alert | `src/server/bounces.ts` · `irEmailBouncedEmail` in `email/templates.ts` |
| Fixing an IR's email (invite swap/rebuild) | `updateIrBookerEmail` in `actions.ts` · `swapIrCallAttendee` in `google/calendar.ts` |
| Consideration lane filters | `ConsiderationFilters` in `considerationStats` (data.ts) · the shared filter bar in `dashboard-view.tsx` |
| IR call-log filters | `IrCallFilters`/`irCallFilterOptions`/`listIrCalls` in data.ts · `IrCallsTab` in `consideration-view.tsx` |

---

## 9. Pending / operational notes

- **BACKUPS (v33)**: nightly at 02:00 UTC into the private Supabase bucket
  `backups` (30 days, gzipped ~1.2 MB each) + a gzipped copy emailed to the IM
  mailbox + a copy in the CRM Drive folder ("CRM — Backups"). Restore = create the schema from `supabase/migrations/`, gunzip the
  dump, insert each array under `data.<table>`. **Storage buckets (contracts,
  cvs) are NOT backed up** — they are files, not rows. Health page shows the
  last run; a failed run returns 500 and logs `[backup] FAILED`.
- **The `xlsx` high-severity advisory has no upstream fix.** Parsing is
  client-side on a file the member chose, so the blast radius is that member's
  own browser. Revisit if SheetJS ever ships a patched release.
- **All migrations 0001–0017 are RUN** (0001–0015 verified live 2026-07-16;
  0016 applied 2026-07-18; **0017_planning_lcfeedback_testmode applied
  2026-07-21 via the Supabase MCP** — plan_cells, mm_plans, feedback.category,
  lc_feedback, accounts.is_test (+ accounts_pipeline view column),
  test_sessions, test_undo).
- **PLANNING SHEET STILL NOT REACHABLE BY THE SERVICE ACCOUNT** (re-checked
  2026-07-26 after Ahmed shared it: Drive returns "File not found" for the
  service account = zero access — the share never landed, most likely an
  aiesec.net external-sharing restriction or a mistyped address). v21's 1512
  verified plan cells stay live. For the /planning **Re-import** button to
  work, "Alexandria | Planning Tool 26.1" must be readable by
  `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com` — either a
  direct Viewer share (watch for the "sharing outside your organisation"
  warning and confirm it), OR move/copy the sheet into the CRM Drive folder
  (the folder is already shared with the service account).
- The **period-reports pg_cron job** (daily 07:00 UTC) was scheduled directly
  in prod (2026-07-21) by cloning the goal-reminders job's URL+key — it's in
  supabase/cron.sql too for rebuilds.
- **CRON_SECRET was rotated 2026-07-16**: the old pg_cron jobs had been
  scheduled with the literal `<CRON_SECRET>` placeholder (silent 401s — the
  production crons had likely never fired successfully). New 48-hex secret
  lives in Vercel prod env + `.env.local` (in sync); the four cron jobs were
  rebuilt with it via one SQL script. If the secret ever rotates again:
  update BOTH env locations, redeploy, and re-run the four `cron.schedule`
  calls from `supabase/cron.sql` with the value substituted.
- **CRON_SECRET is IN SYNC** since 2026-07-26: `.env.local` now carries the
  same value as Vercel/pg_cron (pulled from `cron.job` and pasted in) — manual
  local cron triggering works.
- **Drive is already renamed** (done by Ahmed by hand): the old IGT sheet is
  now `CRM — Raising Accounts`, the blacklist sheet is `CRM — Archived
  Accounts`, the IGV sheet is deleted. The code finds them by (loose) title,
  so nothing else is needed; the Teams TAB on the Membership sheet is created
  and seeded automatically on the next membership import.
- **CORE data (The Blue Man):** `src/lib/core-analytics.ts` fetches
  core.aiesec.org.eg's public national dashboard + Alexandria's LC page
  (id 899, cached 15 min) and injects the top-10 national rankings per product
  and Alexandria's funnel into the assistant context. No key needed. If CORE's
  HTML structure changes, adjust `extractMainText`'s `main-container` marker.
- `GEMINI_API_KEY` must exist in `.env.local` AND Vercel env (The Blue Man).
- **Module-ready announcement email**: template `moduleReadyEmail` is ready;
  send ONLY when Ahmed says go.
- Legacy columns (`project`, `package_plan`, `podio_link`, flat contact
  columns) remain in the DB for mirrors/history but are out of the UI.

---

## 10. Changelog

- **2026-08-16 · v33.52** — **FILTERS, GOALS, A RANKING AND THE ROAD TO
  ACTIVATE** (no migration).
  ① **THE ATTENDANCE MEMBER FILTER COULD NOT BE CLEARED.** Its options were
  built from the rows ON SCREEN, so the moment you picked one member the list
  had one entry, the `length > 1` guard hid the funnel, and the filter was
  stuck with no control left to clear it. The active picks are unioned back
  into the options and the funnel renders whenever a filter is on. Same trap,
  same fix, on the CV pool's Uploaded-by and Partner-LC funnels.
  ② **ATTENDANCE FILTERS BY FUNCTION** — a new Function column (the member's
  own, functions + sub-functions) with its own funnel, resolved server-side
  BEFORE the page is cut so it filters the whole history, not the page in
  hand. And the page's kind/status validation was rewritten: the funnels are
  multi-select and emit comma lists ("meeting,outing"), which
  `TOUCH_POINT_KINDS.includes()` rejected whole — so every multi-pick silently
  filtered nothing while the funnel showed two ticks.
  ③ **MEMBERSHIP FILTERS BY MANAGER.** With team names gone from the sheet, a
  team IS its manager — this is the funnel that answers "show me X's people".
  Its options come from the membership itself.
  ④ **THE OGX GOAL APPEARS** (the report: "the goal of MMs/VPs in OGX not
  appearing"). Two holes: the lane only ever showed the MMs' FILED plans added
  up — null until somebody files, and no OGX MM has — while the VPs' own
  numbers sat in `plan_cells` as OGV / OGTa / OGTe, imported in v21 and read
  by nothing. The OGT/OGV lanes now show **the function's goal from the
  planning sheet** (this sprint and this month, applicants · accepted ·
  approvals), the MM plan card as before, and an amber nudge for an MM who
  hasn't filed this month instead of silence.
  ⑤ **THE CONSIDERATION FLOOR HAS A RANKING.** It had a calls drill and no
  leaderboard, while every other lane ranks its people. The by-member table is
  now ranked (by calls done) and carries the rest of the job: **LCs reached**
  (distinct, counted once however many times they called), **🤝 partnerships
  made**, and **CVs** on the IGT lane. No 15-row cut any more — a board shows
  the floor.
  ⑥ **🏆 ROAD TO ACTIVATE** (`activate-strip.tsx`): a thin AIESEC-blue band at
  the top of every page counting down to the national conference on
  **3 December 2026**, with the day's own Cairo date so it can never be a
  build-time constant. **It removes itself** the day after — no EB action, no
  cleanup. Dismissing hides it until tomorrow only. Rendered in the page's own
  flow, never fixed: a second fixed bar would fight the phone's top bar for
  the same 3rem.
  ⑦ **50 MARKET-RESEARCH NAMES HANDED TO THE B2B/BD CREW**
  (`scripts/hand-out-b2b-accounts.mjs`, `--dry` to preview): unassigned, still
  in process, not test, and **carrying a phone number** — shuffled
  (Fisher–Yates, not "the first 50 by id") and dealt round-robin to the crew's
  Members + MMs, 8/7/7/7/7/7/7 across Akmal · Hana Wael · Mahmoud khaled ·
  Monzer Essam · Salma · Youssef atya · Youssef Elgayar. Each account is
  **marked B2B** (it belongs to a B2B raiser now — the v33.18 rule; B2B shares
  the ICX name world with IGV/IGT so no name could collide), every hand-over
  is in the audit log, and everyone got a bell — plus an email for the three
  who have an address on file.

- **2026-08-15 · v33.51** — **🃏 PRANK MODE** (migration **0063 applied**:
  `members.prank_until`, `members.prank_by`). The EB can put ONE member's Sodio
  in a mischievous mood — for a day, a week, the whole peak, or until they turn
  it off — from a card in the membership editor. Then Sodio starts playing with
  them, and only them.
  ① **THE JOKES.** A **stubborn button** ignores the first click and *grows*
  each time ("Nope. 😌", "Was that a click or a suggestion? 🤨") — the
  third click is the real one, and by then the button is half again its size,
  so the joke is easier to finish than it was to start. **The scenic route**:
  a sidebar tab opens the WRONG page and immediately apologises with a working
  link to the one they asked for ("it's not another trap. Promise. 🤞").
  **Ambient mischief**: the Blue Man strolls across the bottom of the screen,
  the page shivers for one second, or a completely pointless toast turns up
  ("Achievement unlocked: 🏆 Clicked A Thing").
  ② **AND THE REASON IT IS ALLOWED TO EXIST IN A CRM 70 PEOPLE RUN A PEAK ON.**
  Nothing is ever BLOCKED, only delayed by two clicks. There is a hard
  blocklist — no dialogs, no forms, no Save / Send / Record / Delete /
  Archive / Confirm / Sign-in buttons, nothing destructive, nothing on
  /login, /welcome, /inactive, **/feedback** (reporting a problem must never
  BE one), /help or /admin, and never while somebody is typing. A **90-second
  cooldown** caps it whatever they click. Every single prank carries
  **"😤 I'm working"**, which buys ten minutes of total silence, as often
  as they want. It **expires by itself**. And the first time it fires, a
  **reveal** explains the whole thing and names who did it — seven seconds
  later, so the modal can't swallow the very clicks the joke is asking for —
  because a member quietly convinced Sodio is broken costs the LC an
  afternoon, and that is the one thing this feature must never do.
  ③ **THE SERVER SIDE IS ONE TIMESTAMP.** `setPrankMode` (EB/admin only,
  audited under the setter's name, `prank_by` on the row) writes
  `prank_until` and nothing else. Every prank lives in the victim's browser
  (`prankster.tsx`), mounted by the app shell only while the mood lasts and
  **never in a test view** — an admin diagnosing somebody's screen must see
  the real thing. No jobs, no emails, no notifications, no sheet column, not
  one row of data touched.
  ④ Verified in a real browser before shipping: the stubborn button blocks
  twice, scales 1.16 → 1.56, then fires for real and heals to no inline
  transform; **Save changes, a destructive button and a button inside a form
  all passed straight through, six for six**; the wrong-turn link delivered
  the victim to the page they actually asked for; nothing left a stuck
  pointer-events lock. The button's LABEL is deliberately never rewritten —
  its contents are React's, and mutating them mid-render is how you earn a
  "failed to execute removeChild" in somebody's console; the joke touches
  only the inline transform and says its line in a toast.
  Help centre: a new 🃏 article under FAQs (what you're seeing, why
  nothing is broken, how to buy silence); the Blue Man is briefed to answer
  "my button needs three clicks" without anyone filing a bug.

- **2026-08-15 · v33.50** — **FOUR FROM THE FLOOR** (no migration).
  ① **THE HELP CENTER WAS UNREADABLE ON A PHONE — because of its TABLES.** The
  house rule since v3 is that card lists replace tables on phones; the help
  center was the one place still shipping a real `<table>` to a 375px screen.
  Reproduced at 375px before touching anything: "Read the dashboard"'s
  three-column reference came out as slivers two words wide with the LAST
  column clipped at the edge and nothing to say it could be scrolled — so the
  tables that answer *who sees which lane* and *what each KPI means* were
  exactly the part you couldn't read. `HelpTable` now renders **one card per
  row below `sm`** (first cell as the heading, every other cell labelled with
  its own column header) and the identical table from `sm` up. Verified: zero
  overflowing elements, `scrollWidth` = 375, the desktop table `display:none`,
  seven row-cards in its place. Two smaller ones on the same pass: the search
  placeholder was cut mid-word ("…accounts, v") so the Arabic half — the part
  that tells half the LC they can type Arabic — was never seen on a phone
  (short placeholder now), and the Popular-questions rows `truncate`d, which
  is a question you can't decide whether to tap (two lines on a phone, one
  from `sm` up).
  ② **THE CV POOL COULD NOT BE FILTERED ON A PHONE AT ALL.** Its five filters
  (Industry · AI status · Uploaded by · Partner LC · has/no number) hang on
  COLUMN HEADERS, and phones get cards — so the whole pool was search-only
  there. `FilterSelect` — the labelled-chip twin of `ColumnFilter`, private to
  accounts-view since v33.3 and the reason every other list went without —
  moved into `data-table-kit.tsx`, and the CV tab now carries a `md:hidden`
  chip row with the same five filters, the same URL params, the same
  server-side query, plus a Clear.
  ③ **RAISING HAS A DASHBOARD BUTTON**, like Sign-ups has had since v28. The
  busiest page in the LC sent people hunting for the sidebar. It follows the
  list you are looking at — filter Raising to IGV and it opens the IGV lane
  (IGT + a product pick lands on IGTa/IGTe), several picks or none opens the
  viewer's own default lane.
  ④ **v33.49's explanatory line under the KPI row is gone** by request. The
  same fact still travels where it costs no height: each KPI card's hint names
  the date it counts, and the Help centre's "Read the dashboard" spells out
  the whole rule.

- **2026-08-15 · v33.49** — **THE DASHBOARD TELLS THE TRUTH AGAIN** (no
  migration). Reported from the floor as "almost all the numbers are wrong,
  and they were right until something changed". Two separate faults, one of
  them a year old and one of them two days old.
  ① **A DATE RANGE FILTERED ACCOUNTS BY THE DAY THEY WERE ADDED, AND THEN
  COUNTED EVERY OTHER KPI OFF THAT SHORTLIST.** `getDashboard` passed
  `from`/`to` straight into the accounts query as `accounts.created_at`, so
  "This month" really meant *on accounts added this month* — right for Market
  Research and wrong for all five cards beside it. A contact made today on a
  name imported in July, a visit booked this morning for an account added last
  sprint, a deal signed this week on a six-week-old account: none of them
  existed on the dashboard, while the member who did all three was looking
  straight at their own work counted as zero. **Measured in prod: 110 of the
  423 contact attempts made in August (26%) and 9 of the 36 visits booked
  (25%) sat on accounts created before August.** All ICX for August went
  **Contacted 285 → 390, Visits 25 → 34, Done 13 → 14** (MR, deals and opens
  unchanged — those were already on the right date). Every KPI is now counted
  on ITS OWN date, the rule the period reports (v33.45) and the TM directory
  (v29.4) already followed: MR = `accounts.created_at` · Contacted =
  `contact_attempts.created_at` · Visits = `visits.created_at` (the BOOKING —
  30 of the 36 live visits are booked for a different day, so `visit_date`
  would move the work into a sprint nobody had worked yet) · Visits done =
  `visits.visit_date` · Deals + opens = `deals.created_at`, per-member opens
  via that deal's allocations. **The unit is unchanged** — contacted/visits/
  done still count ACCOUNTS, because the strip under them is a funnel. The
  window is Cairo-anchored and half-open (it was naive UTC, losing the first
  2–3 hours of every range). Consequence worth saying out loud: the cards are
  five questions about the same days, not one cohort, so Contacted can exceed
  MR — a line under the KPI row says so, and each card's hint now names the
  date it counts.
  ② **THE SHARED CACHE WAS SERVING ONE TEAM'S ROWS AS THE WHOLE FUNCTION'S.**
  `dashboardCacheKey` carried the scope, the test-mode flag and the date range
  — but NOT the team filter, which the same read also applied. So a VP who
  picked a team cached that team's rows under the function's key, and for the
  next half hour everyone in that function (the VP included, after clearing
  the filter) was served a subset as the total. It has been latent since
  v33.6 and invisible because `refresh()` was dropping the entry on nearly
  every write — until **v33.46 (two days ago) made the cache actually hold**,
  which is exactly the "it was right until something changed". Fixed
  structurally rather than by adding one key: **the cached read is now
  FILTER-FREE** (the scope's whole account set) and date/team/member are all
  applied in JS, so no filter can disagree with the key again. A test pins the
  invariant.
  ③ **AND THE SNAPSHOT FRESHENS ITSELF.** v33.46 also left the dashboard
  frozen for up to 30 minutes with a Refresh button that could not touch it
  (`refresh()` calls `revalidatePath`, which module memory doesn't hear). The
  full read still happens once per TTL; every render now adds one small query
  — which accounts changed since the snapshot — and re-reads only those, so a
  new account, a reassignment or an archive lands immediately. Work numbers
  (contacts/visits/deals) are read live from their own tables and never went
  through that cache at all. Only a permanently DELETED account can lag, and
  it heals on the next full read. **`refresh()` still does not clear it** —
  that was the whole point of v33.46 and would put the 4,000-row read back on
  ~94 call sites.
  ④ The funnel model — lanes, per-product opens and the date each KPI is
  judged on — moved out of `getDashboard` into **`src/lib/dashboard-funnel.ts`**,
  pure and unit-tested (`tests/dashboard-funnel.test.ts`). It was the logic
  that had been wrong for a year and the only way to check it was to look at
  the dashboard and believe it. **242 tests.** Help center + the Blue Man
  updated with what a date range means (and the Blue Man's "auto-refreshes
  every ~30s" line, untrue since v33, was corrected).

- **BACKFILLED 2026-08-15** — v33.45–v33.48 shipped **without updating this
  file or the Help center**, against the ship rule at the top. The four
  entries below are reconstructed from their commits; v33.46 in particular is
  the release that made the dashboard fault above visible, and nothing said
  so anywhere a reader would look.
  - **2026-08-14 · v33.48** — **STOP POSTING MAIL INTO A MAILBOX WE KNOW IS
    DEAD.** `sendEmail` only throws when the HANDOFF fails, so a bad address
    "succeeds" and the bounce arrives minutes later — the CRM was reporting
    "The IR got an email 📧" for a reschedule request sent to an address
    already flagged as bounced (the Tyumen call). `requestIrReschedule` now
    checks `email_bounced_at`, records the request but WITHHOLDS the mail, and
    says plainly that the IR has not heard. And `updateIrBookerEmail`, which
    re-sent the invite and confirmation but never the pending reschedule, now
    delivers that too — one extracted sender, so the two can't drift.
  - **2026-08-14 · v33.47** — **THE AUDIT** (migration **0062 applied**).
    Three objects had no RLS at all — `function_settings`, `lc_partnerships`,
    and `accounts_pipeline` as a SECURITY DEFINER view (the whole account
    pipeline, running as its owner). Not an active leak (the anon key is never
    used by the app and never reaches the browser) but the defence-in-depth
    layer was believed complete and wasn't. Also revoked anon/authenticated
    EXECUTE on `bump_rate_bucket` and pinned `search_path` on both SECURITY
    DEFINER functions. `touch-point-feedback` was missing from the health
    page's cron list; the dead `goal-reminders` row was dropped. And the OGX
    peak filter read `signed_up_at` two ways four lines apart (a raw
    `.slice(0,10)` vs `signupDayIso`) — 14 rows are "M/D/YYYY", which the
    slice hands back unchanged, so `"8/13/2026" < "2026-08-01"` sailed past
    the cutoff whatever year they were from.
  - **2026-08-14 · v33.46** — **THE TWO CRONS COME OFF VERCEL, AND THE
    DASHBOARD CACHE FINALLY HOLDS.** Visit reminders + sheets export moved to
    GitHub Actions (`runVisitFollowups` lifted into
    `src/server/cron/visit-followups.ts`; both routes stay as the manual
    handle); reminders drop to every 30 min in working hours, so the +2h
    follow-up can arrive up to half an hour later and nobody gets reminder
    mail at 3 AM. ⚠️ The pg_cron twins were left scheduled — unschedule them
    once each Actions job has run green. The dashboard read moved from
    `unstable_cache` into module memory because `revalidatePath("/", "layout")`
    is Next's documented "revalidate ALL data" and had been dropping the entry
    on every write since v33.14. **This is the release that made ① and ② of
    v33.49 visible**; see there.
  - **2026-08-14 · v33.45** — **THE CALENDAR TELLS THE TRUTH.** Visits were
    credited to the wrong sprint: `buildFunctionReport` counted BOTH "Visits"
    and "Done" on `visits.visit_date`, so work booked on the 13th for the
    16th–18th moved into a sprint nobody had worked (report said 2, directory
    said 5). Booked and done are two queries on two dates now. The same
    function bounded its window with naive UTC strings against a CAIRO sprint,
    losing 2–3 hours off each end. `fmtDateTime`/`fmtTime` were pinned to
    Africa/Cairo (server renders ran 2–3 hours slow and anything after Cairo
    midnight was dated the day before), and `fmtDay()`/`cairoToday()` replaced
    the four privately-written copies of the same helper. Booking-page
    warnings moved from the card header down to the control they blame.

- **2026-08-13 · v33.44** — **THE SILENT FAILURES BATCH** (no migration).
  ① **A VP CAN STEP OFF THE VISIT CALENDAR** (`visitInviteLeaders`, Function
  defaults, **ON by default = exactly the old behaviour**). v33.38 let them
  leave the announcement EMAIL, but every visit still landed on their Google
  Calendar as an invite — for a busy function that is the noisier of the two.
  OFF and only the responsible + their Team Leader carry the event; the
  leader still sees everything on Sodio's own calendar.
  ② **THE RESET FINDS THE BACKUP GMAIL.** `requestPasswordReset` looked the
  member up with `.ilike("email", …)` — the AIESEC column ONLY — so somebody
  whose @aiesec.net hasn't arrived (exactly who `fallback_email` exists for)
  typed the address they actually own, matched nothing, and got the same
  reassuring "check your inbox" as everyone else while nothing was sent.
  `issueTempPassword` had always been willing to send there; only the lookup
  was missing. Both columns are searched now, ILIKE metacharacters are
  escaped (`_` is legal in a local part and would have matched somebody
  else), and TWO members sharing one backup address sends to neither.
  ③ **THE BOOKING CARD SAYS WHY NOBODY CAN BOOK YOU.** A consideration
  member's schedule END DATE had passed; her link read "Live", her hours
  were all still there, and it offered nothing — indistinguishable from a
  quiet week. `bookingIssues` now names every silent emptier: switched off ·
  schedule ended · schedule not started yet · no hours · hours only on dates
  that have gone — and, when every setting looks fine, it asks the real slot
  builder and reports "live but no free slot" (booked out, the daily cap, or
  the minimum notice). Rendered OUTSIDE the collapsible body so it can't be
  missed. ⚠️ Prod at ship time: **Hana Aboud**'s schedule ended 2026-08-09,
  **Habiba Taher**'s link is switched off, **Omar El-Saied**'s ends
  2026-08-14 — all three now see it.
  ④ **GOOGLE SIGN-IN ALWAYS SHOWS THE ACCOUNT PICKER** (`prompt:
  "select_account consent"`). Mamoun's first sign-in died on Google's own
  consent page — a 401 "malformed request" with `authuser=1` in the URL and
  "Can't sign in to mamoun55@aiesec.net: Request canceled" — while his phone
  sign-in worked. With `consent` alone Google reuses whatever account context
  the browser is already in, which is what that `authuser=1` is; the picker
  removes the ambiguity and also stops a member approving with a personal
  Gmail no membership row matches. The login page's two error messages now
  say what to actually do.
  ⑤ **ONBOARDING ON A PHONE**: `min-h-dvh` instead of `min-h-screen`,
  top-aligned below `sm` (a centred card taller than the visible viewport is
  the classic un-scrollable clip), `p-5` on small screens, and the membership
  record's grid track is `minmax(0,1fr)` with breakable values. And the base
  `Input` now uses a MINIMUM height rather than a fixed `h-9`: identical at
  default settings, but an Android phone with a large system font grows the
  box instead of pushing the text out of it. ⚠️ Honest note: the reported
  overflow did NOT reproduce at 360–375px in a headless mobile viewport
  (measured: zero overflowing elements, before and after), so this is
  hardening against the mechanisms that can produce it, not a confirmed fix.
  Help center: 3 article updates; the Blue Man teaches all of it. 213 tests.

- **2026-08-12 · v33.43** — **TOUCH POINTS GET A PLACE, AND THE BELL GETS
  QUIET** (migration **0061 applied**: `touch_points.location`).
  ① **NOBODY IS ANNOUNCED AS "BOOKED BY."** The invite, move and cancel
  emails led with "X booked a Y" and carried a Booked-by row; the bell body
  did too; the attendance history had a Booked-by column. None of it is
  news to the person being invited — the what, the when, the where and the
  audience are. The owner is still stored on the row and still records
  attendance; they just aren't announced.
  ② **AND THE ANNOUNCEMENT IS SMALLER**: the audience minus the person who
  just booked it (a bell about your own click is the definition of noise)
  and minus LCVPs/Directors/the LCP (a touch point is the floor's business
  and the calendar is right there). Being off the announcement does NOT
  remove them from the audience — attendance still covers them.
  ③ **A "WHERE" FIELD** (0061): optional, on every non-virtual touch point,
  printed in the invite and move emails and shown on the calendar cards. A
  virtual meeting's "where" IS its Meet link, so the field hides there. It
  used to live in the note or nowhere.
  ④ **"🙏 CAN'T MAKE IT?" — THE EXCUSE THAT ARRIVES IN TIME.** Attendance
  could only be argued with AFTER the fact (the appeal is a post-mortem), so
  someone who knew on Tuesday that Thursday was impossible had nowhere to
  say it. `excuseMyAttendance` lets anyone in an upcoming touch point's
  audience file it themselves: it emails the WHOLE TM function
  (`tmFunctionEmails`, falling back to the leads) while the room can still
  be planned, bells the person who will record it, and writes their own row
  as late/absent + **excused** — which the recorder can still change. It
  refuses once the session has started or attendance is taken; that is the
  appeal's job.
  ⑤ **THE BELL STOPS TALKING TO YOU ABOUT YOURSELF.** `notifyMembers` now
  drops the actor from every recipient list — one guard, so no future caller
  has to remember. Prod said it plainly: **24 of the last 34 "Visit booked"
  bells went to the person who had just booked the visit**, and four touch
  points belled their own booker.
  ⑥ **THE PANEL IS SCANNABLE**: icon + headline on one line with a short
  "2h ago" (the exact timestamp on hover), the body clamped to two lines
  (the detail lives on the page it opens), and the duplicated "Open →" gone.
  521 visit announcements in seven days is what made the list unreadable —
  v33.42 narrowed that audience, and this makes what's left legible.

- **2026-08-12 · v33.42** — **WHO HEARS ABOUT WHAT** (no migration).
  ① **WORKING HOURS: THE ENGINE SUGGESTS, IT NEVER RECORDS.** It wrote real
  attended/absent rows — on the nightly cron AND again when the sheet was
  opened — and those rows counted in every history and stat while no human
  had confirmed a thing. "Automatic attendance" has to mean a form filled in
  for you, not a record. `loadAttendanceSheet` now pre-SELECTS each row from
  `workingHoursVerdicts` **in memory** (new `suggested` flag, a blue
  "suggested" badge), and `saveAttendance` stays the only writer; the cron
  stopped calling the engine entirely and just chases the human, which was
  always its job. The writer (`runWorkingHoursAttendance` via
  `computeWorkingHoursAttendance`) had no UI left after v33.17 and is gone.
  ⚠️ Checked prod first: the only 42 engine rows belong to two sessions a
  human DID confirm, so they are legitimate and were left alone.
  ② **VISIT ANNOUNCEMENTS REACH THE PEOPLE WHO ANSWER FOR THE VISIT** (the
  LCP's ask — the whole function was being mailed for every event, moves
  included). `resolveVisitRecipients` takes a `kind` now: a **new booking**
  goes to the function's **Members** + the responsible's own Team Leader
  (the other MMs are off it — another team's TL has no call to make about
  this visit); a **move** goes to the responsible's Team Leader alone, and
  to **nobody** when an MM moves their own. LCVPs/Directors keep the v33.38
  opt-in (`visitAnnounceLeaders`) and ride the calendar invite regardless.
  The pending-visit lookup moved above the resolution so the kind is known
  before the audience is built.
  ③ **THE RATING NUDGE ASKS THE FLOOR.** The evening touch-point-feedback
  email and bell now skip LCVPs/Directors/the LCP — rating a session is the
  floor's job, and a leader can still open Feedback and rate any touch point
  they were part of. And **TM rides the CC on LC-scope points only**: a team
  meeting's rating is not TM's inbox to carry.
  ④ **THE TEST VIEW IS ONE TAP FROM ANYWHERE** (`test-view-button.tsx`): a 👁
  beside 🛠️ Report (top-right on desktop, by the bell on phones) opens a
  searchable picker over `listViewAsTargets` — which already gates on the
  admin capability and returns [] for everyone else, so the button simply
  doesn't render for them. Sandbox mode, same `startViewAs` call the profile
  card makes. The question "what does a Member see HERE?" is asked on the
  page you are looking at, not on the profile.
  ⑤ **AN OGX MM'S LINE IS THEIR OWN WORK.** The MM board rolled their
  members' sign-ups into their row (v33.14), so it answered the question the
  TEAM drill already answers and hid what the MM personally carries. Their
  own rows now, nothing else.
  ⑥ **THE has/no-MEET-LINK FILTER IS GONE.** Verified against prod: all 44
  IR calls — scheduled and completed — carry a Meet link, because every
  booking creates the event (owner calendar, else the IM mailbox). A call
  without one would be a bug to fix, not a view to offer.
  Help center: 4 article updates; the Blue Man teaches all of it. 213 tests.

- **2026-08-12 · v33.41** — **THE EMAILS TAB OPENS & REFERRALS BECOME
  EDITABLE** (no migration).
  ① **/emails BELONGS TO EVERY MEMBER.** `canUseMailboxTab` was MMs-and-above
  on the theory that writing for the LC is an MM's job — which in practice
  sent members back to a blank Gmail with no signature, which is the exact
  thing the tab exists to stop. The letter still goes out from their OWN
  Gmail (Sodio is the stationery, not the sender), so nobody gains reach they
  didn't have; they gain the layout, the real signature and a starting point.
  ② **THE STARTING POINTS ARE PER PERSON** (`MailAudience` + `templatesFor`
  in `email/compose.ts`, resolved on the page from what the viewer actually
  DOES — `hasRaisingAccess` / `hasConsiderationAccess` / OGT-OGV / `isB2C` /
  `isTmCore`, LCP-admin see all): raising → the company pitch, the follow-up,
  the thank-you · OGX → **Reaching a sign-up**, **Nudging a quiet EP**, and
  the contract mail (`mmOnly`) · consideration → writing to another LC and
  **Asking an LC for CVs** · B2C → **Offering to a customer** · TM →
  **Inviting the team**. Everyone keeps Blank. Five new templates.
  ③ **GROUP BLASTS STAY AN MM's TOOL.** `listEmailGroups` handed out
  "Everyone in the LC" on one click — reach a plain member never had, and the
  fastest way to make the tab something people mute. Below MM the list is now
  their own team + their function(s); MMs and above keep the whole set.
  ④ **A REFERRAL'S DETAILS ARE EDITABLE** (`updateReferralDetails`): every
  field on a referral is typed by the member who logged it, yet
  name/phone/email/DOB were write-once and country/sub-product sat behind the
  VP gate — so the person who typed a country could never fix it ("it refuses
  to change"). Whoever may WORK the row now corrects it, with the creation
  form's own validation (name ≥2, phone normalized, email shape, DOB a real
  date, country resolved against COUNTRIES, and the phone-or-email pair rule
  surviving the edit). The VP gate stays where it belongs — on TRACKER rows,
  whose columns the sheet owns and where a free-for-all would fight the
  import. New **Edit details** card on the sign-up.
  ⑤ **IR CONFIRMATIONS: THE AIESEC ADDRESS OR NOTHING.** v33.40 sent the
  confirmation from the host and fell back to the mailbox with the host on
  Reply-To — but the fallback chain reached `fallback_email`, the backup
  PERSONAL Gmail we keep only for password resets. A partner entity abroad
  must not end up writing to someone's private inbox: `aiesecAddress()` gates
  both the host-send and the Reply-To on an @aiesec.net(.eg) address (all 32
  live grants already are one).
  ⑥ **THE SCHEDULED IR-CALL LIST SORTS AND NARROWS**: sort by soonest /
  latest / partner LC / who takes it / just-booked, and filter by **When**
  (today · next 7 days · still ahead · ⏰ time passed, on Cairo days) and by
  what it **Carries** (⚠️ bounced · has a Meet link · no Meet link · their
  note) — on top of the existing Mine / With / LC / Product chips.
  ⑦ **THE AUTO-CLAIM RULE, CONFIRMED AND PINNED** (the ask: "I meant
  unassigned account — if it's one of her members' or anyone's, the
  assignment doesn't change"). That is what shipped: `logContact` claims only
  when `responsible_id` is null, and `isClaimableAccount` refuses an owned
  row a second time. Verified in prod (zero reassigns since v33.39) and now
  test-pinned — a TL contacting their member's account leaves it theirs.
  213 tests. Help center: 4 article updates; the Blue Man teaches all of it.

- **2026-08-12 · v33.40** — **CROSS-FUNCTION SHEETS, THE GRANT NUDGE & LOUDER
  PLUMBING** (no migration).
  ① **CROSS-FUNCTION ATTENDANCE RECORDS PER SLICE.** A touch point that
  invites another function put that function's people on a sheet only the
  BOOKING function's leader could fill. Now `canRecordAttendance` folds
  `invited_functions` into the gate and a new per-row predicate —
  `canEditAttendanceRowOf`, authority follows the MEMBER — lets each
  function's MMs and VPs/Directors set exactly their own people's rows
  (compared on REAL functions only: a shared sub-function label like
  "Raising" is not shared authority). The booking crew can't fill the
  invited slice and vice versa; TM/LCP keep the whole sheet; rows outside
  the recorder's reach render locked and are silently skipped on save, like
  own rows before; the sheet confirms once every slice is in. 5 new rbac
  tests (211 total).
  ② **THE GOOGLE-GRANT NUDGE** (`google-grant-banner.tsx`): 7 live members
  have an @aiesec.net that landed AFTER they started — they sign in by
  password and have been working with NO Google grant (no calendar events,
  no Gmail drafts) with nothing telling them. A banner on every page now
  asks them to sign in with Google once (the existing `loginWithGoogle`
  flow); dismissing snoozes it for a day, and it lives until the grant
  exists. Never shown in a test view.
  ③ **RENAMES TRAVEL TO THE CALENDAR** (the Mamma Mia case: renamed in
  Sodio, still "Mamma mia" on the calendar). `renameAccount` now patches the
  pending visit's event summary — owner calendar first, mailbox calendar as
  the fallback (new lean `renameVisitEventSummary` /
  `renameMailboxVisitEventSummary`, summary-only patch, no re-invites) —
  and re-runs `syncNextStepReminder` so the follow-up event carries the new
  name AND the new slug link. Mamma Mia's live event was patched in prod;
  the audit shows no other rename left a stale event.
  ④ **THE BOUNCE ALERT THAT NEVER REACHED DAI, ROOT-CAUSED.** The 15:30 cron
  belled her and logged success — but the alert EMAIL never existed: the
  host lookup failed transiently and `if (!host) return` swallowed it
  without a log (my own first replication hit the same transient null —
  QED). `alertHost` now retries the lookup once, logs every early return
  AND every success, and a host with NO inbox at all gets the alert
  delivered to the consideration leadership instead. Dai's alert was
  re-sent by hand from the replication script.
  ⑤ **IR CONFIRMATIONS COME FROM THE HOST.** The booking confirmation (and
  the fix-email re-send) goes out from the member's OWN Gmail when their
  grant allows — the IR holds a real person's address and replies reach
  them. No grant → the mailbox sends it with the host on **Reply-To**
  (`sendEmail` learned the header). A dead grant falls back to the mailbox
  rather than losing the mail; the synchronous-bounce flag is unchanged.
  ⑥ **THE CALL LOG SORTS THE WHOLE HISTORY**: When / Partner LC / Product /
  By / Status / Booked-by headers sort server-side (`IR_SORTS` whitelist in
  `listIrCalls`, `?callsort/&calldir`); the other columns keep the
  page-in-hand client sort. New **Carries** funnel: has notes · has
  screenshot · has a CV-pool link · email bounced — OR'd server-side.
  ⑦ **THE COUNTRY LIST RIDES A PORTAL.** The v33.39 `rise-in` fix wasn't the
  (whole) trap — some ancestor stacking context kept painting the CV tab's
  table header over the suggestions. `CountryInput` now portals the list to
  `<body>` (fixed-position at the input's rect, re-measured on
  scroll/resize) — the same reason Radix portals every popover — with
  `pointer-events: auto` against the dialog body lock and a
  `data-country-list` marker the dialog's outside-click guard recognises.
  ⑧ **THE CONTRACT TEMPLATE'S OWN FORMATTING**: the doc's HTML export shows
  EP / ID / END and the whole "Attach student id…" line in bold — the
  template now carries exactly those, nothing else.
  Help center: 6 article updates; the Blue Man teaches all of it.

- **2026-08-12 · v33.39** — **THE CORRECTIONS BATCH ON v33.38** (migration
  **0060 applied**: `ir_booking_settings.max_per_day_overrides`).
  ① **WORKING AN UNOWNED ACCOUNT TAKES IT** (the Shahd case: she contacted
  unassigned MR rows and two leaders spent their evening reassigning them to
  her by hand). `logContact` on an unassigned account now claims it FIRST —
  through the real reassign path, cross-function move included — and the
  toast says so with an **Undo** button (`undoAutoAssign`: only the current
  responsible, back to the pool, the contact stays). The "Visit Scheduled"
  result stopped needing a pre-assigned responsible for these rows: the
  claim happens before the check.
  ② **THE STREAK CAN'T BE GIFTED** (the abuse found in prod: referrals logged
  by one member with Contacted=Yes pre-filled, ASSIGNED to others just after
  midnight — the assignee's flame saved without them touching a phone).
  `addSignupReferral` now writes the contact log under the LOGGER, and
  `streakStats` counts a referral row only when the ASSIGNEE has their own
  contacted log on it — everything else keeps reading the live data, so
  undoing all of today's contacts still un-saves the day.
  ③ **PER-WEEKDAY IR CALL CAPS** (0060): "3 a day, but Sunday only 1" — a
  JSONB override map beside `max_per_day`, a mini per-day row on the
  availability card, honoured by the slot builder AND both booking-time
  validators (the public book + reschedule paths re-read it).
  ④ **PARTNERSHIPS, ROUND TWO** (the v33.38 gaps): a **global 🎯 Set a
  target** button — pointing at any LC or a brand-new one created in the
  dialog (`assignLcPartnership` learned `newLc` via `resolvePartnerLc`);
  the record form gained **"Counts for"** so an MM records a member's win
  onto the member's numbers (validated by the same matrix as assigning, the
  member is belled); **IR CALLS BLOCK PARTNERSHIPS PER PROGRAMME** — an LC
  with GT calls IS a GT relationship, so record/target stand down on GT
  (`callProducts` derived from non-cancelled calls only; server refusals in
  both actions via `lcAlreadyCalled`; a pending target whose programme gets
  called shows "hand it back"); **WHO WORKS AN LC** is derived from its
  calls — each caller + their Team Leader — shown on the card and filterable
  (👥 Assigned to); and a **function default (IGV/IGT)**,
  `partnershipCrossTeam`, lets TLs hand targets across teams (off = own
  team only, the same matrix server-side via the TL's own function settings).
  ⑤ **"COME BACK ANOTHER TIME" GREW A TIME** — both fields visible, both
  optional: date alone = a next step for that day (the silent 11:00 booking
  is gone), date + time = a REAL booked return visit with the calendar
  event, neither = a next step to pin down later. The helper line says
  which of the three you're about to do.
  ⑥ **THE STACKING-CONTEXT BUG** (the screenshot: the CV tab's country
  suggestions rendering UNDER the table header). `rise-in` used
  `animation-fill-mode: both`, which retains the final `translateY(0)`
  forever — and a retained transform makes every risen card a permanent
  stacking context, trapping its dropdowns below later siblings. The final
  keyframe IS the natural state, so `backwards` gives identical visuals
  with no trap. Same fix on `.stagger`.
  ⑦ Smaller, same batch: the **"Take it — it's mine now"** verdict button
  (and its revive/unblock siblings) shows a spinner and disables while it
  runs; **copy-name** buttons on the account page title and the archived
  tab (shared `copy-name-button.tsx`); the LC **Country** field dropped its
  "(optional)" tag; the **"Signing the contract"** template is the LC's own
  doc **verbatim** (recovered from the transcript, greeting and rewrites
  removed); and the flaky DNS test got a budget for its own fail-open path
  (two 2.5s aborts brush vitest's 5s default with no network).
  Help center: 7 article updates; the Blue Man teaches all of it. 206 tests.

- **2026-08-11 · v33.38** — **RENAME, FUNNELS & THE PARTNERSHIPS MODULE**
  (migration **0059 applied**: `lc_partnerships`).
  ① **ACCOUNTS CAN BE RENAMED.** A typo in the name used to be forever (the
  fix was archive + re-add, which burned the history). The ✏️ beside the title
  opens a rename dialog — open to ANYONE who may edit the account — running
  the SAME world-aware live check as adding (`checkAccountNameLive` grew an
  `excludeId` so the account's own row never blocks it; `useAccountNameCheck`
  threads it through). `renameAccount` re-checks server-side, maps the 23505
  race, writes a "✏️ Renamed from … to …" comment and audit row, and the UI
  says out loud that the LINK changes with the name (slug = name; old links
  resolve by UUID).
  ② **EVERY RAISING COLUMN HAS A FUNNEL.** Industry, Type (ACCOUNT_TYPES,
  B2C_TYPES for the B2C world), Proposal (sent / not sent), Deals (has /
  none) and Podio (requested / not requested / Checking / Approved /
  Rejected — two columns OR'd by hand, since `.in` can't span them) filter
  from their column headers, server-side and comma-aware like the rest;
  two-state funnels treat both-picked as no filter. Type + Industry are also
  mobile chips.
  ③ **VISIT ANNOUNCEMENTS SKIP THE LEADERS BY DEFAULT** (the LCP's ask): the
  function-wide "visit booked" email already had a second copy riding the
  calendar INVITE for every LCVP/Director — `resolveVisitRecipients` now
  drops them from the announcement unless the function's own defaults say
  otherwise (`visitAnnounceLeaders` in `function_settings`, a new switch on
  the Function-defaults card: "Visit announcements reach me too", default
  OFF). The crew's announcement and the calendar invite are untouched.
  ④ **THE 🛠️ FEEDBACK BUTTON MOVED HOME**: beside the refresh button on
  desktop (top-right) and beside the bell in the phone top bar — the
  bottom-left FAB is gone (`FeedbackButton` replaces `FloatingFeedback`).
  And the form's two selects stopped jamming into each other: the long
  labels overflowed their grid track (`min-w-0` + full-width triggers).
  ⑤ **THE STREAK BOARD RANKS BY THE STREAK** (the Amr case, confirmed by the
  LCP): longest streak first, saved-today only breaks ties — a ⏳ grace-day
  row with the longest streak stays on top (it dies only if today ends
  without a contact). The ⏳ label still says it isn't saved yet.
  ⑥ **THE SIDEBAR FOOTER IS STATIC**: profile block, theme/bell buttons and
  the credit are pinned; only the NAV list scrolls (`overflow-y-auto` moved
  off the aside/drawer onto the nav). Short screens stop burying the sign-out.
  ⑦ **🤝 THE PARTNERSHIPS MODULE** (0059, `lc_partnerships` — one row per
  LC × product with a partial unique index, so the same LC can be a NEW GT
  partnership while an old GV one). Approaching a new LC and opening the
  WhatsApp group IS the partnership: `recordLcPartnership` (any
  consideration member) takes the LC — existing or created on the spot via
  `resolvePartnerLc` — the programme (defaults to the member's own side),
  the date (default today Cairo, never future) and the anchoring IR (name
  required; WhatsApp or email, at least one), refuses a programme already
  made, writes the IR into `partner_lc_contacts` best-effort, and journals
  for undo. **Targets**: `assignLcPartnership` (MM+: TL → own team,
  Coordinator → self, VP/Director/LCP → the whole crew via
  `listConsiderationCrew` — targets are Members/Coordinators/TLs only)
  files a `pending` row, bells the member AND their Team Leader, and shows
  as an amber 🎯 chip on the LC card + a "Your partnership targets" banner
  for the assignee ("Record it" prefills the form; "Hand it back" clears —
  `clearLcPartnershipTarget`, assignee/assigner/VP, the CIC lesson).
  **Completing a pending target ALWAYS credits the member it was assigned
  to** (`made_by = assigned_to ?? recorder`), belling them when a leader
  filed it on their behalf. The registry gained a 🤝-partnered filter and
  green per-product partnership chips (date, maker, IR on hover);
  `considerationStats` gained `partnerships` {total · thisMonth · pending ·
  byMember} counted per the row's OWN product tag (the 0048 lesson) and
  honouring the filter bar (member/team on the maker, dates on the
  partnership's own day) — rendered as two lane KPIs + a by-member strip.
  ⑧ A stale rbac test pinning the pre-v33.37 claim rule was updated (a
  Member CAN claim one unowned account; the pool stays hidden — 206 tests).
  Help center: new 🤝 article + 6 updates; the Blue Man teaches all of it.

- **2026-08-11 · v33.37** — **FOURTEEN FROM THE FLOOR** (migration **0058
  applied**: `ir_booking_settings.max_per_day`). Shipped the batch that had
  been sitting uncommitted in the worktree, finished and verified.
  ① **STREAKS TELL THE TRUTH.** Only a sign-up marked **Contacted** that day
  saves a streak (the card and the nag no longer promise that comments and
  claims count — they never moved `contacted_at`); sheet-cased "yes" counts
  (`ilike y%`, the reader every other feature uses); and the board carries a
  **⏳ not saved today** label on grace-day rows (dimmed, ranked below the
  saved ones) — an alive-until-midnight streak no longer masquerades as a
  saved one. Dead streaks were never on the board; ambiguity was.
  ② **THREE CONTACT STATES ON SIGN-UPS.** The Contacted filter offers
  Yes · No · **Not contacted yet** (null/empty — the pile nobody has touched);
  rows wear the state as a coloured left edge (green = Yes, amber = No,
  plain = untouched).
  ③ **"TAKE IT — IT'S MINE NOW."** The add-form's unowned-duplicate verdict
  claims the account on the spot. `isClaimableAccount` now covers Members
  (claiming one account they researched takes nothing from anyone — the POOL
  stays Coordinator+), which also lets them OPEN an unassigned account; the
  old flow sent a Member to a page that answered "no access".
  ④ **DIRECT VISITS, THREE FIXES.** An **archived** name met at the door no
  longer blocks the log: any let-them-in outcome REVIVES the account to the
  visitor (a Member too — the visit is the evidence), while *turned away*
  keeps it archived and writes the attempt on it as a comment.
  **Come back another time** takes an optional date AND time — dated =
  a real `scheduleVisit` booking with the calendar event; undated = a next
  step to pin down later. **Turned away at the door writes NO `visits` row**
  — reception blocked it, so nothing lands in visit KPIs; the contact attempt
  and comment remain.
  ⑤ **THE DIALOG-CLOSES-WITH-THE-DROPDOWN BUG.** With a Select open, Radix
  disables pointer events on everything else, so a click on the dialog's own
  body targets `<html>` — outside BOTH dismissable layers — and closed the
  dialog along with the list. While any popper is open, that click now has
  exactly one job (the dialog's onPointerDownOutside preventDefaults).
  ⑥ **IR BOOKING: A DAILY CAP + LONGER BUFFERS** (0058): `max_per_day` 1–6
  (or no limit) — a Cairo day already holding that many scheduled calls stops
  being offered on the public page (counted from the same busy list as the
  overlap check); buffers now go to 60/90/120 minutes.
  ⑦ **THE EMAILS TAB ABSORBED TWO DOORS**: the **Expectation mail** sidebar
  tab is gone — it's a button on the Emails tab (same /ogt-mail gate; the
  route survives for old links) — and a **"Signing the contract"** template
  (OGX MMs+, from the LC's own doc) prefills the subject, the six signing
  steps and the student-ID ask, auto-CCs customer.support@aiesec.net.eg
  (templates can now carry a `cc`), with multi-file attachments as ever.
  ⑧ **REPORT IT FROM WHERE IT BROKE**: a floating 🛠️ button (bottom-left,
  every page — The Blue Man owns the right) opens the system-feedback form in
  a dialog and attaches the page the reporter was on. Multi-CV upload rides
  along in consideration (pick a folder's worth; each becomes its own row).
  Help center (7 articles) + the Blue Man updated with all of it.

- **2026-08-11 · v33.36.2** — **THE UNREPORTED-VISITS BANNER NEVER APPEARED**
  (no migration).
  ① **`done` IS NULLABLE, AND THE BANNER ASKED FOR `false`.** v33.35 shipped
  "N visits need a report" on Raising and it matched **zero rows**, because a
  pending visit is `done IS NULL` — nothing in the system ever writes `false`
  (reporting a visit sets it TRUE; the index `visits_pending_idx … where done
  is null` says so). Every other reader — the +2h prompt, the week-later nag,
  the account page — uses `is null`; only the new banner didn't. Worse, the
  SQL I checked prod with made the same assumption, so "0 unreported visits"
  read as good news when **13 were sitting there** (Aug 6–10, IGV/IGT/BD,
  eight different owners). One character of a filter, invisible for a
  release. Fixed, and the banner now shows the real thing.
  ② **AND THE +2H PROMPT WAS SKIPPING HALF THE LC.** Chasing the same 13
  explained why almost none carried `followup_prompt_sent_at`: both passes of
  the visit-followups cron start with `if (… || !visit.member?.email)
  continue` — a member with no @aiesec.net got **no email, no bell, and no
  stamp**, which also means the one-week nag (it requires the stamp) could
  never fire for them. Many members are still waiting for their AIESEC
  address. Now: the backup Gmail is used when there's no AIESEC one, the
  in-app BELL goes out either way (it needs no inbox), the stamp lands so the
  ladder proceeds, and both bells deep-link to the account.
  ③ **THE TM DIRECTORY FILTERS FROM ITS COLUMNS.** Function/Role/Side were
  three dropdowns in a bar while every other table in Sodio funnels from the
  column itself. Now every column does, and multi-select: **Role** (with a
  one-tap "MMs"), **Function**, **Sub function/side**, **Team**, **Manager**,
  **MOS class** (opens / money / deals / approvals / none), **has-or-no
  email**, **has-or-no phone**, **has-or-no market research**, **has-or-no
  deals**. Options are built from the people on screen, so a funnel can never
  offer a value nobody has; phones get the same funnels in a row above the
  cards; search, the date window (which recounts KPIs server-side) and ⚙
  Columns stay in the bar, plus a Clear.

- **2026-08-11 · v33.36.1** — **THE SAME ADDRESS IS A RETRY** (no migration).
  ① The Bhavika case: her Gmail bounced for reasons on HER side, got fixed
  there, and the address was right all along — but `updateIrBookerEmail`
  refused the identical email ("that's already the email on the booking"),
  leaving no way to try again. Re-submitting the SAME address is now a
  RETRY: the bounce flag clears, the calendar invite is re-issued and a
  fresh confirmation goes out. The calendar half needed its own trick: a
  PATCH that ends with the identical attendee list is a no-op to Google, so
  `swapIrCallAttendee` now removes the attendee QUIETLY (sendUpdates none)
  and re-adds them LOUDLY — the only email the IR receives is a fresh
  invitation. The fix-email UI says so ("was the address right all along?
  keep it and hit the button"), the bounce chip stops claiming "the address
  doesn't exist" (it says the last email came back), and the audit logs
  `ir_call_email_retry` vs `ir_call_email_fix`. Bhavika's own call was
  retried in prod (invite re-issued, confirmation re-sent, flag cleared)
  before her 2:30 PM call.
  ② **THE BLUE MAN'S KNOWLEDGE WAS AUDITED** (prompted by him teaching the
  "Podio pending worklist" — removed in v32.3 — as current). Seven stale
  claims fixed in `assistant.ts`: the worklist is gone (the 🔎 Needs-Podio
  flag is the queue); B2B and BD are separate dashboard lanes (v32.6);
  dashboard lanes are named per SIDE (v32); the calendar bullet described
  the v12 visits-only calendar (it is the ONE calendar with kind/scope/
  function filters); partner-LC renaming is MMs+ (v29), delete stays VP+;
  the working-hours rule includes the 5-action burst (v33.18); B2C's
  cadence default is 14 (function setting since v33.32) not 10; and the
  booking page's zone follows the CONNECTION since v33.35. The same-address
  retry was added to his knowledge and to the help center's bounced-email
  article. Example copies of the bounce-alert and the post-fix confirmation
  were sent to the IM mailbox for review.

- **2026-08-11 · v33.36** — **THE PLAYBOOK BECAME A HELP CENTER** (no
  migration).
  ① **/help** replaces /playbook (which redirects forever — old links in
  emails and heads keep working; the sidebar tab is now **Help**). The
  playbook was one long page you scrolled; this is a help center you ASK:
  a hero search box, nine topic categories, ~58 task-first articles, FAQ
  accordions, and The Blue Man wired in as the AI layer — every screen
  carries an "Ask The Blue Man" card, and a search with no results offers
  asking him THAT question.
  ② **CONTENT IS DATA, NOT JSX** (`src/lib/help-articles.ts`): every article
  is plain JSON — id, category, audience keys, bilingual keywords, summary,
  and typed blocks (paragraph · numbered steps · callout · table · FAQ ·
  diagram). That is what makes it searchable, renderable and — the real
  point — fact-checkable and regenerable without touching the machinery
  (`help-content.ts` = types/categories/search, `help-view.tsx` = the UI,
  `help-diagrams.tsx` = six hand-drawn theme-aware SVGs: the raising
  pipeline, the OGX funnel, IR booking, a visit's life, the who-sees-what
  pyramid, a touch point's life).
  ③ **SEARCH SPEAKS BOTH LANGUAGES**: diacritic- and hamza-folding
  normalisation (أ/إ/آ→ا, ى→ي, ة→ه, NFKD + combining-mark strip) so either
  spelling finds the article; scoring ranks title > keywords > summary >
  body with snippets; URL-driven states (?q= ?c= ?a=) make every search,
  category and article SHAREABLE — paste /help?a=forgot-password in a group
  chat and it opens right there.
  ④ **ROLE-AWARE, NOT ROLE-GATED**: a "For me" toggle filters to the
  viewer's functions/role (the playbook's sectionsForRole, generalised into
  audience keys), and category cards wear "That's you" — but nothing is
  hidden: knowledge is readable by everyone, the filter is a lens.
  ⑤ **HOW IT WAS WRITTEN**: a 12-agent workflow — nine writers each briefed
  on one area with the block contract and AI_CONTEXT.md as source of truth,
  then three fact-checkers hunting wrong routes/permissions/behaviour. They
  found 9 real issues (reset-password behaviour, who edits touch points,
  screenshot optionality, visit invites carry no Meet link, B2B/BD are
  separate lanes…), all fixed before shipping. `tests/help-center.test.ts`
  pins the contract: unique slug ids, valid categories/diagrams, every
  internal link resolves to a real route or article, no empty category
  card, search finds the obvious in both languages (206 tests total).
  ⑥ The ship rule's address moved: update **`src/lib/help-articles.ts`** (+
  `HELP_VERSION` in `help-content.ts`) with every release — same rule, new
  file. PLAYBOOK_VERSION is aliased to HELP_VERSION so nothing else moved.

- **2026-08-11 · v33.35** — **THE NAME, THE ASK, AND THE VISITS NOBODY
  REPORTED** (migration **0057 applied**: `touch_points.feedback_asked_at`).
  ① **"MEETING", NOT "FUNCTION MEETING".** The type was the scope fused to the
  kind, which stopped being true the moment v33.34 made the audience a list
  you pick: a "function meeting" is routinely six people out of thirty. The
  kind is now the name (**Meeting · Working hours · Outing**); where the
  audience STARTS is a separate question, and who actually comes is the one
  after it. Lists show `touchPointName` — "Meeting · IGV", plus "(6 invited)"
  when a guest list was picked — so two touch points still tell apart.
  ② **PICK BY THE GROUP, NOT ONE BY ONE.** Ticking thirty boxes to invite "the
  leaders" is a chore, so **Who's invited** carries one-tap chips for the
  groups the list actually contains: Leaders & MMs, Members only, and one per
  team present. Every chip is derived from the people in front of you, so it
  can never select someone outside the audience you were allowed to book.
  ③ **AND IT'S EDITABLE.** "Set at booking, never again" was the wrong
  default — people join, people drop out. The manage dialog loads the guest
  list on demand (`touchPointGuestList`) and saves it through
  `updateTouchPointMembers`, same subset-of-derived rule as booking. It stays
  QUIET (tidying a list the morning of a meeting must not mail twenty people)
  and LOCKS once attendance is recorded: that register was signed off.
  ④ **THE RATING GETS ASKED FOR** (0057 + the **touch-point-feedback** cron,
  19:00 UTC = 22:00 Cairo, scheduled in pg_cron and in supabase/cron.sql).
  v33.33 made session feedback a four-second tap that nobody was ever asked
  for, so almost nobody gave it — the feature existed and the data didn't.
  Every touch point that HAPPENED that day now gets one email in the evening:
  audience on BCC, **TM and the booker on CC**, funny, and honest about the
  size of the ask ("It is one tap. Five stars, pick one, done."). Once per
  touch point — `feedback_asked_at` — because an inbox that asks twice for a
  four-second job is an inbox people filter. A send that fails is left
  unstamped and retried tomorrow.
  ⑤ **UNREPORTED VISITS, WHERE THE WORK IS.** The +2h prompt and the one-week
  nag have chased these by email since v11, which works until someone stops
  reading email; in the app they were invisible, and an account sat at "Visit
  Scheduled" forever while the funnel counted a visit nobody can prove
  happened. Raising now carries the IR floor's banner: "N visits need a
  report", expandable to the account, the date, how many days ago and whose it
  is. Scoped identically — yours, your team's, your function's, the LC's — so
  a clean slate shows nothing.
  ⑥ **THE VPN QUESTION, ANSWERED IN CODE.** "I turned on a Singapore VPN and
  it still said Cairo" is the browser working as designed: `Intl` reports the
  MACHINE's zone, which a VPN never changes (Google Calendar behaves the same).
  v33.23 handled it with a "did you mean Singapore?" prompt; v33.33 removed
  the prompt at the LCP's request and left nothing. So the **connection now
  wins** when the two disagree — it is the one signal that moves when the
  person does — and the device zone becomes a one-tap way back
  ("Showing Singapore time — your device says Cairo. Use Cairo instead"), for
  the corporate-VPN case where the machine was right all along. Still no
  question asked. 3 new tests (197 total).

- **2026-08-11 · v33.34** — **PICK WHO IS ACTUALLY COMING** (migration **0056
  applied**: `touch_points.members`).
  ① **THE AUDIENCE WAS TAKE-IT-OR-LEAVE-IT.** A touch point's people have
  always been DERIVED — pick a scope and everyone matching it is invited,
  announced to, and marked present or absent. Right most of the time, wrong
  the rest: a function meeting the newest three members aren't in yet, working
  hours for half the team, an outing two people already said they can't make.
  There was no way to say so, so they were marked **absent from something
  nobody expected them at**. Booking now shows **Who's invited** — the derived
  list, ticked — and unticking anyone removes them from the invite AND from
  the attendance sheet.
  ② **IT CAN ONLY EVER NARROW.** `members` is an opt-out list, not a
  replacement rule, and the server validates every tick against the DERIVED
  audience — a Team Leader cannot reach a name outside the team they proved
  they own. Keeping everyone stores **nothing**, so the audience stays live
  and still picks up people who join the function before the session; that is
  both the default and the pre-0056 behaviour, and every existing row is
  unaffected. Unticking everybody is refused ("a touch point with nobody in it
  isn't one").
  ③ **ONE IMPLEMENTATION, TWO CALLERS.** The dialog can't be allowed to offer
  a list the create path would refuse, so the whole authority resolution
  (function ownership, team binding, invited teams/functions, the
  no-working-hours functions) came out of `createTouchPoint` into
  `resolveTouchPointTargets`, and both the new `previewTouchPointAudience`
  and the create path run it. The preview re-checks `canBookTouchPoint` too —
  it returns a roster, and a roster is not something to hand out on the
  strength of a scope string.
  ④ **THE OWNER RULE YIELDS TO THE LIST.** "The owner always belongs to their
  own touch point" is right when the audience is derived and wrong when the
  booker has just unticked themselves — a TL booking working hours for their
  team isn't necessarily in it. The explicit list sits ABOVE that rule in
  `memberInTouchPointAudience`, and `touchPointAudience` stops appending the
  owner when one exists. Visibility is a separate question
  (`viewerSeesTouchPoint`), so they still see the session on their calendar.
  ⑤ Routines still book derived points — the generator sends no list, which
  is the sane default for a whole peak booked up front. 10 new tests pin the
  audience rules (194 total).

- **2026-08-11 · v33.33** — **FIVE FROM THE FLOOR** (migration **0055
  applied**: `lc_feedback.rating`).
  ① **"11 CALLS NEED YOU" WAS TELLING EVERYBODY.** The banner counted the
  whole floor, so six members with nothing waiting read the same alarming
  number as the two people who owed a report — which is exactly how a number
  meant to prompt action becomes wallpaper. It follows the hierarchy now: a
  member answers for their own calls, a Team Leader for their team's, a
  VP/Director/LCP for the floor they already see. Nobody with a clean slate
  sees a banner at all, and the "Show them" filter narrows to the same set.
  ② **THE BACKUP-GMAIL FIELD WAS BEING FILLED WITH THEIR AIESEC ADDRESS.** Not
  a bug in our code — a bare `type="email"` input is an open invitation to the
  browser, and the one address Chrome has saved for this site is the one they
  sign in with. So the field meant for a DIFFERENT inbox quietly became the
  same inbox. It now carries its own name, `autoComplete="off"` and the
  password-manager opt-outs, and says so on the spot if the two match (the
  server already refused it; the person just never saw why until they saved).
  ③ **THE BOOKING PAGE STOPS ASKING ABOUT TIME ZONES.** The device's zone has
  always been detected and the page drawn in it — but v33.23 added a "Looks
  like you're in Amsterdam — show Amsterdam time?" prompt on top, which made
  every visitor stop and think about something Google Calendar never asks
  them. The detection stays, the picker stays for the rare person who wants
  another zone, the prompt is gone. The edge-resolved zone is still attached
  to the page as `data-ip-zone`, so "the detection is wrong" remains
  answerable without a banner.
  ④ **ONE EMAIL, EVERYONE ON BCC.** A shout-out to nine people was nine
  separate sends — nine chances to fail, nine rows in the mailbox, nine times
  the quota for one message — and so was a shared piece of feedback and a
  concern notification. All three now send ONCE with the recipients on BCC
  (they also stop seeing each other's addresses). The shout-out's greeting
  drops the first name only when there IS a group, so a single recipient still
  gets their own name and nothing pretends to be personal that isn't.
  `sendEmail` grew the one piece that makes BCC-only safe: an empty `To:`
  header is rejected by some servers and renders blank in the rest, so it
  falls back to the LC's own mailbox — the standard "undisclosed recipients".
  ⑤ **A TOUCH POINT IS RATED, NOT PRAISED OR REPORTED** (0055). Session
  feedback travelled the same two-way road as feedback about a person — 🎉
  shout-out or 😟 concern — and neither fits a meeting: "good, but it ran
  long" is not a complaint about anybody and not applause for anyone. Picking
  **A touch point** now shows **1–5 stars** instead of the toggle (with a word
  under each: Poor → Excellent), the note becomes optional because the stars
  ARE the review, and it always travels the quiet inbox path whatever the
  score — a 5-star meeting no longer emails the TM function "💙 someone
  appreciated you". `positive` stays NOT NULL for every existing reader,
  derived from the stars (4+); a person is never scored, and the server
  refuses a rating without a touch point and a touch point without a rating.
  The inbox shows ★★★★☆ beside the row and the notification says the score.

- **2026-08-11 · v33.32.2** — **THE PEAK, THE THREAD & THE REFERRALS TAB**
  (no migration).
  ① **THE CONSIDERATION LANE STOPS AT THE PEAK BOUNDARY.** The trend strip was
  a rolling six months, so on the winter peak (Aug–Jan) it reached back into
  July and June and put the previous term's calls next to this month's. A
  number you shouldn't compare against, drawn as if you should. The strip now
  runs from the peak's FIRST month to the current one — one bar in the peak's
  first month, honestly — and the "vs last month" line says
  *"The first month of Winter 26.2 — nothing before it to compare with"*
  instead of comparing against a zero it invented (`irLastMonth` is `null`,
  not 0, when last month is pre-peak: the difference between "none" and
  "none that counts here").
  ② **COMMENTS FROM THE SIGN-UPS LIST.** The raising table has carried its
  thread and a ➕ since v33.17; OGX had to open a sign-up to read or leave one,
  which is exactly why so much calling context lived in WhatsApp instead. The
  list gains the same **Comment** column — newest first, full text on hover, a
  💬➕ for anyone who may work the row or is its VP — over one extra query per
  page. It lands in the same two-class log and the same sheet cells; only the
  distance changed.
  ③ **REFERRALS HAVE THEIR OWN TAB** (🤝 Referrals, beside Unassigned · My
  sign-ups · CIC · All · Archived). A handful of organic referrals among
  thousands of tracker rows is a needle in a haystack, and the people who log
  them want to watch exactly those. Scoped like "mine": a member's own, a TL's
  team, the whole function for a leader (or for a role their VP has opened the
  floor to).
  ④ **THE REFERRAL FORM ASKS WHAT THE PERSON ALREADY KNOWS.** University is
  gone — it was never the thing anyone reached for. In its place: **date of
  birth** (optional, validated as a real date — the column is free text and a
  half-typed year must not be stored as fact), **country** (resolved against
  the real country list, like a booking, never free text), and the first three
  funnel steps — **Contacted · Interested · Status** — because whoever logs a
  referral has usually already spoken to them, and making them re-open the row
  to say so is how a funnel stays empty. Contacted=Yes stamps `contacted_at`;
  Parents Approval still needs a VP.
  ⑤ **The 16 overdue IR calls were chased** (v33.32.1, shipped separately):
  one message per HOST rather than per call — 7 belled, 3 emailed. Four hosts
  holding 8 of the calls have neither an AIESEC address nor a backup Gmail, so
  they got the bell only; `scripts/nag-overdue-ir-calls.mjs --dry` re-runs the
  list without sending.

- **2026-08-10 · v33.32** — **THE LEADER'S OWN DEFAULTS, REFERRALS & THE
  BOUNCE LOOP** (migration **0054 applied**: `function_settings`).
  ① **FUNCTION DEFAULTS** — a card on the profile of anyone who LEADS a
  function (LCVP/Director; LCP/admin get all eight). Every switch on it
  replaces a constant that used to live in the code, and every one is wired to
  something real — a dead toggle would be worse than no toggle:
  **new accounts** (join the Podio update cycle? every how many days — it was
  hard-coded ON for IGV/B2C/BD at 14 days for everyone) · **who sees the whole
  function** (a per-role switch for Members, Coordinators, Team Leaders) ·
  **OGX** (self-service claiming, second calls, who may log a referral, the
  streak nag) · **TM** (chase unrecorded touch points, pre-fill working hours,
  and whether the function is judged on working hours at all).
  The store is ONE JSONB blob per function, because a settings table that
  needs a migration per toggle is a table nobody adds toggles to; the SHAPE and
  the DEFAULTS live in `src/lib/function-settings.ts`, and an absent row means
  exactly the behaviour that shipped before 0054 — locked by tests, so an LC
  that never opens the card cannot notice it exists.
  ② **"WHO SEES WHAT" IS A READ, AND ONLY A READ.** The widening had to reach
  the RBAC engine, which is synchronous and pure — so the settings are
  resolved ONCE per request in `getViewer` and ride on the Viewer
  (`openViewFns`, `fnSettings`) rather than being fetched mid-check.
  `canEditAccount` is untouched: the new clause lives in `canViewAccount` and
  in one extra OR on the list query, so an opened Member can OPEN every
  account in their function and still edit nothing but their own. It never
  leaves the function it was set on, and `accountScope` — which every mutation
  and every leaderboard reads — returns exactly what it did before. Seven rbac
  tests pin those properties.
  ③ **ORGANIC REFERRALS** (no migration — a referral is a sign-up). Someone we
  can approve who never came through the tracker had nowhere to live, so they
  were worked over WhatsApp and never appeared in a funnel, a leaderboard or a
  plan. **Add referral** on /signups writes a real `signups` row with
  `source='referral'` + `sodio_touched`, assigned from birth (an unassigned
  sign-up is invisible to the OGX dashboard by design). The tracker sync
  cannot touch it: the importer only reads rows whose source is one of the
  four sheet tabs, and BOTH write-back paths look the source up in
  `SIGNUP_TABS` and return early. The list shows 🤝 Referral instead of an EP
  id, and the dashboard says how many of the sign-ups are referrals.
  ④ **THE IR EMAIL LOOP, END TO END.** Refuse what can be PROVEN wrong at
  booking: a dead/mistyped domain (curated table; a one-edit near-miss only
  sharpens the message when the domain also has no MX, because "mail.com" is
  one edit from gmail.com and real), a burner domain, a stray/leading/trailing
  dot, and a local part that breaks **Gmail's own published rules** —
  `a.b@gmail.com` cannot exist, so refusing it is a fact. DNS still fails
  OPEN. What can't be proven (the Visakhapatnam case: a reversed name at a
  valid gmail.com) is caught after the fact, and that loop was leaky:
  the watcher marked every LISTED message seen — including ones whose fetch had
  just failed, so one transient Gmail error buried that bounce forever (now
  only PARSED ids are recorded, over a 7-day/60-message window instead of
  2 days/25). A bounce now EMAILS the host as well as belling them, carrying a
  **wa.me link to the IR** — their number is the one channel we know works.
  On the fix: the wrong address is dropped from the event and the right one
  invited in its place (Google mails both), and when the swap is impossible —
  no event was ever created because the host had no Google grant, or that
  grant has since been revoked — the event is **rebuilt on the IM mailbox**
  instead of silently doing nothing. A confirmation that fails to send to the
  NEW address re-flags the call rather than reporting success, and a booking
  whose first confirmation is rejected on the spot is flagged immediately
  instead of waiting 15 minutes for the watcher.
  ⑤ **THE CONSIDERATION LANE HAS FILTERS** (it was the only lane that ignored
  Added→ / team / member entirely, so "what did the IR floor do this sprint"
  was not an answerable question). Same bar as every other lane, matched
  against the call's OWN time and its owner; the date inputs are the one place
  NOT clamped to today, because a call can legitimately be in the future. The
  member list is the people who actually make the calls — the product's crew
  whose sub-function says Consideration — not every raiser in the function.
  ⑥ **"THIS MONTH 4, UPCOMING 1, TOTAL 4."** The Calls-by-member table showed
  three numbers that look like a sum and aren't: an upcoming call is already
  inside both the month and the total. The columns are DISJOINT now — **Done +
  Upcoming + Waiting = Total** — with "this month" kept apart as the slice it
  is, and the card says so in words. Which surfaced the real gap: a booked
  call whose time has passed while it is still `scheduled` is neither
  upcoming nor done, and nothing anywhere counted or chased it (Dai's 11 GV
  calls were 11 REAL bookings from 11 different LCs — no duplicate, no
  reschedule artefact — but two of them had already happened with nobody
  reporting on them). New: an **⏰ Time passed — report it** chip, a banner
  counting them (bounced emails included) with one tap to show only those,
  and a **Waiting to be reported** KPI on the lane.
  ⑦ **THE PAST IR CALLS FILTER** — funnels on Product · Status · By ·
  Partner LC, plus search and a Called-from→to window, all applied in the
  QUERY: the log is server-paged, so a client-side filter would have narrowed
  the page and presented it as the whole history. Options come from a cached
  distinct read over the whole log, not from the rows on screen.
  ⑧ **THE GRAB HANDLE WAS ON THE TITLE.** At `-top-4` with `py-1` the 24px
  grip ran from 8px to 32px inside the dialog's 24px top padding — its lower
  third overlapping the first line of the title, which is exactly "the grab is
  on the text itself". It now sits entirely in the padding, 2px clear.
  ⑨ **TWO EMAILS, TWO JOBS.** Both fields in the member dialog said "Email",
  so the AIESEC address and the personal one were filled interchangeably. They
  are now **AIESEC Mail** (the identity: sign-in + what the Membership sheet
  carries) and **Personal Gmail — backup only** (resets and IR-call invites
  until the AIESEC one lands; never a sign-in, never written to the sheet),
  each saying so under the field. Same wording on the profile.
  ⑩ **ACCOUNT CREATION RE-CHECKED ACROSS FUNCTIONS** (the ask was whether
  adding a B2C or an IGV account harms anything): the only change to
  `createAccount` is that the two Podio columns now come from the function's
  settings, whose defaults reproduce the old rule exactly. Verified against
  prod: **zero** B2C accounts carry a stray industry/product/project, zero
  lack their Type, every function is on a single cadence (14), and the
  460 IGV / 1245 IGT rows without a project/product are the v22 sheet import,
  not something creation produces. The name worlds match the DB index
  (ICX · BD · B2C) so an IGV namesake never blocks a B2C account, and
  `rowInLane` keeps B2C out of All-ICX and each product lane exact.
  Tests **184**.

- **2026-08-10 · v33.31** — **WHO SEES A CUSTOM SLOT** (migration **0053
  applied**: `calendar_items.visibility`).
  ① **"VISIBLE TO" ON EVERY CUSTOM CALENDAR ITEM.** 0044 gave items an
  invite-shaped audience — owner + an EXPLICIT assignee list, nobody else —
  which covers "put this on three people's calendars" but not "block this
  hour so my team can see I'm busy". `visibility` now widens the audience on
  top of that rule, and the options follow the person
  (`calendarItemScopes` in rbac):
  **Member / Coordinator / TL → self · team · function** ·
  **LCVP / Director → self · function** (their team IS the function) ·
  **LCP-level → self · EB · LC** (+ function if they hold one) ·
  **TM (any role) → + the whole LC**. Built from the person's actual position
  rather than a role table, so a TM Team Leader or the IM Director gets the
  UNION instead of whichever row matched first. Default is **'self'**, which
  is exactly the 0044 behaviour — all 12 live rows kept it, nobody's calendar
  changed under them. The owner and any assignee always see the item
  whatever the scope says.
  ② **The audience test is one predicate, in JS.** A month holds tens of
  items, so `listCalendarItems` reads the window and filters in code rather
  than building a five-clause PostgREST `.or()` — the kind of stringly OR
  that silently widens the day someone appends a term. `team` = shares a
  manager with the owner, or manages them / is managed by them; `function`
  matches `function_key`, **frozen at creation** so a member changing
  function can't rewrite the audience of every past item (the v33.23
  `ir_calls.fn` lesson); `eb` = LCP + LCVPs (Directors are not EB, as
  documented); `lc` = everyone. Verified end to end against prod with five
  throwaway rows and six viewers — owner, teammate, manager, same-function
  LCVP, another function's LCVP, the LCP — all six audiences exact, rows
  removed after.
  ③ **F&L's LCVP IS OFF THE FEEDBACK INBOX** (the LCP's call).
  `canSeeLcConcerns` is now the IM director + the LCP + the whole TM
  function; F&L's LCVP had been there for the legality side. This also
  narrows who is NOTIFIED of a new concern, since v33.22 tied the two
  together. Copy followed in three places: the Playbook, the Blue Man, and
  the feedback form's own touch-point line.

- **2026-08-10 · v33.30** — **THE ADMIN CAN SEE WHO FILED ANONYMOUSLY** (no
  migration; two prod audit rows backfilled).
  ① **WHY.** An anonymous 🎉 shout-out went to nine people at 3 AM and the LC
  wanted to reward whoever wrote it — but the audit row reads *by system*,
  because `submitLcFeedback` logs `input.anonymous ? null : viewer.id` on
  purpose. The identity has always existed (`lc_feedback.author_id` is stored
  on every row — it is what lets "tell them it's handled" reach an anonymous
  author); nothing was ever collected that isn't collected now. This release
  only changes **who is SHOWN it**.
  ② **THE GATE IS `viewer.isAdmin` — ADMIN_EMAILS ALONE**, deliberately NOT
  `canUseAdminTools` (which would add every Role/sub-function **Admin**
  holder) and NOT `canSeeLcConcerns` (the LCP, all of TM, F&L's LCVP). Today
  that is one address. Verified against prod: Ahmed sees both anonymous
  authors; **Arwa (LCP), Yassin (F&L LCVP) and Omar El-Deeb (Admin sub-fn)
  see none**, in the inbox and on the log. If ADMIN_EMAILS ever grows, this
  grows with it — that env var is now a privacy control, not just a
  break-glass login.
  ③ **WHERE.** The **LC-feedback inbox** (`listLcFeedback` returns the name
  plus `authorAdminOnly`, rendered as "🎭 Anonymous — Name (admin eyes
  only)"), and the **/admin log** (`listRecentAudit(limit, {asAdmin})`). The
  audit table itself still stores **no actor** for an anonymous row — the
  details gained a `feedback_id` pointer and the name is resolved at READ
  time, so the log stays honest about what was recorded and the unmasking is
  one gated lookup. `/admin` reads `getRealViewer()`, so a **test view can
  never be used to unmask anyone**.
  ④ **SCOPE: all anonymous feedback, concerns included** (the LCP's call).
  ⚠️ Worth knowing: a concern filed **about the admin** is unmaskable **by**
  that admin. If that ever matters, the fix is to null the author when the
  viewer is among `about` — deliberately not built yet.
  ⑤ **MEMBER-FACING COPY.** By request nothing announces this. One line was
  still changed, because it would otherwise have become a false statement at
  the moment of consent: the concern toggle said *"No one will see your name,
  the mic is yours"* → now *"Your name won't be shown with it — the mic is
  yours."* True, same reassurance, discloses nothing. The positive variant
  ("They'll know someone appreciated them — just not who") was already true
  and is untouched, as are the Playbook and Blue Man, whose wording is
  addressed to the inbox READERS (TM / LCP / F&L), for whom it still holds.
  PLAYBOOK_VERSION deliberately NOT bumped — there is no member-facing change.

- **2026-08-10 · v33.29** — **BOUNCE-PROOFING, ROUTINES & THE OPEN CALL**
  (part 1 shipped 2026-08-09 with migration **0051 applied**: `members.fallback_email`,
  `ir_calls.email_bounced_at`, `signup_cic_calls`; part 2 is this entry).
  ① **THE BOUNCE WATCHER.** Part 1 caught dead DOMAINS at booking time
  (`emailDomainIssue` — MX via dns.google, typo table, fail-open). A real
  domain with a wrong USER (the Visakhapatnam case: a reversed name at a
  valid gmail.com) only reveals itself when the mail server bounces — so
  `src/server/bounces.ts` now rides the 15-minute visit-followups cron:
  scans the IM mailbox for mailer-daemon reports (all confirmations and
  mailbox-hosted invites go out from it, so the bounces land there), parses
  RFC 3464 `Final-Recipient`/`X-Failed-Recipients` from the raw message,
  and flags any SCHEDULED call whose `booker_email` matches
  (`email_bounced_at` + bell to the host). Seen-message ids live under
  app_settings `bounce:seen-messages`, so each report is parsed once.
  ② **FIX THE EMAIL IN PLACE** (`updateIrBookerEmail`): owner or VP corrects
  the address on the call — the calendar event's ATTENDEE IS SWAPPED
  (`swapIrCallAttendee` in calendar.ts: fetch-then-patch, because PATCHing
  `attendees` replaces the whole list; owner-calendar and mailbox-calendar
  paths both handled), so Google re-sends the Meet invite to the right
  inbox; the LC's contact row follows (unique (lc, lower(email)) — an
  existing row with the new email wins and the wrong one is deleted); the
  confirmation email goes out again (their clock first, manage link
  included); the bounce flag clears. Domain-checked like a fresh booking.
  ③ **EVERY IR CALL OPENS.** Rows in the scheduled list and the call log
  are clickable into one organized card: IR name/role/email(+bounced
  badge + the fix right there)/WhatsApp, Cairo time AND their-zone time,
  booker note, Meet link, host, full move history, cancel reason, demand,
  notes, CV-pool link, screenshot. Links inside rows still work — a click
  that started on an anchor/button never opens the dialog.
  ④ **ROUTINES OF CUSTOM SLOTS, FOR EVERYONE.** `canCreateCalendarItems` is
  now true for every role: a Member/Coordinator's assignee scope is THEIR
  OWN TEAM (themself + same-manager teammates + the TL — server-validated
  in `assignableForItems`), a TL keeps their team, LCVP/Director their
  function, LCP-level anyone. The Add-item dialog gained **Repeat: "Weekly —
  N weeks"** (2–12): one action inserts N rows a week apart, each its own
  item so one occurrence can be deleted without the rest (the touch-point
  routine pattern). Assignee bells say "repeats weekly ×N".
  ⑤ **THE BACKUP GMAIL HAS UI** (0051 gave it the column; the profile and
  the membership editor now set it): "Backup Gmail (until your @aiesec.net
  arrives)" on the Profile's My-info card, and a field in the EB's member
  dialog. DB-only — deliberately NOT in SheetMemberRow, so the half-hourly
  import can never clobber it (the has_podio precedent); `upsertMember`
  only touches it when the field is actually sent. Rejected when it equals
  the member's main email. Already consumed by password resets
  (`issueTempPassword`) and mailbox-hosted IR events (`ownerEmail`
  fallback) since part 1 — never an identity, no sign-in.
  ⑧ **THE ONBOARDING, REBUILT.** Three engine bugs and stale wording:
  `waitForSelector` matched the FIRST element and checked ITS box — on a
  phone the hidden desktop table is the first match, so the tour stalled 4s
  per table step (now: first VISIBLE match across all); `closeBy` clicked
  the first `[data-slot="dialog-close"]` in the DOM — with the mobile
  drawer open that's the DRAWER's ✕ (now: the last visible match = the
  topmost portal); and table steps are `desktopOnly` (skipped instantly on
  <768px instead of stalling). Content: the account-work step speaks the
  viewer's WORLD (B2C = contract-first deals, no proposals; BD = money
  MOS), "book visits" says it happens FROM THE CONTACT LOG, new steps for
  **Direct visit** (anchor `accounts:direct`), **the Emails tab** (MMs+),
  and **B2C's door into /signups** (the CIC selling queue). Storage key
  bumped `crm-tour-v4:` so everyone walks it once more.
  ⑦ **B2C CIC — THE SELLING CALL** (`signup_cic_calls`, created in 0051 with
  the legacy `cic_*` columns migrated in as side='OGX' rows). B2C calls the
  SAME sign-up pool — people whose first OGX call was answered (Yes or No) —
  to sell courses/events, never to move the OGX funnel. The B2C crew enters
  /signups (layout gate + nav via `isB2C`) and lands on the 📞 CIC view
  ONLY, across BOTH OGX sides — a **"Both" chip** is their default and the
  OGT/OGV chips only narrow (the first cut passed `fn: activeFn`, which
  defaults to `fns[0]`, so B2C silently saw OGT's 232 candidates and never
  OGV's 436; the page now sends no fn unless a side was actually picked).
  Their column funnels come from `signupFilterOptions`, which gained the
  same B2C clause, and the OGX-tracker "Sync now" button is hidden from
  them (the server always refused it — it was a dead button). Assignment matrix
  (`assignB2cCic` + `b2cCicCallerTargets`): TL → self + own team ·
  Coordinator → self · LCVP/Director/LCP-level → any B2C member; caller must
  work B2C. ONE OPEN B2C call per sign-up (assignment replaces the open
  row's caller; recording closes it; `clearB2cCic` deletes an unrecorded
  one) — so a sign-up can carry an open OGX second call AND an open B2C call
  at once, plus full history. The OGX actions now MAINTAIN rows too
  (assign inserts side='OGX', clear deletes the open one, `updateCicContact`
  mirrors onto the latest row) while the legacy columns keep every existing
  OGX reader working. Every hand-out/answer lands in signup_logs
  side-tagged (`cic_b2c_*` vs `cic_*`). UI: three CIC-view columns — B2C
  caller (inline assign) · B2C called · B2C interested — the bulk bar hands
  out B2C calls for B2C MMs, and a B2C caller opens the sign-up detail +
  history read-only (`getSignupDetail`/`listSignupLogs` gained the
  caller clause). The **B2C dashboard lane** gained the B2C CIC card:
  handed out · called · interested · open · this month · per caller
  (`b2cCicStats`). `master` is now exported from rbac.
  ⑥½ **THREE NAME WORLDS** (migration **0052 applied**): the two-world split
  (0020/0034) became three — **ICX (IGV·IGT·B2B) · BD · B2C** — each with its
  OWN archive, a name unique only WITHIN its world (the DB index is a 3-way
  CASE expression; only ever a relaxation, zero prod collisions). And the
  cross-world ACTIVE block is GONE: `checkAccountName` returns the new
  `crossWorldActive` info instead — the add form and the direct-visit form
  show "already ACTIVE on IGV (responsible: X) — different business, add it
  here too" and proceed. The blacklist stays the ICX world's list. Slug
  namesakes across worlds resolve to the active row the viewer can work
  (the existing collision logic already preferred exactly that).
  ⑥ **THE CONSIDERATION LANE IS A DASHBOARD** (`considerationStats` v2):
  calls this month vs LAST month (delta in the hint), completed,
  upcoming, **Booked → happened** conversion (completed ÷ settled),
  partner LCs reached + LCs reached for the FIRST time this month, CVs
  (IGT), a 6-month per-month bar strip, and a **Calls-by-member drill**
  (this month · upcoming · total, ranked) built from the calls' own name
  snapshots. The lane split still follows each call's own `product` tag.

- **2026-08-09 · v33.28** — **THE MOBILE & LAYOUT RELEASE** (migration **0050
  applied**: `ir_calls.reschedules`). Root-caused by a 16-agent adversarial
  pass; the date bug was reproduced pixel-for-pixel in a headless browser
  before a line was changed.
  ① **THE "BLANK DATE BOXES" WERE TWO BUGS AT ONCE, AND ONE OF THEM WAS OURS.**
  `globals.css` styled `::-webkit-datetime-edit` as if it were a placeholder
  pseudo — **it is the whole edit region**, so every real date and time in the
  app rendered in `--muted-foreground` instead of the text colour. There is no
  placeholder pseudo for a date input; the flag has to come from the component,
  so `Input` now marks a genuinely empty field `data-empty` and only THAT is
  muted. Second: they were too narrow to show what they held. In the
  Add-calendar-item dialog `grid-cols-3` inside a 295px phone dialog left
  **67px** of usable value area against the ~115px a date needs — the value was
  clipped, not wrapped, which is what "blank" looked like. The date now takes
  the full width on a phone; the row becomes three columns only where three
  fit. The three filter bars (accounts · dashboard · members) were cutting the
  last digit of the year at any width under 400px and are wider. And iOS
  Safari CENTRES the value inside `::-webkit-date-and-time-value` and self-
  sizes the control, so a box a few pixels short showed the MIDDLE of the date
  — pinned to the start, appearance cleared, all 39 controls at once.
  ② **"00" RENDERED AS "0C", "PM" AS "PN".** The shadcn SelectTrigger gives its
  value span `line-clamp-1` (overflow hidden), so inside `w-16` — 64px, ~48px
  of which is padding, gap and chevron — the text is cut rather than allowed to
  push. Reclaiming the padding costs no layout width; `shrink-0` keeps a phone
  from squeezing it back.
  ③ **EVERY TOOLTIP IN SODIO WAS DEAD ON A PHONE.** `Hint` was hover-and-focus
  only, and a touch device has no hover — dozens of hints, which are how the
  system explains itself, simply never appeared. It opens on tap now (and
  closes on the next tap, on scroll, or after four seconds) while the wrapped
  control keeps its own click.
  ④ **Mobile overflow, one mechanism.** A `grid` with no template puts its
  children in an IMPLICIT `auto` track, and a grid item keeps `min-width: auto`
  — so the track is sized by its widest child's min-content. The CV cards grew
  to **797px inside a 343px phone**. `grid-cols-1` (a flexible track, minimum
  0) plus `break-words` on the free text fixes it; the same shape fixed the
  Health page, where the check detail was `truncate`d — hiding 439px of
  sentence in a 247px box, which is exactly the thing you need to read.
  ⑤ **The sidebar wordmark was slicing "AIESEC in Alexandria".** An `h-7` box
  holding an `h-8` image bled 4px, and a fixed `w-32` caption cut the words
  mid-letter. The mark is smaller, the box matches its contents, and the text
  block owns the space it needs. The avatar picker's scrollbar sat on top of
  the tiles — it has a gutter now.
  ⑥ **CALENDAR FILTERS**: by kind (visits · IR calls · touch points · items)
  and by **function** — the latter offered only to people whose remit actually
  spans functions, exactly as asked. Deliberately derived from the VIEWER, not
  the month's data: a single cross-function invite would otherwise hand a
  single-function VP the control the LCP said they should not have. Custom
  items are never filtered by function — their stored `function_key` is the
  owner's arbitrary first function and nothing else reads it.
  ⑦ **AVAILABILITY FAILS PER ROW, AS YOU TYPE.** `src/lib/availability.ts`
  holds the three rules a member can actually break — backwards or
  under-10-minute window, missing day/date, an overlap with another window on
  the same day — so the offending row is outlined and says what is wrong with
  it, and Save is held until it is fixed. The server keeps its own check
  unchanged; this only moves the answer earlier. 6 new tests, 154 total.
  ⑧ **A RESCHEDULED CALL REMEMBERS** (0050). The move was an in-place
  overwrite: the old time was gone and the only trace was a bell and an email.
  Each move is now appended to `ir_calls.reschedules`, and the scheduled list
  says it in words — "Moved twice — first booked for …, then …. Last change by
  Ensar on …".
  ⑨ **"IM" is a real function** and was missing from `LC_FUNCTIONS`, which is
  what made people reach for the Admin *sub-function* instead. Admin remains
  what it always was in the pick-lists: a ROLE. (The one member carrying
  `sub_functions: Admin` keeps it — it is his only grant to the admin tools,
  and stripping it before the replacement ships would lock the person most
  likely to diagnose that out of the diagnostics.)

- **2026-08-09 · v33.27** — **FIVE FROM THE FLOOR** (no migration).
  ① **Send to a whole team.** Addressing the EB or your own team meant looking
  up six addresses one at a time, which is how someone gets left off. The
  Emails tab now offers **My team · Everyone · the EB · the LB · all MMs ·
  every function · every standing team**, derived from the membership itself
  so they cannot go stale — each one expands into real addresses you can still
  edit or remove.
  ② **The signature wears the Blue Man.** Every layout already carries the
  AIESEC in Alexandria logo at the top; repeating it twenty lines lower made
  one letter look like two stapled together. The walking human belongs to the
  person, which is what a signature is.
  ③ **The OGX side tag only shows on the JOINT board.** On an OGV-only or
  OGT-only streak board every row carried the same chip — noise answering a
  question nobody is asking there.
  ④ **THE DRAG HANDLE WAS THE WHOLE HEADER.** The grab cursor ran the full
  width of the dialog, right up against the ✕, and a press meant for the title
  moved the window. Only the ⣿ dots are the handle now (`data-drag-handle`),
  with the grab cursor and a hover state on them alone.
  ⑤ **Attendance had sorting but no filters.** The house rule everywhere else
  is "if it is a column, you filter it from the column": **Type**, **Status**
  and — new — **Member** now carry funnels, all comma-aware because the
  control is multi-select, and the member filter resolves names to ids BEFORE
  the page is cut, so it filters the whole history rather than the page you
  happen to be looking at.

- **2026-08-09 · v33.26** — **THE CORRECTIONS PASS** (no migration).
  ① **The direct-visit form put the verdict above the field it judges.** The
  Account name is now the FIRST thing, top-left, with the three live checks
  under it; Function moved to its right. **B2C shows its own three types** —
  Courses · Events · Student activities — instead of the raising account-type
  list it has never used (and no industry). The **"not on Podio" verdict now
  carries the link** to the national form, which the Add-account dialog has
  had all along.
  ② **IR roles are four**: Member · MM · LCVP · LCP. `isKnownIrRole` still
  accepts the longer wording written before today, because a stored role is a
  snapshot of what someone picked — only the PICKER narrowed.
  ③ **The streak card was unreadable as a ranking.** Five names wrapped onto
  one line at the same size said nothing about who was first. It is a real
  board now: numbered rows, the leader highlighted, the day count as the thing
  your eye lands on, and **each person's OGX side in its own colour** (OGV
  `#F85A40`, OGT `#0CB9C1`) — on a joint board a name alone doesn't say which
  side they're racing. "Best: 0 days" sitting unlabelled beside other people's
  live streaks read as broken; it says **"Your best"**, or "No streak yet —
  today can be day 1".
  ④ **A CIC could be handed out but never taken back.** `clearCicCaller`
  returns the sign-up to the queue — the first assignee and their numbers are
  untouched either way. Available inline ("— Take the call back") and to the
  caller themselves. (Ordinary Unassign was checked and does return a sign-up
  to the pool.)
  ⑤ **Cc and Bcc now complete names from the membership**, like To — one
  matcher, three fields. Copying a teammate meant remembering their address,
  which is the thing this tab exists to stop.
  ⑥ **The text-size box rendered empty** because it was a `Select` whose value
  matched no item. Size is an ACTION, not a stored value, so it is a menu now
  — with each option shown at the size it applies.
  ⑦ **The LC log never said who the call was with.** Each entry now names the
  IR *and* the member who took it, and carries the IR's own "what I'd like to
  talk about" note plus the in-call notes.

- **2026-08-09 · v33.25** — **THE FOLLOW-UP PASS** (no migration).
  ① **DIRECT VISITS NOW GO THROUGH THE REAL DOOR.** The first cut was a
  shortcut form, and it showed: the IGT "Sub product" field opened the
  **industry** list (`IGT_SUB_PRODUCTS` is Software/Marketing/… — the PRODUCT
  is GTa/GTe, a different column), the name skipped the three live checks that
  every other account gets, and phone/email were bare text with no tags. It
  now calls the same `createAccount` as the Add-account form: the world-aware
  **duplicate/archive/blacklist** check as you type (so an archived name comes
  back properly and a name held in another product is refused), the **Podio
  look-up** with "I already submitted it", the real **ContactsEditor** with
  tags and phone normalization, and Product + Sub product as two separate
  fields. The three checks were extracted into `useAccountNameCheck` so the
  two forms can never drift again. Outcomes gained rules: **deal on the spot**
  opens the account straight onto the deal form (`?open=deal`) where the opens
  split lives · **turned away** offers Out of Process with a reason, OFF by
  default · **got to present** asks for a follow-up date. "Company / place" is
  **Account name**, because that is what it is.
  ② **THE EMAILS TAB, PROPERLY.** BCC (a real `Bcc:` header, so Gmail strips
  it from every delivered copy) · **four layouts** — branded card, bold banner,
  letterhead, plain — chosen per email · **a preview** rendered by the SAME
  function that builds the outgoing mail, so what you see cannot drift from
  what is sent · **attachments** (an email carrying files is left in Gmail
  drafts, which is where the member watches them land) · **numbered lists,
  text size, underline, quote**, link/bold/italic on the selection ·
  **AIESEC logos** droppable into the letter · **spell check** on every field ·
  a **Start again** button · and the half-written email now **survives leaving
  the tab** — everything is mirrored to localStorage on each keystroke, which
  is the difference between using this and going back to Gmail.
  ③ **NOTES ON AN IR, FINALLY FINDABLE.** The composer existed but was a
  dropdown inside a dialog behind an unlabelled icon. Every IR row now carries
  its own 💬 button that opens the notes pointed at that person, and the LC's
  own button says **History** with the event count on it.
  ④ **GV / GT WEAR THE BRAND.** The product tags were grey outlines in three
  of the five places they appear. One `ProductTag` now paints them in the
  official colours — GV `#F85A40`, GT `#0CB9C1` — on the LC cards, the IR
  rows, the history timeline and the call log.

- **2026-08-09 · v33.24** — **DIRECT VISITS, THE MAILBOX & THE LC'S FACE**
  (migration **0049 applied**: `accounts.direct_visit`, `ir_calls.booker_note`,
  `partner_lc_contacts.source` + the booker backfill, `sent_emails`).
  ① **DIRECT VISITS.** Not every partner comes from a research sheet: someone
  walks a street, finds a business and offers the product at the door. Logging
  that meant adding an account, logging a contact, booking a visit into the
  past and reporting it — four screens for something that had already
  happened, so it went unlogged and the funnel called them idle. **One form**
  on Raising now writes all three rows (MR + contact + visit) through the real
  funnel, so it lands in the pipeline, the leaderboard and the dashboard with
  no double entry. The OUTCOME decides the rest: *turned away at the door* ·
  *come back another time* (books the return visit) · *send the info instead*
  (sets the next step) · *got to present* (visit done) · *deal on the spot*
  (visit done, then record the deal). Nothing is announced — the visit is
  over. A refusal at reception never archives the account: `direct_visit` is a
  flag, not a verdict.
  ② **THE EMAILS TAB** (`/emails`, MMs and above — `canUseMailboxTab`).
  Members have always written to partners, EPs and other entities from Gmail,
  from a blank page, so every letter looked different, half went out with no
  signature, and the LC had no record of who had been written to. Now: five
  starting points, a rich-text editor, **the Blue Man to write or rework the
  letter** (Gemini, HTML out, never invents facts and never signs), and a
  **real signature built from the membership row** — name, the full role
  title, the entity, WhatsApp-linked number, the two AIESEC lines and the
  logo. It sends through **their OWN Gmail**, so the reply comes back to them
  and it sits in their Sent folder — Sodio is the stationery, not the sender.
  Send now or leave a Gmail draft; recipients come from an LC-member picker,
  any typed address, or the ones they wrote to before (`sent_emails`).
  ③ **THE LINK PREVIEW WAS THE PWA ICON.** There was no `openGraph` image at
  all, so WhatsApp scraped the page and grabbed `icon-192.png` — a small
  TRANSPARENT PNG, which every chat app composites onto white and masks into a
  rounded square: exactly the "low quality with strange white corners". A real
  **1200×630 opaque card** with the FULL AIESEC in Alexandria logo now ships
  on every page and on both /book pages. The tab icon stays the lighthouse on
  purpose — a wordmark at 16px is a smudge.
  ④ **EVERY EMAIL WEARS THE REAL LOGO.** The header drew the wordmark with a
  `<span>` and a `float:right` label — typed, not designed, and rendered
  differently in every client. Both layouts now carry the actual mark as an
  image, a taller AIESEC colour band, roomier body and a warmer button.
  ⑤ **AN OGX TEAM LEADER WAS TOLD SHE OWNED 20 "ACCOUNTS."**
  `bulkReassignSignups` borrowed the RAISING template, so a sign-ups hand-over
  arrived with "the Responsible of 20 accounts", the raising golden rule and
  an "Open my accounts" button — for rows that are EPs in a tracker sheet. New
  `signupsAssignedEmail` speaks OGX. The rest of the 36 templates were audited:
  every other raising-worded one is only reachable from a raising path.
  ⑥ **BOOKING A VISIT IS A CONTACT RESULT.** The standalone "Schedule visit"
  button is gone — a visit is always the outcome of reaching someone, and the
  contact log books it (with the same calendar invite and reminders). MOVING
  an already-booked visit stays a button: there is no new contact to log when
  only the time changes.
  ⑦ **EVERY IR IS A REAL PERSON** (0049). IRs who booked through the link
  existed only as a snapshot on the call — capped at five per LC and with no
  id — so nothing could be attached to them. They now get a contact row like
  any hand-added IR (29 backfilled), which is what makes **notes on a specific
  IR** work. And the booking page finally asks **what the call is about**
  (`booker_note`): it reaches the host's email and the calendar event, so
  nobody walks in blind.
  ⑧ **EVERY PARTNER LC HAS A HISTORY** — calls, CVs and notes on one timeline,
  newest first, in the LC's own dialog. "Have we spoken to these people
  before?" used to mean opening three tabs and comparing dates.
  ⑨ **EGYPT'S DST IS HANDLED, AND SO IS THE HOUR THAT DOESN'T EXIST.** Stored
  instants were always right (`cairoToUtc` is two-pass), but on the
  spring-forward night the clock jumps 00:00 → 01:00, and the grid would have
  OFFERED 12:30 AM — a label whose invite says 1:30 AM. `cairoWallClockExists`
  round-trips every slot and drops the ones that aren't real. Three tests pin
  both transitions; 147 total.
  ⑩ **"MOST BUTTONS BECOME UNCLICKABLE" ON ONE IPHONE.** That shape — one
  device, intermittent, EVERYTHING dead at once — is a stuck modal lock, not a
  permission: Radix puts `pointer-events: none` on `<body>` while an overlay is
  open and removes it on close, and an interrupted close (slow device, tab
  backgrounded, one dialog opening as another shuts) leaves it there forever.
  `PointerEventsGuard` releases the lock whenever the body is locked and
  nothing is actually open. Also: `touch-action: manipulation` kills Safari's
  300ms double-tap delay on every control. (Her Google grant was checked and
  is live — access was never the problem.)
  ⑪ Smaller, from the same list: the booking page's Country no longer says
  "(optional)"; the IR-facing "no account needed" — meaningless to someone who
  has never heard of Sodio — became "it opens straight from this email,
  nothing to sign up for".

- **2026-08-07 · v33.23** — **THE CONSIDERATION RELEASE + TWO EMAIL BUGS**
  (migration **0048 applied**: `ir_calls.product`, `partner_lc_contacts.product`,
  `partner_lc_comments`).
  ① **THE DUPLICATE VISIT EMAIL, ROOT-CAUSED IN PRODUCTION.** `scheduleVisit`
  announced on EVERY call, with no idea whether it was a new booking, a
  correction or the same slot again. Two live cases: *I Can Read Academy* —
  booked 18:43, corrected 18:44, two "📢 New visit booked" mails and 40 bell
  rows for one visit (audit ids 4181/4182, distinct change sets, ONE `visits`
  row); and *Softa software solutions* — the same slot re-submitted three
  times in 30 seconds, three identical mails and 63 bell rows for a visit that
  never moved. Now: a repeat of the same slot announces nothing; a correction
  inside **15 minutes** announces nothing (the responsible's own bell and the
  Google invite already carry the new time); a genuine move later announces
  **"🗓️ Visit moved"** and says so. The audit's `announced` count stopped
  claiming a fan-out that didn't run.
  ② **Every function on its own.** The announcement widened IGV and IGT to
  include B2B, so the B2B/BD crew was told about every IGV and IGT visit in
  the LC. `announceFunctions` now returns the account's OWN function
  (B2B and BD still one crew). The CALENDAR INVITE is untouched — it splits
  into `leaderShareFunctions`, so the B2B VP still rides an IGV/IGT invite for
  oversight. The two used to share one list, which is how narrowing one would
  have silently broken the other.
  ③ **AN IR CALL KNOWS ITS OWN PRODUCT** (0048). `ir_calls.fn` looked like it
  should say — it never has, in any code path. Every "IGV or IGT?" was
  re-derived from the HOST's *current* functions, so a dual-function member's
  calls counted in BOTH lanes and a member changing function rewrote the
  history of every call they ever made. `product` ('GV'|'GT') is now decided
  when the call is booked and frozen; backfilled 16 GV / 7 GT, no nulls. A
  **Product column** on the call log, a **GV/GT filter** on the scheduled
  list, and the lane split (`listIrCalls`, `considerationStats`) reads the
  call's own tag — an untagged call stays visible to everyone, because null
  means "we don't know", never "hide it".
  ④ **The partner-LC registry became a registry**: filter by **country**, by
  **reached as GV / GT / Both / Never**, and by **has calls · has CVs ·
  nothing yet**; per-LC **GV/GT badges** (derived, never stored — two LCs are
  already both, and a stored set would drift on every merge and rename);
  **notes on an LC or on one of its IRs** (`partner_lc_comments`, author
  snapshot, remove your own or any as a VP); and **the IR's role is a
  pick-list** — one `IR_ROLES` list shared with the public booking page, which
  had been validating against its own copy while the registry took free text
  ("LCVP oGT", "IR Manager", "uw" in one column).
  ⑤ **CVs get column funnels** — Industry · AI status · Uploaded by · Partner
  LC · has/no number — filtering **server-side**, so they filter the pool and
  not the page you happen to be on. And **LC rename/delete is gone from the CV
  tab** (creating an LC inline stays: a CV can arrive from an LC we've never
  called).
  ⑥ **The OGX phone filter was unreachable on desktop**: the funnel hung on
  the Phone COLUMN, which ships hidden in every view. It now hangs on **Quick
  actions** — the column that draws the number — and the server read became
  comma-aware, because the funnel is multi-select and `?phone=has,missing`
  used to be silently dropped while the funnel showed two picks active.
  ⑦ **The grab handle was 100% dead.** The ⣿ dots carried
  `pointer-events-none`, so a press on them was never targeted at them: the
  event landed on the dialog underneath, whose `closest(header)` is null. Every
  painted pixel of the grip sat in the padding ABOVE the header box, so the
  real handle began a few pixels lower — "the grab is shifted down from the
  holder", exactly. Hittable now, with a 40px target.
  ⑧ **Phone fields show an example from YOUR country** (`src/lib/dial-codes.ts`,
  all 194 countries): the booking page showed an Egyptian number to an IR
  abroad and a French one in its error line. Every example is asserted by test
  to pass `normalizePhone` if typed literally — an example the validator would
  reject is worse than none.
  ⑨ **Endonyms count.** "Türkiye", "UK", "USA", "Holland", "Viet Nam" were
  matched strictly against COUNTRIES and thrown away, leaving the LC with no
  country and therefore no fallback time zone. `resolveCountry` accepts an
  exact alias — and *only* an exact alias — on all three write paths, and
  `addPartnerLc` now applies a supplied country to an existing countryless row
  instead of discarding it with the duplicate. **Inferring a country from the
  LC's NAME was investigated and REFUSED**: zero rows would benefit (all 27
  partner LCs already have a country), and the false positives are brutal —
  "AIESEC in Georgia" is 8 hours from Tbilisi, "AIESEC in New Mexico" 2 hours
  from Mexico City, and a wrong country is a wrong clock.
  ⑩ **The booking page offers a second opinion on your zone**: a browser
  reports the MACHINE's zone, so a VPN changes nothing (Google Calendar behaves
  identically). Vercel resolves the caller's IP at the edge, and when that
  disagrees the page offers a one-tap "Looks like you're in Amsterdam — show
  Amsterdam time?" instead of overriding a clock we can actually trust.
  ⑪ Feedback's **📅 Sessions** tab is **📅 Touch points**. Backups gained
  `partner_lc_contacts`, `partner_lc_comments`, `signup_logs` and
  `calendar_items` — the last two had been unbacked since 0044/0045.
  Tests **144**.

- **2026-08-07 · v33.22** — **TIME ZONES, ACCESS & THE FEEDBACK INBOX**
  (migrations **0046 + 0047 applied**).
  ① **THE IR CALENDAR NOW SPEAKS THE IR'S CLOCK.** Every booking was always
  stored as a UTC instant and every Google invite was always right — but the
  public booking page RENDERED Cairo time with a one-line footnote, so an IR
  in Jakarta picked "6:00 PM" meaning 6 PM at home and was four hours out.
  Google Calendar draws in the viewer's zone; now so do we. The browser
  reports the zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), the
  day strip is **regrouped** in it — a Cairo midnight slot is the previous
  evening in Algiers, so relabelling alone would have been wrong — the zone is
  changeable from a picker, and it **prefills the country** (`countryForZone`).
  The zone is stored on the booking (`ir_calls.booker_tz`) and on the LC
  (`partner_lcs.timezone`, add-only), so every later email speaks it:
  confirmations, reschedules and cancellations lead with **their** time and
  carry Cairo as the second line. The manage/reschedule page is drawn the same
  way. Internally nothing changes — the crew still reads Cairo — except that a
  scheduled call now also shows *their* local time, so nobody wonders why an
  IR missed a call that fell at 3 AM their side. `src/lib/timezones.ts` holds
  the country⇄zone tables (every one of the 194 countries resolves; 14 new
  tests, 133 total) and one label function shared by the pages and the mail,
  so the screen and the email can never disagree.
  **The 15 upcoming bookings were emailed a confirmation** — same moment,
  written in their local time, with the reschedule link and a plain statement
  that nothing changed (`scripts/ir-timezone-confirmations.mjs`; one LC was
  missing its country and was fixed in prod first).
  ② **Full access follows the JOB, not a flag.** Role = **Admin** used to be
  `master()` — whole-LC visibility for anyone marked a caretaker. It now
  grants **only the admin tools** (Health, logs, the change journal). Whole-LC
  access is the **IM leader's** (`leadsIm`: Function IM + Role Director/LCVP),
  plus the LCP, F&L and ADMIN_EMAILS as break-glass. A future IM director
  inherits it from the membership sheet with no env var to change.
  (Prompted by the Sub Function column being emptied outside ICX — every
  predicate reads functions OR sub-functions, so nothing else moved.)
  ③ **THE FEEDBACK INBOX IS AN INBOX** (0046). It was one flat list with a
  new/seen/done dropdown. Now: grouped by **kind** — 😟 concerns · 📅 sessions
  (a real `touch_point_id`, not a session name glued to the message) · 🎉
  shout-outs — and filtered by state. **Seen and done were the same thing**
  (the LCP's call), so the middle state is gone: `new · done · archived`, with
  who closed it and when. Every row can be **shared** with anyone in the LC
  (bell + email carrying the message — never the author, so anonymity survives
  being passed on), **archived**, **marked done**, or answered with **"tell
  them it's handled"** + an optional note, which reaches the author *even when
  they filed anonymously* — Sodio knows who wrote it, the reader still
  doesn't. Attachments open from the inbox. Access is **TM (the whole
  function), the LCP, F&L's LCVP and the IM director**, and the concern
  notification now goes to exactly that list instead of a narrower one.
  ④ **CIC's entry rule was refusing the rows it exists for**: it matched
  Contacted `y%`, so every **"No"** — a call that happened and didn't land,
  which is precisely what a second caller re-tries — sat in nobody's queue.
  The rule is now *held by a real Sodio member* + *Contacted answered (Yes or
  No)* + *no status yet*, in ONE place (`contactAnswered`) shared by the query
  and the server gate so they can't drift apart again. A row still in the
  unassigned pool never enters CIC: it is waiting for its FIRST call.
  ⑤ **🙋 Mine** — one tap to your own rows, on Raising and on Sign-ups, for
  anyone whose list holds other people's: a TL's team, a leader's function, a
  Coordinator's share of the unowned pool. In the CIC tab it means the second
  calls handed to you.

- **2026-08-07 · v33.21** — **SIX MORE FROM THE FLOOR** (no migration).
  (1) **A Coordinator had no Responsible column.** The test was "does my scope
  contain anyone but me" — a Coordinator's scope IS just themselves, yet their
  list also carries every UNOWNED market-research row (`canSeeUnassigned`
  covers every role above Member). So the one column that answers "is this
  mine or nobody's" went missing exactly where that question is asked. The
  column, its filter and the "— Unassigned (n)" option now follow
  `canSeeUnassigned`.
  (2) **The team leaderboard ranks the team, not its leader.** Every other
  board lists Members and Coordinators only; the TL's own row sat on the board
  they read. `teamBoard` drops `teamLeadId` — the TL stays inside
  `teamMemberIds`, so the team PLAN's actuals still include their accounts.
  (3) **CIC says it's CIC.** The bulk bar in the 📞 CIC tab used to call
  `bulkReassignSignups` behind a dialog reading "they land on the member's My
  sign-ups list" — in that tab a hand-over is the one thing that must never
  happen. It now hands out **second calls** (`bulkAssignCicCaller`, the same
  per-row gate, one bell and one refresh), the picker is the CIC caller pool,
  the button reads "Assign 2nd caller… → Hand them the call", the dialog
  explains that the sign-up stays with its first assignee, the inline cell
  says so too — and **"Unassign" is gone from the CIC tab**.
  (4) **Grab handles on everything that floats**: dialogs have been movable
  since v33.8 with nothing to say so — a ⣿ handle now sits in the header, and
  **The Blue Man's panel became movable** the same way (grip-only drag,
  viewport-clamped, `style.translate` written straight to the node so no
  pointermove re-renders). Desktop only, matching the drag itself.
  (5) **The "only the LCP" copy was wrong**: `canSeeLcConcerns` has been the
  LCP + the IM admin + TM's LCVP/Director for releases — the feedback form,
  the Playbook and the Blue Man all now say **the LCP and TM**.
  (6) **IR calls verified end to end**: all 15 upcoming scheduled calls carry
  an event and a Meet link; the 10 mailbox-hosted ones were checked against
  the Calendar API (IR invited · Meet present · confirmed) and two bookings
  made AFTER the fallback shipped came through it correctly. The four
  grant-less hosts show `guests: 1` because they have no email address on the
  membership yet — they join by the link on the IR-calls page.

- **2026-08-07 · v33.20** — **THE FLOOR-FEEDBACK BATCH** + the GitHub Actions
  cutover.
  (1) **The Actions imports are ARMED**: all 10 repo secrets set, and two more
  blockers found while doing it — the workflow passed
  `NEXT_PUBLIC_SUPABASE_URL` where `env.ts` reads **`SUPABASE_URL`** (every run
  would have hit an empty database), and `@supabase/supabase-js` throws at
  `createClient()` on **Node < 22** (no global WebSocket). The runner is pinned
  to 22 and `scripts/_node-compat.mjs` polyfills it for local runs.
  (2) **8 IR calls booked before the mailbox fallback got their Meet links**
  (`scripts/backfill-ir-meets.mjs`): every future booking owned by a member
  with no Google grant now has an event, a link, and an invite in the IR's
  inbox.
  (3) **CIC credit split**: both callers carry the sign-up and the CONTACT —
  both spoke to them — while the OUTCOME (Applied to Approved) counts for the
  SECOND caller who took it there. The function total still counts each
  sign-up exactly once.
  (4) **Attendance: pick any session.** A picker opens any past touch point the
  viewer may record (recorded or still open), not just the unrecorded chase
  list; the sheet gained **search + a status filter** (an LC session is ~70
  rows). **Nobody marks themself** any more — owning the point is no longer an
  exception, so a TL records their team and TM records the TL.
  (5) **No appeal on "attended"** — nothing to contest; hidden in the UI and
  refused server-side.
  (6) **The team leaderboard is named properly**: it read the raw comma-list
  from the sheet and now runs through `ownTeamName`, the resolver the
  touch-point labels have used since v33.6.
  (7) **Calendar scopes adapt to the role**: a TL has no "Mine" (it IS their
  team), a VP/Director has neither "Mine" nor "My team" — three chips that
  returned one list are gone.
  (8) **Session feedback goes to the people who run sessions** — TM, the LCP
  and F&L's LCVP — not to whoever booked it.
  (9) **The feedback form opens on CONCERN**, and the anonymity line now reads
  "No one will see your name, the mic is yours."

- **2026-08-07 · v33.19.1** — **THE REVIEW PASS ON v33.19** (31-agent
  adversarial review → 18 confirmed findings → 8 distinct bugs, all fixed;
  several in code shipped hours earlier).
  ① **The GitHub Actions import script could never have run.** `src/server/**`
  carries `import "server-only"`, which is not an installed package — Next
  resolves it in its bundler and plain Node cannot resolve it at all. The
  whole point of the hosting fix would have failed on its first click. New
  `tsconfig.scripts.json` aliases it to the same no-op stub the tests use;
  the workflow now runs `npx tsx --tsconfig tsconfig.scripts.json`, verified
  by loading all three modules outside Next.
  ② **A function move discarded its own resets.** `updateAccount` applied
  `fnSpecificReset` + the IGTe→IGV default INSIDE the field loop, so the
  Details form's project/product/sub_product — submitted in the same payload —
  overwrote them: an IGT account moved to IGV kept its stale product and never
  got Global Classroom. The function-derived fields are now applied AFTER the
  loop, where they win.
  ③ **CIC refused the very MMs it was built for.** `assignCicCaller` gated on
  `canWorkSignup`, which asks "is this row yours or your team's" — false for
  most of the queue a TL or Coordinator is looking at. Both CIC actions now
  gate on the queue's own predicate (`seesCicQueue` + the sign-up's function).
  ④ **The CIC second caller couldn't open the sign-up handed to them** — the
  row stays the first assignee's, so `canViewSignup` said no. Added a
  view-only clause (recording still goes through its own gate). Locked by 4
  new rbac tests.
  ⑤ **The CIC queue matched `contact_status = "Yes"` exactly** while every
  other reader treats the column as free sheet text (`/^y/i`) — a row the
  sheet spells "yes" displayed and COUNTED as contacted but never reached the
  queue, and the assign action refused it with a message contradicting the
  screen. Now `ilike "y%"` everywhere.
  ⑥ **The promotion release left no trace**: 61 sign-ups moved with no log
  entry and no sheet write-back, so the tracker still named the old assignee.
  It now records one `signup_logs` row per release (capturing the name BEFORE
  clearing it) and pushes the rows back to the sheet, comments included.
  ⑦ **IR calls**: the IR's own cancel never deleted a MAILBOX-hosted event
  (a ghost meeting survived on everyone's calendar), and a REVOKED owner token
  aborted the whole block instead of falling through to the mailbox fallback —
  the exact case the fallback exists for. Both fixed; NULL `event_calendar`
  still means "owner", so pre-release bookings behave as before.
  ⑧ **`updateDeal` on a pre-0018 deal** (no `deal_allocations` row) wrote opens
  that counted for the lane and for nobody's personal numbers — every
  per-member read is allocation-attributed. It now creates the default 100%
  row the way `recordDeal` does.
  ⑨ **The manual "Sync now" buttons stopped working**: after the
  unchanged-since short-circuit they no longer forced, so the human escape
  hatch did nothing, and the membership toast printed the internal `-1`
  skip sentinel as a row count. Both actions force now (a person pressing the
  button IS the force case) and the toast reads properly.
  Tests 118.

- **2026-08-07 · v33.19** — **THE HOSTING, CIC & CONSISTENCY RELEASE**
  (migration **0045 applied**: CIC columns, `signup_logs`,
  `ir_calls.event_calendar`).
  ① **THE VERCEL CPU FIX.** Fluid CPU sat at ~98% of Hobby, and the cause was
  not the app: the two sheet imports re-parsed everything every 15–30 minutes,
  day and night, whether or not a cell had moved. Three changes: a Drive
  `modifiedTime` **change check** (unchanged → the import exits in ~1s;
  `?force=1` overrides), a **night pause** (01:00–07:00 Cairo), and
  `.github/workflows/imports.yml` + `scripts/run-import.mjs`, which run the
  SAME exported functions on **GitHub Actions** — off Vercel entirely. Both
  schedules run until the secrets are added and one manual run is green;
  `supabase/cron.sql` documents the two `cron.unschedule` calls that retire
  the Vercel twins, so there is no window where nothing runs. (Cloudflare's
  free tier was assessed and REJECTED: a 10ms CPU cap can't host bcrypt +
  googleapis.)
  ② **A member could not see seven of his own accounts.** v33.14 swapped the
  list count to Postgres's ESTIMATE; it guessed 20 where a member had 27, and
  since the page size is also 20 the pager concluded "one page" and hid
  itself — on desktop and mobile alike. Back to an exact count: one cheap
  indexed query, and nobody loses sight of their work to save it.
  ③ **An account follows its owner, always.** Cross-function hand-overs move
  the account (v33.18 covered the picker; this covers the DEFAULTS and the
  data): IGTe → IGV lands on **Global Classroom**, other directions leave the
  new function's fields for the mover. The two live strays (IGTa accounts
  owned by IGV members — the reason IGV members showed on the IGT dashboard)
  were moved. The inline owner chip drops its ` · FN` suffix.
  ④ **The function switch is UNIVERSAL** (`accountFnTargets` replaces
  `canFlipB2bBd`): anyone who may edit an account and works BOTH functions
  moves it between them — IGV+IGT, B2B+BD, LCP/F&L across all five. The
  world-aware name check and 23505 mapping still gate every move.
  ⑤ **CIC — Customer Interview Calls** (the OGX second call): a sign-up the
  first assignee marked Contacted that never got a status appears in a new
  **📞 CIC** tab for MMs+, who hand it to a SECOND caller to verify the first
  call and follow up. The first assignee keeps the row and their KPIs/MOS
  untouched — the second call lives in `cic_*` columns and can never move the
  funnel. Every change (assigned / contacted / interested / status / CIC) is
  written to **`signup_logs`** and shown as a collapsible History in the
  detail dialog. The CIC caller pool is the whole function (deliberately NOT
  the reassign scope, which would let a Coordinator pick only themselves).
  ⑥ **IR calls get a Meet link without a member Google grant**: the event is
  created on the **IM mailbox calendar** (`ir_calls.event_calendar` records
  which calendar owns it), the IR is invited by email, the member is invited
  too, and the link shows on the IR-calls page. Cancel and reschedule follow
  the right calendar. Temporary until every member has AIESEC credentials.
  ⑦ **A promotion releases the member-level sign-up pool** (the Marwan case):
  Member/Coordinator → TL+ releases their status-less sign-ups to Unassigned,
  from BOTH the import and the in-app editor. His 61 were released (none
  carried a status, so no MOS moved).
  ⑧ **Attendance stops judging the caretaker**: role **Admin** is never in a
  touch-point audience or on an attendance sheet; inactive members drop out.
  ⑨ **Calendar scope filter**: Everyone · Mine · My team · My function
  (replaces the binary "Only mine"; key `sodio-calendar-scope`).
  ⑩ **Feedback on ANY past touch point you were part of** — attendance is no
  longer required (`listPastTouchPointsForFeedback`; `submitLcFeedback`
  re-verifies "can see it + it's past" instead of an attendance row).
  ⑪ **Editing what you logged**: contact attempts, comments and deal details
  (incl. opens, which recompute the account's counters) are editable from
  History. Side-effect logs (Visit Scheduled / Not Interested) stay locked —
  rewriting one would mean silently un-booking a visit or un-archiving an
  account. ⑫ **"Waiting for response" is hidden on Call** (it means a message
  sent). ⑬ The floating **test-view chip** got the same grab handle the
  sidebar tabs got in v33.18.

- **2026-08-06 · v33.18** — **ATTENDANCE TRUTH, MOVES & 12-HOUR EVERYWHERE.**
  ① **The working-hours engine called real work "absent"**: the rule wanted
  2+ actions **10 minutes apart**, so a BURST — ten contacts logged inside
  four minutes — failed the span test and marked a member out of a session
  they visibly worked (verified in prod against the Aug 6 LC session). The
  rule is now spread **OR** volume: `WORK_BURST_ACTIONS = 5` actions however
  tightly packed also counts. Six action types stamped nothing at all —
  proposal drafts, CV uploads, sign-up status/VP edits, Podio-updated,
  archiving — so a member could work a whole session invisibly; all now
  stamp (19 stamp sites, was 13).
  ② **A rename now travels** (`cascadeMemberRename` in data.ts, called from
  BOTH the in-app editor and the membership import, which is where renames
  actually happen): the IR log, touch points, calendar items, sign-up
  assignments and every member's manager-by-name carry a NAME SNAPSHOT, so a
  corrected spelling left the old string behind and filters offered the same
  person twice ("Elina Tallat" beside "Elina Talaat"). Prod snapshots fixed.
  ③ **An account follows its new owner across functions** (v32.6 did this
  only for claims and revives): any hand-over to someone who doesn't work
  the account's function moves it to theirs — leaving it behind was the bug,
  since it vanished from the new owner's list and kept counting on the old
  function's dashboard. The account page's picker offers the WHOLE raising
  world (IGV/IGT/B2B/BD/B2C) for UNOWNED accounts and for LCP-level viewers;
  a cross-world move maps 23505 to a readable archived-namesake message.
  ④ **Booked visits can be MOVED**: `scheduleVisit` already rescheduled in
  place (same row, same calendar event) — the UI never offered it. The
  History's pending visit gained "Move it", and the dialog now RE-SEEDS its
  date/time when the pending visit changes (it seeded once at mount, so
  "Reschedule" opened on a stale date and saving moved the visit back).
  ⑤ **12-hour time everywhere** (`fmtClock12` for stored wall-clock strings):
  calendar visit chips + day panel, all six visit emails incl. the invite
  SUBJECT, touch-point when-labels, attendance times, the account timeline.
  Values feeding `<input type="time">` deliberately stay 24h.
  ⑥ **TM dashboard drill-downs**: By function / By role / By member tabs —
  the member table is the chase list (worst rate first, colour-coded, with
  the attended/late/absent split on hover).
  ⑦ **Scheduled IR calls**: a **Mine** chip, the viewer dropped from the
  "With" list (compared by id, not name), and **weekday names** on scheduled
  rows and the call log.
  ⑧ **Arrange tabs has a real grab handle**: there was no drag implementation
  at all — anchors are natively draggable, so people were grabbing the link
  and fighting their own clicks. A `GripVertical` handle (32px touch target)
  is now the only place a drag can start, with drop-target cues; the ↑/↓
  buttons stay as the touch/keyboard path.

- **2026-08-06 · v33.17** — **THE SPEED & TM BATCH** (12 more floor reports).
  ① **Inline editing on the Raising table**: Podio (Requested + request
  state, Rejected still confirms + archives) and Responsible are compact
  selects right in the row; the Comment column gained a ➕ quick-comment
  button. Per-row `can_edit/can_reassign/can_request_state` flags computed in
  `listAccountsPage` (the actions still re-check).
  ② **Inline editing on the sign-ups table**: Contacted / Interested /
  Status editable from the row (per-row `can_work/can_set_status/can_vp`
  flags in `listSignupsPage`; Parents Approval stays VP-gated).
  ③ **Buffer semantics corrected** (the LCP's spec): the grid is contiguous
  when nothing is booked; a booked call re-anchors it — 6:00 call, 30m slot,
  10m buffer → next offered is 6:40, then 7:10. (v33.16's stride-always
  version lasted one release.)
  ④ **The 5-minute time picker is REAL**: Chrome ignores `step` on native
  time inputs, so the availability From/To became hour + minute(00-55 by 5)
  + AM/PM selects (`TimeSelect`); a 23:59 legacy value snaps to the grid.
  ⑤ **Dashboard drill-down defaults to "By MM"**.
  ⑥ **Partner-LC duplicates**: `normalizeLcName` (diacritics, case,
  whitespace, "AIESEC in "/"LC " prefixes — Turkish İ/ı folded) now guards
  BOTH creation paths (`addPartnerLc` + `bookIrCall`), the public booking
  page suggests known LCs (datalist) and auto-fills the country on a match
  (a country is also adopted onto a countryless row, add-only), and the
  three live duplicate pairs (İstanbul Asia, Eskişehir, kocaeli) were merged
  in prod with their calls/CVs/contacts repointed.
  ⑦ **Mobile sign-up cards were dead to taps** — iOS Safari only synthesizes
  clicks on pointer-styled elements; the card got `cursor-pointer` (+
  role=button) and opens the details again.
  ⑧ **Scheduled IR calls** gained With / Partner-LC filters (client-side).
  ⑨ **CV upload**: the "(optional)" label lied — the server has required the
  LC since v29; the label and the "— No LC yet" picker option are gone.
  ⑩ **Working-hours attendance computes itself**: opening the sheet after
  the window closes runs the engine automatically (guarded: never after a
  human confirmed, never in sandbox, never twice) — the Recompute button is
  gone. The nightly cron remains the fallback.
  ⑪ **THE TM DASHBOARD** (`?fn=TM`, TM core only — `isTmCore`; new
  `src/server/tm-stats.ts` + `TmPanel`): attendance rate/late/absent/excused
  over the last 30 days' CONFIRMED sessions, by kind and by member-function
  (multi-function members count in each lane; TM/F&L/CXP never judged on
  working hours), weakest-showing members (≥3 records), the awaiting-record
  chase count, MM/TL plan-filing compliance for the month (with missing
  names), the VP planning sheet's per-lane cells, and plan-vs-delivered
  bars (ICX opens from deals; OGX approvals approximated by status-set-this-
  month — the status has no date column). TM core also gained the
  /dashboard tab (layout gate).
  ⑫ Answered in v33.16 and still true: proposal emails never move accounts.

- **2026-08-06 · v33.16** — **CALENDAR, BOOKING & ACCESS BATCH** (7 more
  live reports; migration **0044 applied**).
  ① **Mobile Arabic keyboards broke login**: JS `\d` matches neither
  Arabic-Indic (٠-٩) nor Extended (۰-۹) digits, so `cleanPhone` and every
  identifier/digit extraction DELETED them — a member typing their number on
  an Arabic keyboard was told it doesn't exist. New `asciiDigits` in types.ts
  TRANSLATES both ranges to ASCII, applied in cleanPhone, authorize()'s
  identifier + phone-as-password paths, and probeMember. Also: a phone-only
  member who already SET a password used to get the shape-based "type your
  phone in both fields" tip — which no longer works for them and reads as
  "your number isn't on the membership" (Akmal, then Mohanad). A probe-based
  branch now says a password exists and to use it. Mohanad's password_hash
  was cleared in prod (his phone-in-both door is open again).
  ② **IR booking**: an availability window may END at midnight — "12 AM"
  (00:00) and the old 23:59 workaround both read as 24:00 in the window-fit
  check, the overlap detector AND the slot builder (a 22:00→23:59 window
  used to silently lose its 23:30 slot by one minute). Time inputs step in
  **5 minutes** (was 15) with a helper line under Add hours. **The buffer is
  real now**: the slot GRID strides slot+buffer (no two offered slots can
  ever be back-to-back — the old busy-pad check couldn't stop two IRs racing
  for adjacent slots), on top of the existing booked-call padding.
  ③ **F&L = LCP-level access** (by request): `master()` now includes anyone
  with F&L in their FUNCTIONS column — every module, lane, and account,
  incl. /signups (`ogxFunctions`/`canEditSignupVpFields` moved onto
  master()). Deliberately NOT following: admin tools and the LC-concerns
  inbox (people-feedback stays LCP+IM); F&L stays un-assignable as a
  responsible and never runs working hours. Locked by new rbac tests.
  ④ **Calendar "Only mine" switch**: hides the function's other visits/IR
  calls/touch points, keeps the viewer's own (visits by member id, IR calls
  by owner id — now carried in the DTO — touch points by a real audience
  test: `memberInTouchPointAudience`, the per-member predicate factored out
  of `touchPointAudience`). Persisted per browser (`sodio-calendar-mine`).
  ⑤ **CUSTOM CALENDAR ITEMS** (migration **0044**, `calendar_items`):
  Google-Calendar-style slots/tasks with an EXPLICIT assignee list —
  deliberately NOT a touch-point kind (no derived audience, no attendance,
  no reminder ladder). TL+ adds them: TL → self + their team, LCVP/Director
  → their function, LCP-level → anyone (server re-validates every assignee);
  owner or LCP-level deletes; assignees get a bell on add and remove.
  Green 📌 chips on the grid/agenda/day panel; "Add item" in the header and
  on any future day's panel. `src/server/calendar-items.ts` +
  `calendar-item-dialog.tsx`.
  ⑥ **Answered**: a TL sending a proposal email does NOT move the account —
  `createProposalDraft` writes `proposal_sent` only; the only ownership
  writer is the explicit reassign/claim picker.

- **2026-08-06 · v33.15** — **THE PRODUCTION-INCIDENTS BATCH** (8 issues
  reported live from the winter-WH floor, all root-caused before fixing;
  migration **0043 applied**).
  ① **A member was 494-locked out of the site** (Vercel
  `REQUEST_HEADER_TOO_LARGE`): the credentials `authorize()` returned
  `image: member.avatar_url` — a 33KB uploaded-avatar DATA URL — which
  Auth.js's default jwt callback stored in the session cookie: ~45KB across
  ~12 chunked cookies, past Vercel's ~14KB header cap, rejected at the edge
  before any app code could even clear it. Nothing in the app reads
  `session.user.image` (avatars render from the DB row), so the token now
  carries only a short https photo_url or null, and a defense-in-depth `jwt`
  callback strips any `data:`/oversized picture from every token mint. The
  affected member clears site cookies once and signs in with phone +
  password (he HAS a password — the phone-in-both-fields door closes the
  moment one is set; that part was working as designed).
  ② **32 live accounts were unreachable at their own URLs** ("you don't have
  access", admin included — 16 of them BD, because that crew names accounts
  after Instagram handles): the v33.7 slug lookup STRIPPED `_`/`%` from its
  ILIKE pattern (shortening it so "omama_burgerhouse" could never match its
  own row) instead of neutralizing them. New `slugLikePattern` in types.ts
  turns every LIKE metachar (and dash) into the single-char wildcard `_` —
  position-preserving — with the exact accountSlug comparison in JS kept
  (now encoding-agnostic, so Arabic names with real dashes resolve too).
  Same fix in `checkAccountName`, which had silently stopped blocking
  duplicates of underscore/percent names. Tests: `tests/slug-lookup.test.ts`
  pins "every real account name resolves at its own URL" over the actual
  regression set.
  ③ **The membership write-back was corrupting the sheet on every first
  sign-in**: `writeMemberToSheet` still wrote POSITIONALLY against the
  pre-v33 10-column layout (Nickname included) — after v33 deleted that
  column it could no longer find anyone's row (it read C:D expecting
  Email/Phone) and appended a one-column-shifted duplicate, which the
  import's shifted-row guard then skipped forever (so in-app edits were
  silently reverted half-hourly). The writer now resolves columns BY HEADER
  via the same `mapColumns` as the import (pure logic split into
  `sheet-row.ts`, locked by `tests/sheet-writeback.test.ts` on the current,
  legacy AND reordered layouts) and ABORTS LOUDLY when headers can't be
  resolved. The live sheet held ZERO shifted rows at ship time (Ahmed had
  been deleting them by hand) — the fix stops new ones from appearing.
  ④ **Removing a member's email created a stranded duplicate** (Menna's
  lockout): `findPhoneKeyed` only matches email-NULL rows, so a sheet row
  whose email was removed couldn't adopt the member's email-bearing DB row →
  duplicate inserted → next import deactivated it → her phone-keyed session
  resolved to the DEAD duplicate (memberByPhoneDigits preferred email-less
  rows regardless of is_active) → every onboarding submit bounced to
  /inactive, which read as "the Enter Sodio button doesn't work". Fixes: the
  import's email-less branch now ADOPTS an email-bearing row by EXACT
  full-digit phone match when that email is gone from the entire sheet
  (clearing the email — the sheet is the source of truth);
  `memberByPhoneDigits` prefers ACTIVE rows; her duplicate was merged away
  in prod.
  ⑤ **B2B ↔ BD flip exists**: the Details card gains a Function switch on
  B2B/BD accounts (`canFlipB2bBd` in rbac = may edit the account + may
  create under BOTH labels — crew, their TLs, the function's + IGV/IGT
  VPs/Directors, LCP/admin). Server-side the flip re-runs the world-aware
  name check against the TARGET world (0034 put BD in the service world:
  `checkAccountName` gained `excludeId`) and maps the 23505 race; audit rows
  carry function_from/to. Lanes, KPIs, mirrors and deal rules all read the
  live column, so the account moves whole.
  ⑥ **"Waiting for response" contact result** (migration **0043**: enum value
  + accounts_pipeline counts it in `no_response_attempts`): the DEFAULT
  result for WhatsApp and Email attempts (Call keeps "No Response"; a
  hand-picked result is never overwritten by a method change). It counts as
  UNANSWERED for the 3-contact rule both in the view and in logContact's
  `answered` count. Offered in the Log dialog + Last-result filter; renders
  amber like "No Response".
  ⑦ **OGT sign-ups stop resurrecting the old membership**: the import
  matched tracker "Assigned to" names against ALL active members, so people
  who LEFT the function but stayed in the LC (Menna → OGV ×130, Hana Wael →
  BD ×99) kept collecting OGT rows every 15 min — matching is now scoped to
  the tab's own function, the 229 rows were released to Unassigned
  (sodio_touched=true so the sheet can't re-apply them), ~576 rows carrying
  a raw ex-member name with no match were cleared the same way, and the
  Assigned filter is built from CURRENT membership (active + in-function,
  LCP excluded) instead of raw sheet names — which also swept OGV's leftover
  nickname options.
  ⑧ **Dead Call/WhatsApp buttons on phone-less sign-ups**: tracker
  placeholder phones ("-", "deleted phone number") passed truthiness guards
  and rendered `tel:-` / `wa.me/null` buttons on mobile cards, the desktop
  quick-actions cell and the detail dialog — all four spots now gate on
  `hasPhone` (digits exist), the importer nulls digit-free phones, the 62
  existing placeholder rows were nulled in prod, and the phone=missing
  filter treats "-" as missing.

- **2026-08-04 · v33** — **THE HARDENING RELEASE: an audit, a test suite, and
  the first real backups.** Migrations **0033–0037 all applied**.
  ① **BACKUPS EXIST** (`src/server/backup.ts` + `/api/cron/backup`, pg_cron
  02:00 UTC). Supabase's free tier has **no automated backups at all** — losing
  the database meant losing every account, member, deal and comment,
  permanently. The job dumps all **27 data tables** (19k rows, gzipped to
  ~1.2 MB) to the private `backups` bucket keeping **30 days**, emails a
  gzipped copy to the IM mailbox (a backup living only inside the thing it
  backs up is not a backup), and drops a third copy in the **CRM Drive folder**
  where the EB can see it. It is LOGICAL (rows, not schema): restore = run the
  migrations, insert the arrays. **The Drive copy needed a new token**: a
  service account has NO storage quota of its own, so it can create folders but
  every file upload returns "Service Accounts do not have storage quota" —
  which silently affected IR-call screenshots too. Drive FILES are now written
  as the **IM mailbox** (`driveAsMailbox` in `google/drive-upload.ts`, service
  account kept as fallback), and `scripts/mint-mailbox-token.mjs` asks for
  **mail + calendar + drive + spreadsheets** in one consent (re-minted
  2026-08-04). That script also had a latent bug: it defaulted to a redirect
  URI (`http://localhost:3000`) that was never registered on the OAuth client
  → `redirect_uri_mismatch`; it now uses the registered
  `/api/auth/callback/google` path and forces `select_account` so a personal
  Gmail can't be approved by mistake. A table that doesn't exist yet is
  recorded and skipped rather than sinking the run; a failure returns **500**,
  because this is the one job whose silent failure is indistinguishable from
  success until the day you need it. `sendEmail` learned attachments
  (multipart/mixed) to carry the off-site copy.
  ② **SECURITY & RELIABILITY AUDIT** (`SECURITY_RELIABILITY_AUDIT.md` — 16
  findings, architecture, threat model, verification, manual actions).
  **Dependencies**: 2 critical + 5 high → 0 critical / 1 high. The serious one
  was a **middleware/proxy bypass** in Next's App Router (16.2.10 → 16.3.0) —
  `src/proxy.ts` is this app's ONLY route guard, so every authenticated page
  sat behind the vulnerable component. `@auth/core`/`next-auth` patched too.
  `xlsx`'s high has NO upstream fix (client-side parsing of a file the member
  chose) — documented, not silently ignored. **Headers**: production had none
  but HSTS; now a **full CSP** with every host enumerated from the source
  (dicebear + googleusercontent, supabase.co, googleapis/generativelanguage,
  podio.com, core.aiesec.org.eg, docs.google.com), plus frame-ancestors 'none',
  nosniff, Referrer-Policy (account slugs live in URLs), Permissions-Policy,
  no-store on app routes, `poweredByHeader:false`. `script-src` deliberately
  keeps 'unsafe-inline' — Next injects inline bootstrap/hydration and threading
  a nonce through middleware is exactly the mistake that white-screens the CRM
  for 70 people; `object-src 'none'`, `base-uri 'self'` and `form-action
  'self'` still close plugin injection, base-tag hijacking and form
  exfiltration. **Uploads** (contracts + CVs) took ANY file type: active
  content and executables are now rejected, checking the LAST extension so
  `cv.pdf.html` can't slip through (a denylist by design — the legitimate set
  is open-ended and an allowlist would push people back to WhatsApp).
  **/robots.txt** redirected to /login, so a private CRM holding member PII
  gave crawlers no directive; now `Disallow: /`.
  ③ **THE REPO HAS TESTS** — 58, exercising the real functions, no mocks
  (Vitest). `tests/rbac.test.ts` (35) guards the engine every read and mutation
  passes through and which **nothing protected until now**: scope isolation,
  IDOR (an owned account is never claimable; an archived one is world-readable,
  never world-writable), lane isolation, oversight-is-not-authority, the
  IGT-only CV pool, B2C/BD isolation, the admin capability split.
  `tests/validation.test.ts` (23) feeds the real parsers hostile input —
  invisible-character phones, header injection, `javascript:`/`data:` URLs,
  path traversal through `accountSlug`, Podio's third-party JSON.
  `parseSearchResults` was extracted from podio.ts so the live path is
  testable, and its safety property asserted: unusable input returns **null**
  (→ "unknown"), never a confident "not on Podio".
  ④ **HOSTING QUOTA** — the project hit **97.5%** of the Hobby Fluid Active CPU
  allowance. `AutoRefresh` polled every 30s per open tab and a dashboard render
  reads the whole ~3,800-row account table: forty tabs open ≈ 115k renders a
  month redrawing numbers that hadn't changed. **Background polling is gone**;
  refresh happens on focus/visibility, which is when staleness is actually
  perceived, and costs nothing while a tab idles.
  ⑤ **NICKNAMES REMOVED** everywhere (two members sharing "Farah" made the
  responsible, manager and leaderboard columns ambiguous exactly where it
  mattered). The prerequisite shipped with it: **the membership import reads by
  HEADER NAME, not column position** — deleting the Nickname column used to
  shift Email into its slot and Phone into Email's, for all 77 members, twice
  an hour, with no error. Headers are matched loosely and the import **aborts
  loudly** if Name plus an email or phone can't be found.
  ⑥ **Admin is a capability, not a rank** (0037): `"Admin"` is a real role AND
  a sub-function — `canUseAdminTools` grants the tools without granting the
  whole LC, so a VP who also keeps the system running keeps exactly their own
  modules. Multi-value Role cells ("LCVP, Admin") parse properly; before this
  they imported as **Member**.
  ⑦ **Virtual touch points + Routines** (0036): meetings can be virtual with a
  real Meet link and **RSVP-driven attendance** read back from Google Calendar;
  the switch appears for MEETINGS ONLY (working hours are people sitting and
  working; an outing is by definition somewhere). "Timeline" is renamed
  **Routine** — the builder creates a whole peak's touch points up front.
  ⑧ **BD is its own world** (0034) — its own dashboard, visible to BD only, no
  longer folded into B2B. **Standing teams derive from the membership** rather
  than being registered by hand. **Cross-function claiming**: an unowned market
  research account can be claimed by anyone with create rights, in any
  function. **IR booking takes a phone with country code** (0035) + a WhatsApp
  button, and IR-facing mail stops leaking the internal CRM link.
  ⑨ **Column filters everywhere** (the general rule, not just accounts), quick
  actions are a mandatory column, and the **Comment column** shows the comments
  themselves (the first version joined `members!author_id` when the column is
  `member_id` — PostgREST rejected the query, the error was swallowed, every
  row rendered "—"). **Hotlines** (5-digit Egyptian short codes like 16123) are
  valid numbers, stored as dialled, never WhatsApp-tagged — and neither are
  landlines. A **contact-logged-as-a-comment nudge** recognises a contact
  result as it's typed (English and Arabic) and offers to log it properly: a
  nudge, never a block, because guessing wrong must not cost someone their
  note. **"Next working hours"** sets the next step to the viewer's next booked
  session. The **3-contact-limit flag** is retired for **"🔎 Needs Podio
  checking"** — a queue someone can act on. The **sidebar collapses** to an
  icon rail from a "Collapse" row at the foot of the nav.
  ⑩ **The login error was invisible** — `text-destructive` on
  `bg-destructive/10` painted as a solid red block on mobile, so a member whose
  AIESEC email had just landed saw a blank red panel instead of "sign in with
  Google once". Fixed with explicit light/dark tokens. **The Blue Man** stops
  answering English questions in Arabic and stops declining questions it can
  actually answer. **LB launch drafts** — one letter per ROLE, tailored, into
  the IM Gmail as drafts, never a localhost link.
  ⑫ **Dashboard filters list the LANE, not the viewer's whole scope**
  (v33.1): the team filter offered every team the viewer could see, so the LCP
  on IGT was shown the whole LC's teams and an IGV VP was shown B2B's — teams
  with no rows in that lane at all (`rowInLane` matches the account's OWN
  function), so picking one emptied the dashboard rather than narrowing it.
  `listTeamFilterOptions(viewer, { fn })` now scopes to the lane (same fix on
  the Raising list). The member filter drops **VPs, Directors and Admins** (the
  whole function is already theirs — the LCP was excluded for that reason
  since v9) and is scoped to the lane too.
  ⑬ **Sidebar footer**: the profile name always rendered as "A…" — three icon
  buttons beside the avatar left ~60px in a 15rem sidebar. The name now owns
  its row and the buttons sit beneath it as three equal segments
  (notifications · appearance · sign out).
  ⑪ **Ops**: `attendance-reminders` was still firing at
  `elevate-alex.vercel.app`, the alias **removed in v32.1** — it had been
  hitting a dead domain since; repointed at sodio.vercel.app.

- **2026-08-03 · v32.3** — **SIMPLER FORMS, COLUMN FILTERS, A REAL WALKTHROUGH.**
  ① **Add-account form slimmed**: the Function picker is hidden for anyone with
  a single allowed function (it was a disabled one-option dropdown); the
  contacts editor lost its smart-tagging explainer (the auto-tagging still
  happens, it just stops narrating); and **"Requested on Podio?" left the form
  body** — it now appears INSIDE the 🔎 not-found result as "I already
  submitted it", because asking whether you requested a name Podio already has
  is a nonsense question. The ⚠️ already-on-Podio wording no longer claims the
  partner belongs to another LC — **it can be ours**.
  ② **The B2B/BD Podio worklist is GONE** — "Podio pending" filter, copy-name
  button, inline request-state select, "Ask to submit", the owner-side "Submit
  on Podio" pin and its top-of-list ordering, plus `requestPodioSubmit`, the
  `podioPending` filter and `canRequestPodioSubmit`. B2B and BD behave exactly
  like every other function; the account page's own Request State card covers
  the real need. `accounts.podio_submit_requested_at` stays in the DB unread.
  ③ **Column filters** (`ColumnFilter` in `data-table-kit.tsx`): the rule is now
  *if an attribute is a COLUMN, you filter it from the column* — a funnel
  button beside the column name, Google Sheets style, filled while active and
  cleared by re-picking. Accounts moved Product / Project / Sub product /
  Status / Last result / Responsible onto their headers; sign-ups moved Batch /
  Program / Contacted / Interested / Potential / Phone. The filter bar keeps
  only NON-column attributes (search, function, flags) plus the Date-added
  range, which is a range control with no sensible dropdown form. **Mobile card
  views have no header**, so the moved selects are wrapped in
  `contents md:hidden` rather than deleted — phones lose nothing.
  ④ **THE WALKTHROUGH IS A WALKTHROUGH** (`guided-tour.tsx`): the slide deck is
  gone. Each step points at a REAL control on a REAL page — it navigates there,
  clicks open the dialog the target lives in, spotlights the element (a ring
  plus a 9999px shadow, no SVG mask) and says one short line. The raising path
  walks the Raising tab → Add account → **the name field, with the three live
  checks** → the contact rows → search & the column funnels → the table → the
  dashboard. Reliability is the point: a target that never appears is SKIPPED
  rather than left pointing at empty space, the spotlight re-measures on
  scroll/resize/DOM change, and Escape or ✕ always ends it. Targets are
  `data-tour="<id>"` anchors — **keep those ids stable**, they are the contract
  between a view and the tour. Storage key `crm-tour-v3:`.

- **2026-08-03 · v32.1** — **THE RENAME IS REVERTED: the system is SODIO again.**
  v28's Sodio → Elevate rename is undone — **173 user-visible strings** across
  38 files went back to **Sodio** (sidebar, tab titles, manifest, login,
  onboarding, tour, playbook, The Blue Man, /inactive, both /book pages, and
  **every email template + subject line**), plus 3 `ELEVATE` wordmarks and the
  7 `elevate-alex.vercel.app` links.
  **URL:** `NEXT_PUBLIC_APP_URL` → `https://sodio.vercel.app` and the
  **elevate-alex.vercel.app alias was REMOVED from the project** — so the IR
  booking links members share (`sodio.vercel.app/book/<slug>`) and every link
  inside an email now carry the Sodio domain. `aiesec-alexandria-crm.vercel.app`
  still resolves.
  **Two things deliberately NOT touched:** `elevate2point0.com` (the separate
  "Created by 2.0" credit — a different thing entirely, not the brand) and the
  `elevate-table:<id>` localStorage key for saved table column layouts —
  renaming it would silently reset everyone's column order and visibility, the
  same reason v28 kept the `sodio-*` keys.
  The v28/v29 changelog entries are kept as history and marked reverted; the
  dead "Sodio is now Elevate" announcements were removed from the Playbook and
  the Blue Man, which now states plainly that the system is Sodio at
  sodio.vercel.app and that any "Elevate" mention is the reverted name.

- **2026-08-03 · v32** — **RAISING, LANES, PODIO & THE CHANGE JOURNAL.**
  ① **"Accounts" tab renamed "Raising"** (nav, tab title, page hero,
  playbook); the `/accounts` route is unchanged.
  ② **Dashboard lanes are named for the SIDE they show** — IGV Raising ·
  IGV Consideration · IGT Raising · IGTa Raising · IGTe Raising · IGT
  Consideration · OGT · OGV · B2B · B2C — and gated on the work the viewer
  actually does (`worksSide` in rbac): a Member/Coordinator/Team Leader gets
  exactly the side(s) their **Sub Function** column names, an LCVP/Director
  gets BOTH sides of the product function they lead (bound to `icxFunctions`,
  so a B2C or BD Director never picks up IGV/IGT consideration), and **nobody
  sees the other product's lanes** (before this, any Consideration label
  handed out both IGV *and* IGT consideration). `seesEveryLane` gives the
  **LCP/admin + the TM and F&L leadership** every lane, and /dashboard is now
  reachable for them. The module gates stay deliberately narrower than the
  lane lists: `hasConsiderationAccess` and `ogxFunctions` still answer "may
  you WORK this", so overseeing a lane never grants the right to work a
  sign-up, an IR call or the CV pool (`ogxLanes` is the dashboard-only twin).
  ③ **Quick actions open the REAL contact form** — tapping WhatsApp/Call/Email
  opens the normal ContactDialog with the method pre-selected and every result
  available; the reduced `QuickContactPrompt` and its "Open the full contact
  form →" link are gone.
  ④ **AUTOMATIC PODIO CHECK** (`src/lib/podio.ts`): while the account name is
  typed, Sodio answers "is this already on Podio?" itself, by calling the
  national form's OWN dropdown search —
  `GET /webforms/<form>/<rev>/items_search?field_id=<id>&query=<q>&limit=50`.
  It is public (no key, token or cookie) and returns the same ordered list the
  member sees, best match first, over the WHOLE Companies app. `field_id` is
  discovered from the form's embedded config (cached a day in `app_settings`
  `podio:field-id`, with the known id as fallback) and results are cached
  10 min per query in-process. Verdicts: ⚠️ already on Podio (don't submit a
  duplicate — add it here and ask the MM for the request state) · 🔎 not on
  Podio (submit it, with whatever Podio DID return listed as near-misses) ·
  nothing at all if Podio is unreachable (fails SOFT to the manual link).
  **v32.2 correction:** the first version parsed the ~300 `<option>` tags
  embedded in the form's HTML. Those are only the dropdown's FIRST PAGE — the
  field is an app-reference whose select2 queries the server on every
  keystroke — so anything outside them ("Gateway", for one) was reported "not
  on Podio". There is no 300-item ceiling any more.
  ⑤ **Phone paste fix**: `cleanPhone` now reduces a pasted number to `+`? +
  digits. Invisible characters (bidi marks from Arabic chats, zero-width
  spaces, soft hyphens, BOMs) used to survive it, so a number that LOOKED
  perfect kept failing with nothing the member could see or delete — the error
  never went away. The membership field also rewrites itself on blur to what
  the system sees and gives the specific reason.
  ⑥ **Plans follow the member's CURRENT job**: `stillPlans` re-checks every
  plan row against the live membership (so `listMmPlans`/`listTlPlans` drop
  what no longer applies), `prunePlansForMember` cleans up on an in-app edit
  and `pruneStalePlans` sweeps the LC at the end of every membership import —
  where role/sub-function moves actually happen. Farah Hossam's 6 stale
  consideration months were deleted (she is a Raising Coordinator now).
  ⑦ **THE CHANGE JOURNAL** (migration **0033**, ⚠️ *run it in the SQL editor*):
  every action now carries a **change set** (one server-action call = one
  request = one uuid), and the v21 sandbox journal records **always**, not just
  in a sandbox. On that: **Undo from the logs** — /admin gains a per-entry
  Undo, checkbox selection and a bulk "Undo N actions" bar; entries with
  nothing to replay (pre-0033, sign-ins, sent reports) show a disabled
  checkbox instead of a button that would lie. And **LC-wide testing
  sessions** — the admin opens ONE session for the whole LC, everyone's writes
  are journaled, and stopping either rolls them all back or keeps them.
  **⚠️ Side effects are NOT suppressed in an LC session (deliberate choice):**
  emails, notifications, calendar events and the Sheets write-back fire for
  real and cannot be undone — only the DATABASE is restored; permanent deletes
  of archived accounts are blocked while one runs. `pruneJournal` drops
  unowned rows after 30 days. Pre-0033 grace: `logAudit` falls back to the
  classic row on 42703 and `listRecentAudit` to the classic select.
  ⑧ **Onboarding rebuilt**: the tour now opens with **what Sodio is and how
  it fits together** before any tab, and the raising walkthrough is a real
  walkthrough — adding an account (with the three live checks), opening and
  editing it, the action bar (Contact · Visit · Deal · Proposal), the golden
  rule, visits and reminders, and the shared archive. The storage key moved to
  `crm-tour-v2:` so everyone gets it once, and the Playbook gained a **"↻
  Replay the walkthrough"** button (before this, a dismissed tour was gone for
  good in that browser).
  ⑨ **Data cleanup**: the two hand-made junk accounts behind the wrong
  dashboard numbers were deleted — "test1" (IGT, El-Saied) carried the ONLY
  contact_attempt in the entire database, and "Test" (B2C, Ali) carried a
  scheduled visit. Both had been *archived* rather than deleted, and archiving
  does not remove an account from the funnel counts.

- **2026-08-09 · v31.2** — The contact-after-click hand-over keeps the channel:
  `ContactDialog` gained an optional `defaultMethod` (re-seeded when a later
  open carries a different channel, still hand-changeable), and the accounts
  list passes the tapped channel through "Open the full contact form →" — so
  a WhatsApp tap that needs the branching results (Not Interested → archive,
  Visit Scheduled → books the visit) no longer silently reverts to "Call".

- **2026-08-09 · v31.1** — Follow-up: the rows-per-page picker really is on
  EVERY paginated table now. v31 shipped it on accounts + sign-ups only while
  the release note claimed all of them — **attendance** (`?size`, whitelisted
  in the page and re-checked in `listAttendanceHistory` via the new
  `PAGE_SIZE_OPTIONS`) and **consideration** (IR-call log + CV pool — both
  reads already took `pageSize`, only the page/view wiring was missing) now
  carry it too.

- **2026-08-09 · v31** — **THE TABLES RELEASE** + smart contacts, branding and
  dashboard fixes. ① **Universal table kit** (`src/components/crm/data-table-kit.tsx`):
  `useTableColumns(tableId, cols)` (order + visibility persisted under
  `elevate-table:<id>`, self-healing against corrupt/stale keys, new columns
  appear at their defined position), `<TableSettings>` (drag + ↑/↓ reorder,
  show/hide, Reset), `<PageSizePicker>`, and a re-export of the v25 sorting
  kit — wired into **7 tables**: accounts, archived, sign-ups, TM directory,
  attendance history, IR-call log and a NEW desktop CV table. Dozens of
  optional columns ship default-hidden. ② **Sign-ups columns**: the Unassigned
  view drops Status + Country, drops Program on **OGV** (all GV), and adds
  **Person status** + **Campaign**; sign-ups gained `?size` (30/50/100/200).
  ③ **Contact-after-click**: tapping WhatsApp/Call/Email on an account or
  sign-up opens the link AND prompts to log the contact with the method
  pre-selected (`QuickContactPrompt` / `SignupContactPrompt`, dismissible).
  ④ **Smart tagging** (`guessLinkTag`/`guessEmailTag` in types.ts, wired into
  ContactsEditor): instagram/linkedin/facebook/whatsapp links and
  ceo@/hr@/manager@/info@ addresses tag themselves, always overridable.
  ⑤ **Account creation is the first History entry** (`accountCreationEntry`
  in data.ts — who/when/what, incl. bulk-import provenance).
  ⑥ **BD deal dialog simplified**: the per-product opens breakdown is behind
  a switch, OFF by default (amount + benefits stay the BD MOS).
  ⑦ **Filter options match the view**: `listVisibleMembers` now applies the
  account WORLD as well as the scope (the LCP/admin's "all" scope used to
  list the whole LC, so OGX/TM people appeared in the raising Responsible
  filter) and takes `{ fn }`, wired from the accounts page. **Regression
  caught in review**: the Blue Man's roster used that same function, so the
  admin's assistant lost every TM/OGX/CXP/F&L member — it now uses
  `listAllMembers`. ⑧ **OGX Dashboard tab** appears for OGX/consideration
  (was raising-only), **profile page no longer clipped**, the **OGV streak
  card moved onto the dashboard for every OGV member** (not just MMs), and
  **KPI cards** moved their explanatory line into the hover tooltip with a
  louder label/value. ⑨ **Real AIESEC-Alexandria branding** on every external
  surface: new `brand/alex-blue.png`+`alex-white.png` (716×408), icons
  192/512 + a true full-bleed maskable 512, app icon + apple-icon — wired
  into the manifest, login, both /book pages and /inactive.
  ⑩ **Touch points**: a PAST start is now allowed (logging something that
  already happened) and sends **nothing**; every touch point gained a
  **"tell everyone invited"** switch (default ON).

- **2026-08-08 · v30** — **TM CORRECTIONS** (the v29 module shipped with the
  wrong booking matrix and no confirmation step — all found by the user).
  ① **One scope per role** (`bookableTouchPointScopes` rewritten as an
  ordered matrix, enforced in `createTouchPoint` with a rule-shaped refusal):
  **Team Leader → team ONLY** (own team, may invite sibling teams),
  **LCVP/Director → function ONLY**, **TM core → LC ONLY** (checked BEFORE
  the LCVP branch so a TM VP is TM first), LCP/admin → everything. The dialog
  shows only what the role may book and prints the rule.
  ② **Sandbox never touches other people** (new `src/server/tm-notify.ts`):
  in a test view the bell goes to the ACTING VIEWER ONLY (written directly,
  🧪-marked, undo-journaled — `notifyMembers` suppresses everything in a
  sandbox, so the tester used to see nothing), and no touch-point or appeal
  mail is sent; `appealAttendance` previously emailed REAL people from a test
  view — now gated. ③ **Working hours need human confirmation**:
  `runWorkingHoursAttendance` still pre-fills the rows but no longer stamps
  `attendance_recorded_at` or resolves prompts — `saveAttendance` is the only
  stamper (its no-op early-exit removed so a pure review confirms; coverage
  re-read from the rows so a locked own-row can't block it), the cron's
  working-hours skip is gone so unconfirmed sessions ride the same
  3-reminder → prompt ladder, and the UI says "AI pre-filled — review &
  confirm". The nag moved to **20:59 UTC = 23:59 Cairo** as asked.
  ④ **TM page filters** — This month / This sprint chips + from→to range
  (`clampDirectoryWindow`, Cairo→UTC half-open bounds, re-clamped server-side
  so a hand-typed URL can't widen it); default stays all-time.
  ⑤ **Every LCVP and Director is out of the TM performance review** (plus the
  LCP, CXP's people and TM's own MMs) — the tab reviews Members,
  Coordinators and Team Leaders. ⑥ **The empty team picker fixed** — an MM of
  a function is now automatically offered that function's "Function leaders"
  team (B2B/BD counted as one). ⑦ **Calendar day view**: clicking any day
  opens that Cairo day's touch points, IR calls and visits plus **"Book a
  touch point on this day"** with the date pre-filled (TouchPointDialog
  gained optional `defaultDate` + controlled open). Playbook v30; the Blue
  Man teaches the corrected matrix and the confirmation step.

- **2026-08-08 · v29.3** — Docs caught up with the TM module (the v29 docs
  agents had crashed, so this was owed): **The Blue Man now teaches TM** —
  touch points (the three kinds × three levels, who books what, start-time
  only, invites, move/cancel with re-notification and the TM VP on CC), the
  unified calendar and who sees what on it, attendance (who records, who may
  edit, never your own row), the **automatic working-hours rule** in plain
  words (≥2 real actions ≥10 min apart, the human edit always wins), appeals
  and the 3-reminder → blocking-prompt ladder. **Playbook** gained the
  move/cancel line it was missing.

- **2026-08-08 · v29.2** — **THE v29 REVIEW PASS** (24-agent adversarial
  review of the shipped TM module → **16 confirmed findings, all fixed**).
  The big one was **CRITICAL**: `createTouchPoint` validated the function but
  NEVER the team, and `touchPointAudience` matched team names globally — so a
  Team Leader could book a "team touch point" naming ANOTHER team, become its
  owner, and write **absent** rows against members they have no authority
  over (reachable from the UI, since the picker was handed every team in the
  function). Fixed on three layers: team names now resolve against
  `invitableTeams(fn)` server-side with a Team Leader PINNED to their own
  team, the picker only offers what the role may pick, and the audience's
  team branch additionally requires the member's functions to intersect
  `function_key` (so legacy rows stop matching). Also fixed: **update/cancel
  were dead code** — nothing called them, so a booked touch point could never
  be moved or cancelled (new `touch-point-manage-dialog.tsx`, per-point
  `canEdit` computed server-side, re-notification on both); the start time
  was built in the BROWSER's timezone (now `date`+`time` Cairo wall-clock via
  `cairoToUtc`); a prompt filed for a later-cancelled touch point could block
  a member forever (`cancelTouchPoint` resolves prompts + `openPendingPrompt`
  self-heals stranded rows); the working-hours engine ignored account work
  (`stampWork` on create/update/import, once per import); manual working-hours
  rows could be written before the session (now gated on
  `workWindowClosed`); `expandTouchPointFns` stops B2B/BD splitting a function
  in half; the manage page compared two ISO formats so the IR's current slot
  was never excluded; the calendar saw only the 50 newest IR calls (now
  range-queried) and used UTC day bounds for a Cairo grid; the attendance
  history filtered on UTC midnights; a failed reminder email skipped the
  counter so it re-sent daily; `listPartnerLcDetails` counted unpaged.
  **Migration 0032 was applied to prod with no file in the repo — the file
  now exists** (idempotent, a no-op against prod).

- **2026-08-08 · v29** — **THE TM MODULE** + a 20-item fix batch.
  ① **Touch points** (migration **0031 applied**: `touch_points`,
  `touch_point_attendance`, `attendance_appeals`, `work_activity`,
  `pending_prompts`): Team Leaders book team meetings / working hours /
  outings, VPs & Directors the function ones, TM core the LC ones (LCP
  everything — `bookableTouchPointScopes` in rbac). START time only, optional
  note, invites (sibling teams for a team point, other functions for a
  function point; TM/F&L/CXP never invited and never run working hours).
  Create / move / cancel-with-reason each **email + bell the whole audience
  with the TM VP on CC** (`src/server/touch-points.ts`, audience +
  visibility in `touch-points-read.ts`, templates in
  `email/touchpoint-templates.ts`). ② **ONE calendar for everyone**
  (`/calendar` rewritten): touch points (purple) + IR calls (teal) + visits
  (per-member colours) in a single month, each viewer seeing what they belong
  to; TM core sees the LC, a member sees other teams' points inside their own
  function; nav opened to every module member. ③ **ATTENDANCE**
  (`/attendance`, everyone): manual attended/absent/late + excuse, scoped
  reads (self → team → function → LC), appeals (email to the recorder with TM
  on CC), and **automatic working-hours attendance** — ≥2 real work actions
  ≥10 min apart inside `starts_at −15min → +4h`, fed by `stampWork` in 10
  existing actions, never overwriting a human edit. ④ **The general
  must-do ladder**: `attendance-reminders` cron (daily 21:00 UTC, scheduled
  in pg_cron) nags the responsible once per Cairo day, and after **3
  reminders** files a `pending_prompts` row that blocks the app with a prompt
  on next open (generic kind/ref_id/title/link — reusable). ⑤ **TM
  directory** honours who is actually reviewed there (LCP, F&L VP/Director,
  CXP MMs+leaders and TM's own MMs dropped), its **OGX row now mirrors the
  real funnel** (Sign-ups→Contacted→Interested→Applied→Accepted→Approved★)
  and the role filter gained **MMs (TLs & Coordinators)**. ⑥ **Booking v3
  fixes**: booker **name + role are mandatory** (`ir_calls.booker_role`,
  migration 0032), availability in **15-minute steps**, **5-minute buffer**
  option, a member's reschedule request needs a **reason** that reaches the
  IR verbatim, the IR's manage page no longer offers the slot they already
  have (+ server guard) and their cancel needs **no** reason, the "When are
  your B2C campaigns?" question is gone, CVs require an LC, LC country is the
  branded autocomplete, **MMs can rename LCs**, and the LC registry now shows
  what the calls collected (country, call/CV counts, the IR people with role
  + email). ⑦ **IR-facing emails never mention the CRM** — new
  `externalEmailLayout` (no "Open the CRM", no internal wording) on every
  booker-facing template. ⑧ **Sign-ups name matching fixed**: a bare first
  name ("Ahmed") no longer resolves to whoever happens to prefix-match — it
  stays unmatched until a leader assigns it; the **100 rows wrongly assigned
  to the admin were released** in prod. ⑨ Onboarding **Skip removed** (the
  tour is the manual), **"LC Feedback" → "Feedback"**, and the Playbook tells
  members to put their @aiesec.net mail on their phone with notifications on.
  ⑩ Prod URL env switched to **elevate-alex.vercel.app** *(reverted in v32.1)*.
  ⑪ **Consideration splits per function** on the dashboard (`CONS_IGV` /
  `CONS_IGT`, `considerationFunctions` in rbac; a call is attributed via its
  OWNER's functions — ir_calls has no product column; the CV cards only exist
  on the IGT lane). ⑫ **/admin Health refreshed** to the real system (all 8
  crons with cadence-derived staleness, today's table counts, both storage
  buckets, NEXT_PUBLIC_APP_URL). ⑬ **Feedback on a touch point you attended**
  (`listAttendedTouchPoints` + an optional `touchPointId` on
  `submitLcFeedback` — server re-verifies attendance; positive shouts out the
  owner, negative goes to the private inbox; no migration). ⑭ **Mobile pass**:
  real overflow fixes across consideration (scheduled-call rows, action
  groups, CV cards/search), attendance (owed rows, appeals free text),
  calendar agenda notes, sign-up comments/OOP reasons, the members phone card
  and the consideration KPI cards — `min-w-0 flex-1` where truncate was inert,
  `break-words` on free text, `flex-wrap` on button groups, `max-h-[90dvh]`
  on the uncapped dialogs.

- **2026-08-08 · v28** — **ELEVATE + BOOKING v2 + OGX DASHBOARDS.**
  ① **Renamed Sodio → Elevate** *(REVERTED in v32.1 — the system is Sodio)*
  (~120 user-visible strings: sidebar, titles,
  manifest, ALL emails, Playbook, Blue Man, login, tour; internal `sodio-*`
  storage keys/cookies/events + the "Sodio — LC Visits" Google calendar name
  deliberately KEPT so no user state breaks). New primary URL
  **elevate-alex.vercel.app** (elevate.vercel.app was taken; sodio.vercel.app
  + the long domain still work). ② **Booking v2** (migration **0029
  applied**): the IR's **email is required** → invited as an attendee to a
  real **Google Meet** on the owner's calendar (`conferenceData` +
  `sendUpdates: all`, `guests_can_invite` honored); confirmation email with a
  **manage link** (`/book/manage/<token>`, public, unique manage_token) where
  the IR **reschedules** (live slots, 23505 = just-taken) or **cancels with a
  required reason**; owner-side `cancelIrCall(id, reason)` emails the IR +
  `requestIrReschedule` sends them the manage link; settings gained Calendar
  parity — slots 15m–2h, **buffer**, **min notice**, **max advance**,
  **start/end dates**, weekly OR **one-date** availability rows; partner-LC
  registry dialog (⚙): crew adds, VP+ renames (cascades to denormalized
  snapshots) / deletes (refused while referenced). Booking pages: favicon +
  "Created by 2.0" credit + "Powered by Elevate"; the double "Cairo time"
  fixed. ③ **OGX DASHBOARDS**: OGT/OGV lanes on /dashboard (`ogxDashboard`
  in data.ts — status-ladder funnel Sign-ups→Contacted→Interested→Applied→
  Accepted→**Approved**, capped conversions, Members+Coordinators leaderboard
  by Approvals with FLIP re-sort, team drill, mm-plan vs pipeline, date/team/
  member filters; `SPECIAL_LANES` guard keeps getDashboard off pseudo-lanes);
  /signups gained a Dashboard button. ④ **Potential flow**:
  `setSignupPotential` — the sign-up's OWNER (+TL/VP/LCP) moves it
  Applied→Accepted→Approved (Parents Approval stays VP-only); these statuses
  are **system-only** — the sheet's Status cell now carries ONLY "Out of
  Process"/empty; 🎯 Potential filter (`?potential=`, replaces ?status).
  ⑤ **Onboarding fixed for every module**: tour.tsx rewritten module-aware
  (no more "Your ICX workspace" for everyone), `welcomeEmail` branches per
  module, /welcome blurbs gated. ⑥ **Blank home fixed**: "/" was blocked by
  GateClient on CLIENT navigations (the logo click) — "/" is ALWAYS_ALLOWED
  (exact match) and the logo now links straight to the viewer's `homeHref`;
  /dashboard added to OGX extraRoutes. ⑦ **19-agent adversarial review → 14
  confirmed findings fixed pre-ship**, the big ones: `listIrCalls` was
  shipping every call's **manage_token to every crew member's browser**
  (scrubbed to a `has_manage_link` boolean; the raw token lives server-side
  only via `IrCallServerRow`); the public reschedule/cancel updates now
  `.select("id")` and fail on 0 rows (a mid-flight status flip no longer
  moves/deletes the REAL calendar event); the booking throttle became an
  atomic **`bump_rate_bucket` RPC** (migration **0030 applied** — parallel
  bursts bypassed the read-then-upsert counter); overlapping availability
  windows are rejected (they minted racing slot grids); `ogxDashboard`
  excludes OOP rows and fails CLOSED; lane-chip switches across ICX↔OGX drop
  stale team/member params in ONE navigation; sandbox guards on
  cancelIrCall/requestIrReschedule; deletePartnerLc ignores cancelled spam
  bookings; one-date rows validate properly + default to the CAIRO date; the
  tour teaches the v28 permission model and matches rbac's sub_functions;
  the drafts script wordmark says ELEVATE.

- **2026-08-01 · v27** — BOOKING, STREAKS & a 16-item polish batch.
  ① **IR-call BOOKING** (migration **0027 applied**: `ir_booking_settings`
  member-keyed slug/slot/availability-jsonb(Cairo)/active; `ir_calls` gains
  status(scheduled/completed/cancelled)/demand/b2c_campaigns/booker_name/
  booked_at/calendar_event_id): every consideration member sets weekly
  availability + slot length on the **"My booking link" card** and shares
  `sodio.vercel.app/book/<slug>` — a **PUBLIC Sodio-branded page**
  (`/book/[slug]`, proxy-exempt, force-dynamic) where an IR abroad picks a
  free Cairo-time slot (14-day strip; overlaps + past excluded) + their LC
  (resolved/created in `partner_lcs`) → `bookIrCall` (hardened public
  action: input sanitation, 10-future-calls rate limit, fresh overlap
  re-check) inserts the scheduled call, best-effort creates the event on the
  OWNER's Google Calendar (`createIrCallEvent`), bell + `irCallBookedEmail`.
  Scheduled calls list soonest-first with an **in-call notes dialog** —
  demand (industry chips + Other), **"When are your B2C campaigns?"**, free
  notes, screenshot → `completeIrCall`; `cancelIrCall` removes the calendar
  event. Manual past-call recording collapses behind a toggle (with the new
  fields). ② **CV pool is IGT-only** (`canSeeCvPool` — IGV-only VPs keep IR
  calls, lose CVs; upload/list actions re-gated). ③ **OGV STREAKS**
  (`signup_activity(member_id, day)` + `members.streak_reminded_on`):
  claim/contact/comment stamp the Cairo day (`stampSignupActivity`,
  sandbox-skipped); `streakStats` → **StreakCard** on /signups (🔥 current,
  best, saved-today state, LC top-3); **streak-nags cron** (daily 17:00 UTC
  = 19:00 Cairo, scheduled in pg_cron) emails a 3-tier escalating funny nag
  (`streakNagEmail`) to OGV MMs with a ≥3-day streak and no save today —
  once per day (`streak_reminded_on`). ④ **The Blue Man v3**: chat HISTORY
  (localStorage `sodio-blueman-chats:<email>`, 8 most recent, validated +
  self-healing), history list + 🗑 + **New chat**, and **role/module-based
  suggested-question chips** on fresh chats. ⑤ **FileDrop everywhere**
  (`src/components/crm/file-drop.tsx`, single+multi): visible drag-and-drop
  zones on Deal contracts, archived import, market-research import, CV
  upload, IR screenshot — and the avatar tile accepts drops. ⑥ **Sign-ups
  phone filter is two-way** (`?phone=has|missing` Select replacing the
  nophone chip). ⑦ **"Soon" is unreachable for module-owners**: GateClient
  gained `hasModule` — a non-allowed route bounces to "/" (their workspace)
  instead of rendering ComingSoon (copy refreshed for the truly
  module-less). ⑧ **Dashboard "Consideration" lane** (`?fn=CONS`,
  `considerationStats` + ConsiderationPanel): IR calls (total/month/
  upcoming), partner LCs reached, CV pool (+by industry), consideration
  plan chips — for `hasConsiderationAccess` viewers. ⑨ **Global smooth
  scrolling** (`scroll-behavior: smooth`, reduced-motion-safe) — playbook
  index jumps glide. ⑩ Polish: consideration tab switches show the
  walking-man/nav-pending shimmer; dashboard lost the redundant
  "{fn} function" subtitle; planning lost the dead **Re-import** button;
  profile "Wrong info?" now opens **WhatsApp to the admin**
  (wa.me/201099019374); both URLs (sodio.vercel.app + the long one) are
  project domains tracking every deploy. ⑪ **26-agent adversarial review →
  20 confirmed findings fixed pre-ship**, the big ones: the public booking
  endpoint got REAL race protection (**0028 applied**: unique partial index
  `ir_calls_member_slot_key (member_id, called_at) where scheduled` — 23505
  = "slot just taken"; + `duration_minutes` so cadence changes never
  mis-compute overlaps), a 3-bookings/hour per-IP throttle
  (app_settings `bookrl:*`), country validated against the real list and
  anonymous input can no longer mutate existing partner_lcs rows, sandbox
  test views can't book; the IGT-only CV gate now covers EVERY path
  (searchCvs, the Blue Man tool declaration+handler, rerun/update/get/delete
  actions); streak stamps run in Next's `after()` (Vercel could drop the
  floating promise), streak windows widened to 400 days, `streakStats`
  fails CLOSED (no lying 0-day card), the nag cron moved to **16:00 UTC**
  (19:00 Cairo in DST); `cairoToUtc` became two-pass (DST-evening slots were
  an hour off) and the 14-day strip iterates CALENDAR days; `recordIrCall`
  rejects future timestamps server-side; `considerationStats` pages past the
  1000-row cap; the CONS lane header reads "Consideration Dashboard";
  phone-only members got a stable Blue-Man chat key. Playbook v27; the Blue
  Man teaches all of it.

- **2026-07-31 · v26** — THE CONSIDERATION RELEASE + a 16-item polish batch.
  ① **Consideration module** (`/consideration`, sidebar "Consideration",
  `hasConsiderationAccess` = Consideration in functions/subs + IGV/IGT
  VPs/Directors + LCP/admin; migration **0026 applied**: `partner_lcs`
  (unique lower(name)) · `ir_calls` · `cvs` + private storage bucket `cvs`).
  **IR calls tab**: record-call form — partner LC combobox with inline
  "+ Add new LC", datetime defaulting to now, notes, screenshot ≤3MB →
  uploaded to the Drive subfolder **"CRM — IR Calls"** (created/cached at
  app_settings `drive:ir-calls`; upload best-effort — a Drive failure keeps
  the call recorded) — shared crew-wide log, paged 50. **CVs tab**: any-format
  upload via the contracts-style signed-URL flow → `confirmCvUpload` runs
  **Gemini extraction** (`src/lib/cv-extract.ts`: PDF/images inline, text
  formats as text, others `unsupported` for manual fill) extracting
  name/phone/email/industry/skills/summary/full text; editable fields
  (uploader or VP+), 10-min signed file links, re-run button, delete
  (sandbox-refused); server-side search. **The Blue Man reads the pool**:
  `searchCvs` Gemini tool (declared only for consideration viewers) — "CVs
  with C# in skills" works. ② **Sign-ups UX**: Claim → **Contact** (auto-opens
  the detail dialog after claiming), **bulk select + Assign to… / Unassign**
  (`bulkReassignSignups` loops `reassignSignup` so scope rules re-run per
  row), **📵 Missing phone** filter (`?nophone=1`), program badges in the
  official **GTa/GTe/GV brand colors**, the country field became the branded
  `CountryInput` autocomplete (datalist gone), and **`MmPlanCard`** — an OGX
  MM with a current-month `mm_plans` row sees Applicants/Accepted/Approvals
  **plan vs live pipeline** (Approved = MOS, progress bar; `ogxPlanCard` in
  data.ts). ③ **Home routing**: "/" lands on the viewer's FIRST live module
  (accounts → sign-ups → consideration → members → membership → planning) —
  nobody with a built module ever meets "coming soon" at home.
  ④ **Walking man visible in light mode**: the brand APNG is WHITE — a
  `.walkman-tint` CSS filter paints it AIESEC blue on light backgrounds
  (dark keeps white). ⑤ **Expectation mail**: subject defaults to
  **"Home Entity Expectation Setting Mail"**; the review step (subject,
  edited body, recipients, variant) is cached in sessionStorage
  (`sodio-expectation-preview`) so tab switches never lose the built email —
  cleared on send/draft. ⑥ **Team field = list-or-create**: the member
  dialog's team picker lost its free-text fallback — pick from the registry
  or "➕ New team…" (creates a type-Team registry row inline, Member/TL roles).
  ⑦ **Sidebar "Arrange tabs"** (bottom of the nav): ↑/↓ reorder per member,
  persisted in localStorage (`sodio-nav-order`), Reset available.
  ⑧ **Ask-the-Blue-Man callouts** (`AskBlueMan` + window event
  `sodio:ask-blue-man` opening the chat pre-filled) on the accounts header
  ("accounts matching any criteria") and dashboard. ⑨ **sodio.vercel.app**
  aliased to production (permanent — tracks every deploy).
  ⑩ **30-agent adversarial review → 22 confirmed findings fixed pre-ship**,
  the big ones: Next 16's DEFAULT 1 MB server-action body cap would have
  rejected every IR screenshot (next.config now sets
  `serverActions.bodySizeLimit: "4.5mb"`; server guard 3.2 MB decoded);
  CV uploads/extraction are sandbox-refused (storage + Gemini quota can't be
  undone); `runCvExtraction` surfaces lost DB writes instead of reporting
  "done"; bulk sign-up reassign batches the sheet write-back (ONE tab
  read + ONE batchUpdate per sheet via `writeSignupsBackBatch` instead of
  ~3 calls per row) and a no-op unassign no longer flips `sodio_touched`;
  `ogxPlanCard` uses the Cairo month key (`monthOf().start`); CountryInput
  floats the exact-typed country above substring matches and Escape closes
  the suggestion list, not the whole dialog; CV "Open file" opens the window
  BEFORE the await (Safari popup rule); wa.me links only for
  `normalizePhone`-valid extracted numbers; screenshot content checked by
  magic bytes; Drive folder cache self-heals; the edit dialog rehydrates on
  reopen; sidebar chevrons un-nested from the nav links + nav-order key
  self-heals; the expectation-preview cache is per-viewer
  (`sodio-expectation-preview:<id>`); Tour counts Consideration as a live
  module. Playbook v26 (+ Consideration section); the Blue Man teaches all
  of it.

- **2026-07-31 · v25** — **THE OGX RELEASE.**
  ① **Sign-ups module** (`/signups`, sidebar "Sign-ups", `hasOgxAccess` =
  OGT/OGV in functions or subs + LCP/admin; OGX-only members' home "/" now
  lands there): migration **0025 applied** (`signups` + `signup_comments`,
  unique `(source, ep_id)`). **Two-way sheet sync** (`src/lib/google/
  signups.ts`): imports the 4 tracker tabs — OGT "New SUs"/"Old SUs", OGV
  [Old]"Old"/[New]"Main" (~7.9k rows) — every 15 min (pg_cron `signups-import`
  scheduled; batched inserts + row-diffing keep runs cheap) AND writes every
  in-app edit straight back to the row's workflow cells (`writeSignupBack`,
  row located by EP ID at write time, columns resolved BY HEADER NAME with
  aliases — trailing spaces/"Intersted"/double-"Status" on OGV Main all
  handled). Ownership rule: intake data is sheet-authoritative; once a row is
  touched in Sodio (`sodio_touched`) the workflow fields belong to Sodio.
  Legacy sheet Comment/VP Comment cells become the log's first entries;
  Sodio comments are an **organized two-class log** (member/MM → Comment
  cell, VP → VP Comment cell, each entry stamped author+time); Time Stamp /
  Assigned date / Contacted date cells stamp automatically. **Views**:
  Unassigned (the MAIN pool — anyone in the function contacts one and
  **Claims** it, race-guarded), Mine, My team (TL), All (VP+), Archived
  (OOP). Member/MM edits: Contacted + Interested (Yes/No) + comments; TL
  re-assigns within the team; **VP-only**: VP comments, Country (autocomplete
  from `src/lib/countries.ts`), Sub Product (OGT: GTa/GTe), **Status**
  (`SIGNUP_STATUSES` = Parents Approval · Applied · Accepted · **Approved** =
  the OGX MOS) and Out of Process (+reason, revivable — hidden like the
  archive). Members directory: OGX MOS now shows **real Approvals**
  (`kpis.signupApprovals`) next to the plan number. RBAC:
  `ogxFunctions`/`canWorkSignup`/`canViewSignup`/`canEditSignupVpFields` in
  rbac.ts; reads/mutations re-check server-side; sheet write-back is
  sandbox-suppressed.
  ② **Expectation mail v2**: OGT **and OGV** VPs/Directors (+LCP/admin;
  variant toggle for dual-access) — OGT keeps "Salary (If any)", OGV gets
  required "TN Fee and what it covers"; recipients = **EP email + IR email**
  (both required) with **customer.support@aiesec.net.eg always in CC**; new
  **review step**: the final email renders in an editable (contentEditable)
  preview with editable subject → **"Send now"** sends from the VP's own
  Gmail (`sendMemberEmail` via gmail users.messages.send) or "Save as draft
  instead"; the email ends with the VP's **signature** (name, position —
  LCVP/Director — Outgoing Global Talent/Volunteer, phone, email). Actions:
  `previewOgtExpectationMail` / `sendOgtExpectationMail` /
  `createOgtExpectationDraft` (all take the reviewed subject/html).
  ③ **Universal table sorting**: new `src/components/crm/sort-header.tsx`
  (`useTableSort` + `SortHeader`, null-last, Arabic-safe localeCompare) wired
  into the membership table, the TM members directory (incl. a per-MOS metric
  sort) and the Archived list (whose selection now survives re-sorting);
  the sign-ups table sorts server-side like accounts.
  ④ **Planning privacy**: `/planning` shows a VP/Director only THEIR
  function's MM/TL plans (`listMmPlans`/`listTlPlans` gained a `memberFns`
  filter); on dashboards the VP `lanePlan` card is now **leaders-only** — a
  TL keeps the team card and a planning **Coordinator** now gets their OWN
  plan vs their own numbers (`planOwnerId` self-scope in `getDashboard`).
  ⑤ WhatsApp opener is **emoji-free** (the 👋 rendered as � on several
  devices — removed for good). Playbook v25; the Blue Man teaches all of it.

- **2026-07-30 · v24.2** — Teams registry made REAL + emoji fix.
  ① Migration **0024 applied**: teams type `MM` renamed to its real name
  **`Function leaders`** (check constraint now the 5 sheet types; "MM" kept
  as an import alias). All consumers updated (`teamsForViewer`, member-dialog
  picker, importTeams). ② **Full team CRUD**: the Membership Teams card now
  manages EVERY type — add with a Type+Function+Name form, ✏️ edit and 🗑
  delete each chip, grouped by type; `saveTeamEntry`/`deleteTeamEntry`
  enforce the structure (EB/LB single, Function & Function leaders one per
  function, Team many) and `writeTeamsTab` rewrites the whole sheet tab from
  the DB after every change (the tab is now a mirror of the in-app registry;
  importTeams also imports `Team` rows and no longer cleanup-deletes
  siblings of the many-per-function Team type). ③ **WhatsApp 👋 fixed for
  real**: the emoji is emitted via the ASCII escape `\u{1F44B}` so no
  re-encoding step can mangle it into �.

- **2026-07-30 · v24.1** — Post-launch polish from Ahmed's test pass.
  ① **Sortable headers advertise themselves**: hover shows a ghost ↕ arrow
  dropping in + a muted pill background + press-scale (`SortHead`).
  ② **Podio default is 14 days for ALL functions** — `podioDefaultDays`
  returns 14 across the board (`B2C_DEFAULT_UPDATE_DAYS` deleted; existing
  B2C rows at the old 10-day default were backfilled to 14 in prod).
  ③ **Bulk-assign heads-up skips self-assignments** (no email/bell when the
  leader assigns accounts to themself). ④ **WhatsApp opener shortened** per
  request: "Hello! 👋 This is {name} from AIESEC, the world's largest
  youth-led organization. I'm reaching out about a collaboration with
  {account}." ⑤ **"OGT mail" renamed "Expectation mail"** (sidebar, tab
  title, page hero, Playbook, Blue Man — route stays `/ogt-mail`).
  ⑥ **Teams structure corrected to the sheet's 5 types** — EB & LB are
  SINGLE teams, `Function`, `Function leaders` (stored as type `MM`) and
  `Team` are many (per function): Teams-tab headers/seed rewritten to match
  the real tab, the Membership Teams card labels MM rows "Function leaders",
  and the stale seed-era `Function` duplicate rows (Suits / فرقة ناجي
  عطالله) were deleted from the prod `teams` table.

- **2026-07-30 · v24** — THE 15-ITEM BATCH. ① **Click-to-sort accounts list**
  (`SortHead` headers; `AccountFilters.sort/dir`, whitelist in
  `buildAccountsQuery`, `?sort/&dir` params, page reset on re-sort). ② **B2C-only
  viewers** see a **Type** column instead of Product (`viewer.b2cOnly`, like
  igvOnly). ③ OOP reasons + **"Closed company" / "No contact info"**.
  ④ **Archive bulk actions**: select archived account rows → **Back to active**
  (`bulkReviveAccounts`, TL+ via per-row `canReassignAccount`) or **Delete**
  (`bulkDeleteArchived`, VP/Director/LCP + `canEditAccount` per row — deletes
  children then the account, frees the name) — both behind confirm dialogs, plus
  a per-row ↩️ revive with confirm. ⑤ **Podio continuous updates for ALL raising
  functions** (migration **0021 applied**: `podio_update_enabled` default false
  backfilled true for B2C, `podio_update_second_notified_at`, members.email
  nullable + partial unique index): the card (renamed `PodioUpdateCard`) shows
  on IGV/IGT/BD/B2C with an ON/OFF switch (`setPodioUpdateEnabled` — enabling
  restarts the countdown); **new IGV/B2C/BD accounts start ON, IGT/B2B OFF**
  (`createAccount`); default cadence **14 days** (`PODIO_UPDATE_DEFAULT_DAYS`;
  since v24.1 B2C too); the cron
  (`/api/cron/podio-updates`) now scans `podio_update_enabled=true` across all
  functions, mails the responsible + the FUNCTION's VP/Directors (BD↔B2B
  aliased), and sends a **firmer second reminder one week after the first**
  (once per cycle; `markPodioUpdated` clears both stamps).
  ⑥ **Phone-only sign-in** (`members.email` NULLABLE, `Member.email:
  string|null` — every consumer null-guarded): members without an AIESEC email
  sign in with their **phone in BOTH fields** until a password is set
  (`okPhoneAsPassword` in authorize); their session key is a synthetic
  `phone+<digits>@sodio.local` (`phoneSessionKey`/`parsePhoneSessionKey` in
  types.ts, resolved in `getViewerByEmail`); once the email lands (sheet import
  ADOPTS the phone-keyed row — no duplicate member) the phone door closes and
  login says "sign in with Google once"; sheet import/write-back key email-less
  rows by phone tail (parseSheetRow accepts them, deactivation loop spares
  them). ⑦ **/inactive screen** (public route in the proxy matcher):
  deactivated members are routed there from login (probe in
  `loginWithPassword`), from Google sign-in (`signIn` callback returns the
  URL), and mid-session (`getRealViewer` → `sessionKeyIsInactiveMember`).
  ⑧ **Membership**: email OPTIONAL in the editor (locked only once set —
  adding an email to a phone-only member is the upgrade path) + schema
  requires email OR phone; **manager rules** — a plain Member can never be a
  manager (dialog options, `upsertMember` resolution AND import
  `relinkStakeholders` via `MANAGER_ROLES` all enforce it); **Teams registry**
  (migration **0022 applied**: teams.type gains 'Team', unique key now
  (type,function_key,name)): EB registers TL team names on a Membership
  "Teams" card (`addTeamName`/`deleteTeamName`, mirrored to the sheet's Teams
  tab as informational "Team" rows via `writeTeamRegistryRows` — import still
  skips them), and the member dialog's Team field became a **role-aware
  picker** (Member → registered TL teams of their function · TL/Coordinator/
  Director → the fn's MM team · LCP/LCVP → EB · "Other…" custom fallback).
  ⑨ **"Next week"** (+7d) buttons on the Next-step date (account card +
  contact dialog) and a **"This sprint" chip** (1–15 / 16–EOM) on the
  dashboard. ⑩ **Avatar creator** ("🎨 Create your own": style/seed/dice/flip/
  gradient presets via `buildAvatarUrl` in avatars.ts) + **The Blue Man** as a
  pickable avatar (`/brand/walk.png` whitelisted in `updateAvatar`).
  ⑪ **Bulk-assign heads-up**: the reassign popup's "Email them about it"
  toggle → bell + `accountsAssignedEmail` (account list + button) to the new
  responsible (`bulkReassignAccounts(ids, target, notify)`).
  ⑫ **WhatsApp ready-to-send opener**: accounts-list WhatsApp quick actions
  carry `?text=` (`waIntroText` — member name + AIESEC intro + meeting ask).
  ⑬ **OGT mail tab** (`/ogt-mail`, sidebar + GateClient extra; OGT
  VPs/Directors + LCP/admin): the "Home Entity Expectation Setting Mail" form
  (numeric EP/OPP IDs, calendar slot dates rendered "Aug 5, 2026", flexible
  per-day working-hours rows, logistics with conditional details, NO TN-fee
  line) → `createOgtExpectationDraft` drops a ready-to-review DRAFT in the
  VP's own Gmail (`ogtExpectationEmail` template). ⑭ **Launch drafts script
  rewritten** for v24 (`scripts/draft-announcements.mjs`): B2C launch segments
  (lead + member), planning-not-goals copy everywhere, split-opens/unassigned
  bullets, **OGX members get NO draft at all**. ⑮ **32-agent adversarial
  review → 26 confirmed findings fixed pre-ship**, the big ones: 0021's
  partial unique index silently broke EVERY members upsert (`ON CONFLICT
  (email)` can't use a partial index — the 30-min import cron was erroring;
  **0022 + 0023 applied to prod**: plain UNIQUE constraint restored, unique
  phone-digits index for email-less members, phone normalization backfill);
  phone-keyed sessions/import matched by 9-digit TAIL (identity collision —
  now exact full-digit equality everywhere: `memberByPhoneDigits` in data.ts,
  findMemberByIdentifier, probeMember, findPhoneKeyed) with phone-duplicate
  guards in `upsertMember`; sheet import stores `normalizePhone`d values; the
  email-upgrade write-back fills the member's OLD phone row (no duplicate row
  → no duplicate member on re-import); mid-session email-landing no longer
  logout-loops (phone sessions resolve email-ful members too);
  `bulkReviveAccounts` delegates to `reviveAccount` (calendar reminder +
  RBAC); `bulkDeleteArchived` is sandbox-refused (undo can't restore a
  cascade delete), aborts per-account on child-delete errors, and the client
  chunks select-all into 50s; archive selection resets on filter/page change;
  the podio cron pages past 1000 rows and fails loudly on stamp errors;
  cadence edits restart the reminder cycle; bulk-assign email skips the LCP
  and the toast reports when no email was on file; Team Leaders' team picker
  offers their LED team (their `team_name` labels every dashboard drill), not
  the MM team. Playbook v24; the Blue Man teaches all of it.

- **2026-07-27 · v23.2** — ① **Name worlds**: the archive block is per world
  (0020 splits the unique index) — B2C is tested against ALL active accounts
  + its OWN archive only; the raising archive/blacklist never blocks B2C and
  vice versa (cross-world archived match = amber heads-up in the add dialog,
  not a block); slug prefers the active row, archived rows link by UUID; all
  "unique across all ICX" copy now says every function. ② **Dashboard
  drill-down "By team" → "By MM"**: rows = every TL AND Coordinator with
  their whole portfolio (label "Nick — Team"). ③ v23.1: B2C default cadence
  = 10 days; Perrihan (B2C Director) auto-covered by the reminder cron.

- **2026-07-27 · v23** — **THE B2C MODULE.** B2C is a full account function:
  accounts like raising but with a single **Type** (Courses / Events / Student
  activities) instead of product/account-type/industry; **Podio continuous
  updates** (per-account cadence, default 10 days, countdown card, daily cron
  → bell + email to the MM + B2C VP/Director once per cycle, "Updated on
  Podio" resets); **detail-free deals** behind the contract Google Form link;
  **no proposal emails**; an isolated **deals-centric B2C dashboard lane**
  (no opens anywhere, leaderboard by Deals); B2C MOS in the members directory
  = deals. Migration **0019 applied via MCP** (enum value, checks, cadence
  columns, view); pg_cron job `podio-updates` scheduled (daily 05:00 UTC).
  Salma's & Ali's B2C accounts get the workspace immediately (their tour and
  ComingSoon copy updated). Playbook v23; the Blue Man teaches all of it.

- **2026-07-27 · v22.2** — Fix-and-polish wave from LC feedback. ① **Archive
  is LC-WIDE**: `canViewArchive()` = everyone (management stays TL+ via
  `canManageArchive`), the Archived tab query skips accountScope, and
  `canViewAccount` returns true for ANY archived account (read-only —
  `canEditAccount` is no longer an alias and stays scoped). ② **Live name
  check** (`checkAccountNameLive` + debounced check in AddAccountDialog):
  duplicate/archived/blacklist verdict with full context appears AS the name
  is typed — before the rest of the form is filled; submit blocked. ③ **Every
  MM sees & edits their plan on the PROFILE**: new `mmPlanForProfile` +
  MmPlanForm profile mode (consideration/OGX funnel card) next to the raising
  opens card; `isPlanningTl` no longer excludes `isPlanningMm` — an MM with
  subs "Raising, Consideration" (e.g. Boda) files BOTH plans. ④ **Accounts
  list**: IGV-only viewers see a **Project** column instead of the pointless
  IGV badge; **sub-product filter** (`?sub`, ilike) for IGT-access viewers;
  **page-size picker** (?size 30/50/100/200). ⑤ **Planning conversions
  UNcapped** (applicants > opens is normal); the dashboard funnel keeps its
  100% cap. ⑥ **System-feedback inbox** left the sidebar — it's the "Open the
  inbox" button on /feedback (inbox owners only). ⑦ **The Blue Man v2**:
  Gemini function-calling with RBAC-scoped `searchAccounts` /
  `getAccountDetail` (+ `webInfo` bridge, since google_search can't mix with
  custom tools), **?open= action deep links** (contact/visit/deal/proposal
  auto-open on the account page, edit-gated), and **link grounding** (internal
  links are stripped unless the slug came from the context or a tool result;
  `buildAssistantContext` now returns `{text, slugs}`). ⑧ **Test data
  purged**: members "Test TL"/"Test member" deleted (notifications/audit/
  goal-rows cleaned; they were never in the Membership sheet) + the 4 old
  manually-made test accounts (incl. Hana's 3 "missing" ones — they were
  archived under her name) with their children.

- **2026-07-26 · v22.1** — **Every raising MM plans**: `isPlanningTl` now
  matches **Coordinators too** (was TLs only) — raising Coordinators of
  IGV/IGT/B2B&BD file their own opens plan on first sign-in and from the
  profile card (their actuals = their own allocation-attributed opens);
  /planning card retitled "Raising MM plans". Role-aware copy on
  /welcome/plan-tl + the profile card. Planning-sheet re-import attempted —
  still blocked: the service account has ZERO access ("File not found"), the
  share to `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com`
  never landed (likely an aiesec.net external-sharing restriction). v21's
  verified 1512 plan_cells stay live. Test period-report email sent to the IM
  mailbox via `?test=1`.

- **2026-07-26 · v22** — **GOALS = PLANNING + THE BIG IMPORT.** ① **Goal
  setting removed everywhere** ("no one sets goals from Sodio"): GoalDialog /
  Set-goal buttons / `setPerformanceGoal` / the goal-reminders cron (route
  deleted, pg_cron job unscheduled) / `newGoalEmail` + `goalPeriodEndedEmail`
  are gone. The **lane goal is the PlanCard** (VPs' plan_cells opens vs
  actual, sprint/month toggle; B2B lane has none — the planning sheet skips
  it) and the **team goal is the TL's plan**. ② **TL planning** (migration
  0018 `tl_plans`): raising TLs file opens-per-month of the peak on first
  sign-in (`/welcome/plan-tl`) and edit from the profile **"My plan" card**
  (with per-month actuals); dashboard team card + /planning "Team Leader
  plans" card track plan vs raised. ③ **Deal opens splits**
  (`deal_allocations` + backfill): the Record-deal popup can split a deal's
  opens across function members (sums must match, server-validated); ALL
  per-member opens numbers (leaderboards, directory, reports, my-numbers,
  TL-plan actuals) are allocation-attributed with a pre-0018 fallback;
  deal history shows the split. ④ **Funnel conversions capped at 100%**
  (dashboard strip/KPI/drills + planning conversions) and **"My numbers"
  hidden for VP/Director/LCP** (they see the whole function anyway).
  ⑤ **THE IMPORT**: the LC's two old Google Sheets were parsed
  (18 tabs — IGV: Farwada + 8 project tabs + Bulking + 2 scrapped + Black
  Listed + OUR PARTNERS + potential partners; IGT: Market Research +
  scrapped; the IGT "Main" tab is EP data, excluded) → **39 blacklist rows**
  (blacklisted/partners/potential partners, with their info in comments) +
  **3,782 accounts**: **1,637 archived** (contacted even once → OOP with the
  old contact history, stakeholders, package plans and "was with" in an
  Admin comment) and **2,145 active UNASSIGNED** market-research accounts
  (IGV rows carry their project tab; IGT mostly product-unknown — the badge
  renders plain "IGT"). Dedupe ran across tabs (blacklist > archived >
  active) and against the DB; phones normalized to +20 canonical (invalid
  ones preserved in the comment). ⑥ **Unassigned + scale support**:
  `accounts.responsible_id` nullable + LEFT-JOIN pipeline view (0018);
  "— Unassigned" filter; null-safe renders + guards (visit scheduling, podio
  ask, deal without split); **accounts list paginated** (100/page + count);
  every full-set reader pages past Supabase's 1000-row cap (`fetchAll`,
  mirror `pageAll`, directory, reports); the Blue Man reads the freshest 300
  accounts only. Playbook v22; assistant knows all of it. Migration **0018
  applied via MCP**; import ran via service-role script (scratchpad).

- **2026-07-21 · v21** — **THE PLANNING RELEASE.** ① **VP planning imported
  from the LC's sheet** ("Alexandria | Planning Tool 26.1", id
  `1gmPTHjZdYC2i8jdzFZi6mX7-…`): the six 🎯 goal-setting tabs (iGV/iGTa/iGTe/
  oGV/oGTa/oGTe — BD/B2B/TM skipped by request) were scraped via the user's
  browser (the sheet is NOT yet shared with the service account —
  `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com` needs Viewer
  for re-imports), verified (all Q sums match) and seeded as **1512
  `plan_cells` rows** (fn, scope month|sprint, period_start, metric, value).
  Term Feb 2026→Jan 2027; **S1 summer = Feb–Jul, S2 winter = Aug–Jan
  (current); sprints are HALF-MONTHS** (S1 = 1–15, S2 = 16–EOM); quarters
  Q1 Feb-Apr · Q2 May-Jul · Q3 Aug-Oct · Q4 Nov-Jan. Calendar math in
  `src/lib/plan.ts`; re-import parser `importPlanningSheet` in sheets.ts
  (sheet id cached at app_settings `planning:sheet-id`); scrape reference doc
  in the session scratchpad (PLANNING-REFERENCE.md). ② **/planning tab**
  (`canSeePlanning` = LCP/admin + VPs/Directors of IGV/IGT/OGV/OGT; OGX VPs
  enter via GateClient extra): per-function plan — sprint/month/quarter cards
  (plan vs ACTUAL opens for ICX lanes via `laneOpensActual` from deals'
  per-product splits; OGX = plan-only), full funnel tables, conversions,
  monthly + sprint-split tables, MM plans, and a **Re-import** button
  (`runPlanningImport`). ③ **Dashboard plan card** on product lanes
  (`lanePlan` in getDashboard): current SPRINT's planned opens vs raised +
  consideration plan chips, toggle to month. ④ **MM planning on first
  sign-in** (`mm_plans`, migration 0017): OGX & Consideration MMs
  (TL/Coordinator; `isPlanningMm`) are redirected to **/welcome/plan** after
  onboarding to file applicants/accepted/approvals × the peak's 6 months
  (peak from signup date via `peakForPlanning` — July→winter, January→summer
  edge rule); `saveMmPlan` upserts; plans feed /planning, the members
  directory and reports. ⑤ **Period reports** (`/api/cron/period-reports`,
  daily 07:00 UTC, scheduled in pg_cron): when a sprint/month/quarter closes
  (starting with the winter peak, Aug 2026), each function (IGV / IGT / B2B&BD)
  + the LCP gets a **waterfall report email** — totals, plan-vs-achieved, per
  team (bold) → per person rows (`buildFunctionReport` + `periodReportEmail`
  + `gridTable` multi-col builder); idempotent via app_settings
  `report:<kind>:<fn>:<start>`; `?test=1` sends a live preview to the IM
  mailbox only. ⑥ **Admin test mode**: /admin gains a Test-mode card —
  **Seed test accounts** (~11 `is_test=true` accounts across IGV/IGT/B2B/BD in
  every stage incl. OOP + a 3-no-response flag case), **Remove test data**,
  and a **Show-test-data switch** (`sodio-test-mode` cookie). Test accounts
  are invisible everywhere (accounts query, dashboards, members KPIs,
  calendar, Drive mirrors, reports) unless `viewer.testMode`. ⑦ **Sandbox
  test view** (v3): startViewAs defaults to **sandbox** — cookie
  `<target>|<mode>|<sessionId>` + `test_sessions` row; every mutation is
  journaled to `test_undo` (via `recordUndo`/`snapshotForUndo` in
  `src/server/sandbox.ts`, instrumented across accounts/contacts/visits/
  deals/comments/goals/blacklist writes) and **rolled back in reverse on
  exit** (`undoSandboxSession`); outbound side effects (emails, notifications,
  calendar events, sheet write-backs, Gmail drafts) are **suppressed** in
  sandbox (`sandboxSuppressed` checks the verified cookie). The fixed banner
  became a **draggable chip** (view-as-banner.tsx): drag anywhere, snaps to
  the nearest edge (position persisted in localStorage), collapses to a tab,
  and carries the 🧪 Sandbox / ⚡ Real toggle (`setViewAsMode` — flips without
  losing the undo journal). ⑧ **Feedback split**: SYSTEM feedback (form now
  has **type-dependent categories** — `FEEDBACK_CATEGORIES` in types.ts,
  `feedback.category` column, chips in the inbox) moved off the sidebar to a
  **Profile card**; the sidebar gained **LC Feedback** (`/lc-feedback`,
  ALWAYS_ALLOWED): feedback about PEOPLE — smart level-aware quick-pick chips
  (a TL is never offered "My TL"), searchable multi-select (≤10), 🎉 positive
  → bell + `lcShoutoutEmail` to the person (anonymous supported), 😟 negative
  → `lc_feedback` table, **inbox visible ONLY to LCP + admin** behind an
  "Inbox (n)" button on the form page (no sidebar tab). ⑨ **Members directory
  MOS fix**: per-member `mos` class — raising/B2B → opens ★, **BD → money
  (EGP ★)**, consideration & OGX → approvals (their **plan** until the
  consideration module lands), others → "module coming"; one flexible MOS
  cell replaces the uniform 6-column row. Playbook v21; Blue Man teaches all
  of it. Migration **0017 applied via MCP** (plan_cells, mm_plans,
  feedback.category, lc_feedback, accounts.is_test + view column,
  test_sessions, test_undo).

- **2026-07-18 · v20** — **Comment archiving** (migration `0016_comment_archive`,
  applied via the Supabase MCP): every comment gets an **Archive** button
  (archiving also unpins it); the comments card counts only live comments and
  reveals archived ones behind an **"Archived (n)"** toggle. Numbering runs over
  the FULL list so `#n` never shifts when archived comments hide.
  `toggleCommentArchive` in `actions.ts`, `AccountComment.archived` in types,
  RBAC via `canEditAccount`. **Proposal default attachments** on **B2B/BD**
  accounts are now **nothing** (was IGV) — `proposal-dialog.tsx` starts with an
  empty attach set. **Desktop direct-select**: the accounts table shows the
  select checkbox **always** (no "Select" click needed on desktop; the Select
  button is mobile-only) — rows still open on click, the checkbox cell swallows
  it. **Mobile accounts view switcher**: a **Cards / Compact / Table** segmented
  control (localStorage `sodio-accounts-mobile-view`) — Cards is the roomy
  default, Compact is a one-line-per-account list, Table reuses the desktop grid.
  **Bulk reassign RBAC fix**: the bulk-reassign picker now offers ONLY the
  viewer's allowed targets (`listReassignTargetsForViewer` in `data.ts`, mirrors
  `reassignTargetScope`) instead of every member — the server already re-checked
  per row, but the client had been offering everyone (a bug). Also fixed a
  latent server bug the new picker surfaced: `reassignAccount`'s per-account
  scope check now matches B2B/BD targets by `memberIsB2B` (BOTH `functions` and
  `sub_functions`) so a B2B crew member whose "B2B" lives only in the Sub
  Function column can actually receive a B2B/BD account (was always rejected).
  The **"All"**
  button in the bulk bar is now **select/unselect-all** for the current view
  ("All (N)" ↔ "Clear"). **Relabels** (dashboard): the 4th conversion is
  **"Visit Done → Deal"** (was "Lead Done → Open"); the KPI card is **"Lead →
  Open"** measured by **accounts that raised opens** (was "Lead → Deal"). **The
  Blue Man** now knows leaders can bulk-edit (Select → archive/reassign many) +
  the mobile view switcher. **Launch announcement drafts**
  (`scripts/draft-announcements.mjs`): one personalized Gmail **DRAFT** per
  active member in the IM mailbox (nothing sent) — a funny, role/function/level-
  tailored launch tour for everyone whose module is live (uses the app's own
  `hasRaisingAccess` gate: IGV/IGT raising, B2B/BD, LCP) and a "stay-tuned"
  teaser for everyone else (TM, OGX, F&L, B2C, CXP, consideration-only, no-
  module). `--dry` previews, `--emit=<dir>` dumps HTML. Playbook v20.

- **2026-07-17 · v19** — **Bidi/RTL fixed everywhere**: the base `Input` &
  `Textarea` default to `dir="auto"` (Arabic → RTL, Latin → LTR, per field),
  the Blue Man chat annotates each rendered line + the input + bubbles with
  `dir="auto"` + `text-start`, and key free-text displays (account name,
  comment body, feedback message, audit details) do too — mixed Arabic/
  English no longer reverses. **Mobile notifications** animate out of the
  bell: the panel's `DialogContent` gets `.notif-panel`, and a `max-width:639`
  CSS rule (doubled-class specificity) anchors it top-right with
  `transform-origin: top right` so the base zoom-in/out reads as growing from
  and shrinking back to the bell; desktop keeps the centered dialog.
  **Admin Health & Logs page** (`/admin`, `viewer.isAdmin` server-gated,
  sidebar entry for admins): `getSystemHealth` (DB, contracts bucket, shared
  visits calendar, GEMINI/CRON/ADMIN env presence, table counts) +
  `listRecentAudit` (audit_log with actor join, searchable). **Real cron
  run-tracking**: `markCronRun(name)` upserts `app_settings` key `cron:<name>`
  at the end of all four cron routes; the admin page reads them for genuine
  last-run times (green/amber freshness) — no more inferring from data stamps.

- **2026-07-17 · v18** — **Mobile chrome consolidated**: the drawer's user
  block drops the bell + theme toggle (both live in the mobile top bar now,
  theme toggle added there); desktop sidebar unchanged. **Compact mobile
  leaderboard**: phones get metric chips + rank/name/value rows (top 8)
  instead of the wide 7-column table (which stays ≥md). **Phone
  auto-normalization**: every phone input (contacts editor, profile,
  membership dialog, onboarding) cleans pasted/typed numbers to the
  canonical +20… format on blur via `normalizePhone`. **Blue Man smart
  actions**: the context now carries each account's `/accounts/<slug>` link,
  the prompt instructs attaching `[Open X](/accounts/x)` markdown actions,
  and the chat renders internal links as tappable action chips (external
  links open in a new tab).

- **2026-07-17 · v17** — **Mobile QA pass**: drawer slide is transform-only
  (dropped the double-driving `transition`, 300ms, `will-change`), the
  background no longer shifts on open (`scrollbar-gutter: stable` +
  neutralized react-remove-scroll body compensation), notifications bell now
  lives in the MOBILE top bar, drawer scrolls on short screens, notch-safe
  paddings, date-range filters fit 360px, mobile card names truncate
  properly, profile emails wrap, `<main>` clears the fixed refresh pill
  (md:pt-14). **Slow-nav feedback**: sidebar clicks show the walking man
  after 250ms until the route commits (8s safety). **Bulk operations**:
  Select mode on the accounts list (checkbox per row, All, fixed action bar)
  → `bulkArchiveAccounts` / `bulkReassignAccounts` loop the single-account
  actions so RBAC runs per row; plus a per-row quick-archive ✕ on desktop
  and mobile. **Fixes**: the test-view banner strip no longer swallows
  clicks (pointer-events — the "2.0 credit not clickable" report), "Add
  another" hard-remounts the add-account form via an epoch key (stale
  ListOrOther/MultiPick state was silently reinjecting old custom values),
  membership editor gained a search box (name/email/team/function/role).
  Playbook v17.

- **2026-07-16 · v16** — **BD money goal**: the B2B lane now carries TWO
  function goals — `B2B` (opens) and `BD` (MONEY, `performance_goals.metric =
  'EGP'`) — both set by the B2B/BD VP/Director from the same dialog (new
  "BD — money goal (EGP)" scope); second GoalCard on the B2B lane (achieved =
  Σ `deals.amount` on BD accounts, date-filter aware); unit-aware goal emails
  + goal-reminders (`laneAchieved('BD')` sums EGP; owners match B2B or BD in
  functions OR sub-functions). **Fixes**: scope label reads "B2B function"
  (one name); refresh button moved to the TOP (fixed top-right on desktop,
  mobile top bar); the first-run tour never pitches "Your ICX workspace" to
  members without a live module (Barthinya) and says "Your B2B workspace" for
  the B2B crew; LCP/admin calendar hovers show each visit's function; the
  Podio worklist's inline state select gained **Rejected (archives)** behind
  the same confirm as the account page. **Motion wave (CSS-only,
  reduced-motion-safe)**: aurora login background, animated striped goal
  fills, staggered KPI/calendar/playbook entrances, sidebar hover slide +
  active glow, breathing playbook hero. **Mirror-sheet guardrail**: every
  mirror sheet's last header cell now reads "⚠ MIRROR — Sodio overwrites this
  sheet hourly. Edit/delete IN SODIO, not here" (a sheet-side deletion was
  expected to sync back — it never does; only Membership is two-way). All
  TEST DATA was wiped on request (10 accounts + deals/visits/contacts/
  comments + 2 blacklist rows — full JSON backup in `backups/` (gitignored)
  in the main folder). Playbook v16.

- **2026-07-16 · v15** — **B2B/BD dashboard isolation**: the crew sees ONLY
  their B2B lane (no ICX aggregates — `icxFunctions` stopped widening,
  `dashboardViewer` scopes to B2B+BD); **B2B lane goal** (function='B2B') set
  by the B2B VP/Director (Suits = function-leaders team → its leader sets it),
  covered by goal-reminders (`laneAchieved` B2B branch) and announced to the
  B2B crew only (product-lane goals no longer spam B2B); **team goals require
  team members** (server-checked). **Calendar = own function only** (LCP/admin
  all). **Accounts is the home view** ("/" → /accounts; dashboard → /dashboard,
  all emails/notifications updated). **Add-account success popup** (open it /
  add another). **Test view v2**: the floating banner's name is a live SWITCHER
  (pick anyone; role + functions shown in both lists); tab-title metadata now
  honors the test view (was the raw session). **Freshness**: refresh button in
  the sidebar + auto `router.refresh()` on tab focus and every 30s while
  visible (`AutoRefresh`, 10s floor). **Playbook v15 is DYNAMIC** — renders
  only the viewer's sections + a "ask The Blue Man" callout. **Profile "my
  people"** now also shows a Member/Coordinator their own team (TL +
  teammates). **/membership un-blocked for non-raising EB** (GateClient extra;
  Hawash), /playbook ALWAYS_ALLOWED; TM tab renamed **"Talent Management"**;
  login shows just "Sodio"; sidebar brand "AIESEC in Alexandria"; ComingSoon
  copy updated (covers IGV·IGT·B2B&BD + TM).

- **2026-07-16 · v14** — **Admin Test view (View-As)**: profile picker + cookie
  impersonation through `getViewer` + exit banner; real session drives the
  admin checks. **BD deals' MOS = money** (migration 0015): amount (EGP)
  required on BD deals (+ optional benefits, opens optional), shown in
  history/header and a new sheet column. **ui-ux-pro-max skill reinstalled
  properly** (the ~/.claude/skills copies had dangling symlinks — data
  materialized for all 7 design skills) and the **21st.dev MCP server**
  registered user-scope; applied the skill's conservative recommendations:
  mobile touch targets enlarged to 36px (contact shortcuts + quick actions,
  desktop unchanged) — heavier items (style overhauls, GSAP, generated
  components) deliberately skipped to protect smoothness/reliability/
  responsiveness. Playbook v14.

- **2026-07-15 · v13** — **TM module v1** (`/members`, TM function + LCP/admin):
  whole-LC members directory with per-member MOS/KPIs + email/call/WhatsApp
  buttons; TM users enter the shell (GateClient `extra`) with server-side
  gates. **Profile "my people" card**: TL → team, VP/Director → function,
  LCP → EB, with contact buttons. **BD accounts** (migration 0014): B2B/BD
  crew picks the label per account, BD behaves like B2B (whole-ICX opens),
  own badge/drill; **Podio worklist**: "Podio pending" filter (B2B/BD MMs +
  Director/VP + LCP/admin) with copy-name, inline request-state, and "Ask to
  submit" → inbox-only notification + the account pins on top of the owner's
  list (`podio_submit_requested_at`, auto-cleared on action). **BD proposal
  variant** — Talent-Solutions pitch from aiesec.org.eg/partner.html, NO
  ready attachments; proposal signature now links to https://aiesec.org.eg/.
  **v12 review fixes**: ContractsDialog auto-load (effect) + stale-response
  guard; `/calendar` server-side gate + `listFunctionVisits` raising-access
  guard (no more B2B leak to non-ICX viewers); calendar chips only link to
  accounts the viewer can open; Cairo-timezone month default; function-goal
  progress unscoped from "My numbers" (`funcAchieved`); BD alias propagated
  to every inline B2B check (`memberIsB2B`). Playbook v13 (+ TM section);
  Blue Man knows all of it.

- **2026-07-15 · v12** — **B2B & BD are one function** (`isB2B` matches either
  name; membership sheet uses "BD, B2B"); **Teams tab logic applied from the
  sheet Ahmed set up**: types EB/LB/Function/**Function leaders**(→MM)/Team
  (skipped), multi-function cells ("B2B, BD") stored one row per function,
  VPs/Directors now see their "≤fn> leaders" team on the profile; **Director
  comment label** (not VP — migration 0013); **archive reason optional** (name
  alone blacklists); **My-numbers/member filter scopes KPIs + conversions
  ONLY** (boards & drills stay full); **B2B dashboard lane** for LCP/VPs/
  Directors/B2B; conversion renamed **"Lead Done → Open"**; **/calendar** —
  function-wide month calendar of visits, color-coded per member (legend,
  Saturday-first, agenda on phones, account click-through); **History pending
  visits are clickable** to report (same dialog as the top button, deep-link
  still works); **Contracts button** on accounts with uploaded contracts —
  popup with inline preview (iframe over a signed URL) + download; **proposal
  email v2 edits**: no "Dear …" line, recipient-name field removed,
  product-based signature title (Global Volunteer/Talent/Teacher Manager,
  B2B → Business Development Manager), phone → wa.me link; **The Blue Man**
  got playbook-grade system knowledge + fluent Egyptian-Arabic instructions;
  **EB shared on the Drive folder as commenters** (all 7, done via API);
  account "hadana" renamed **"Hadana Moves"** (data fix). Playbook bumped to
  v12.

- **2026-07-15 · v11** — **Drive sheets consolidated**: ONE `CRM — Raising
  Accounts` mirror for ALL accounts (IGV+IGT+B2B, active AND archived) with
  Function/Product/Archived? filter flags; archived-only view renamed
  `CRM — Archived Accounts`; the Teams sheet became a **"Teams" TAB on
  CRM — Membership** (auto-created + seeded); per-product sheets deleted.
  **Follow-up reminders v2**: +2h report prompt now emails the responsible
  **+ their TL** (Member/Coordinator only; leaders get it alone; details
  table included), and a **1-week "you forgot" nag** (same recipients) asks
  to report or archive — `forgotten_nag_sent_at`. **Deal contracts**: optional
  any-format uploads on Record-deal or later from History (private `contracts`
  bucket, signed-URL direct uploads, 10 files ≤25 MB each, RBAC-checked signed
  view links). **Proposal email rebuilt to the LC's original design** — ONE
  AIESEC blue for all products, per-function content, general B2B variant →
  aiesec.org/partners, NO company-logo section. **"My numbers" dashboard chip**
  (personal KPIs/MOS). **Goal reminder cycle**: daily cron emails goal owners
  when a period ends (goal vs achieved + set-new button, once per goal), and
  new goals are announced by email + bell to everyone they apply to.
  **The Playbook** (`/playbook`, sidebar for everyone): AIESEC-branded,
  role-organized manual with index + "That's you" badges — MUST be updated
  with every release (`PLAYBOOK_VERSION`). **SDG badges removed** (mapping,
  tiles, CSS). Migration **0012**; ship-rule (merge to main + deploy every
  session) added at the top of this file.

- **2026-07-14 · v10** — Visit **shared with leaders** (calendar attendees: Member
  → TL+VP, TL/Coordinator → VP; raising only) and a **function-wide visit
  announcement** (email + in-app notification to the product's raising crew +
  B2B; `visit_announcement` kind); **leaderboard reworked** into ONE wide board
  showing all funnel numbers with **click-to-sort FLIP animation** (default
  Opens); **notifications are actionable** — visit/follow-up notices carry a
  `link` (migration 0010) and open the account on click; **profile forgot-
  password** now emails a fresh password (was still saying "ask IM team");
  **12-hour AM/PM** timestamps everywhere; **last-contact-result filter** on the
  accounts list; **avatar upload** (client-downscaled to a ~256px data URL) + a
  **bearded** avatar set; removed the B2B blurb from the add-account dialog;
  **fixed invisible mobile date inputs** (pinned `color-scheme` to the active
  theme so native date placeholders show).

- **2026-07-14 · v9** — **B2B accounts** are their own product: B2B people add
  accounts as B2B and each deal records **opens per product** (IGV/IGTa/IGTe —
  migration 0009 `deals.slots_igv/igta/igte` + account totals), those splits
  feeding the product dashboard lanes; **visibility** clarified — Member/
  Coordinator=own, TL=own+team, VP=whole function **+ B2B**, Director=their
  function(s) **+ B2B**, LCP=all (`scopeFunctions`); **one leaderboard** listing
  **Members & Coordinators only** with metric buttons (Opens default · MR ·
  Contacted · Visits · Visits done · Deals) — the by-member drill and Flags
  column removed; **OOP reasons** are a fixed pick-list + Other; **manual
  archive** on the Archived tab (Add archived · Import archived CSV/XLSX with
  editable preview) writing to `blacklist`, mirrored to a **"CRM — Archived
  Accounts (DO NOT re-add)"** sheet (all OOP + manual names); **forgot password
  emails a fresh password** (old one still valid until changed) and **login
  accepts email OR phone**; **profile avatars** (fun DiceBear characters or the
  Google photo, shown in sidebar); **calendar fixed** — `scheduleVisit` reports
  why a reminder failed (dead grant → re-login) and **next-step follow-up events**
  land on the calendar at the step's time (or 11:00 if date-only), synced/removed
  with the step; **The Blue Man reads CORE** (core.aiesec.org.eg national
  rankings + Alexandria funnel, cached 15 min); **timestamps show HH:mm** in the
  timeline/history/comments; accounts list gains a **last-contact-result column**
  and **hover details** on every field (status → deal/visit/contact specifics),
  and its **Responsible filter lists only members with accounts in the current
  view**; **smoother theme switch** (View Transitions circular reveal + eased
  color transitions).

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
