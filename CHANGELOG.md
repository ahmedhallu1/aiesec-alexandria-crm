# CHANGELOG.md — Sodio release history

> Every release adds a dated entry **at the top** of this file, in the same
> commit as the change (the current-state spec lives in `AI_CONTEXT.md`).
> Moved out of AI_CONTEXT.md on 2026-10-03 (v37.7): AI_CONTEXT.md is
> auto-loaded into every Claude session and subagent, and the history was
> ~87% of it. This file is NOT auto-loaded — grep it for the reasoning behind
> a past decision before changing that behaviour.

- **2026-10-07 · v37.11** — **OGT PHONES GET THEIR 0 BACK TOO.** The OGT
  tracker tabs had the same eaten leading 0 as OGV (~2,031 rows,
  "1012345678"). `restorePhoneZero` is now on every SIGNUP_TABS entry, and the
  existing OGT rows were fixed once in SQL with the identical rule (so the
  import has nothing to rewrite). Sodio-side only — phone is intake and is
  never written back. ⚠️ A bulk UPDATE on `signups` bumps `updated_at` via
  trigger, which the hourly export reads as "edited": after it, the export
  watermark (`signups:last-export`) was moved past the bulk update (> 60 s
  overlap) and only rows with a real edit since the old mark re-bumped — so
  no tracker cells (or Time Stamps) were rewritten for nothing.

- **2026-10-07 · v37.10** — **JULES'S SECOND BATCH (56), CHECKED ONE BY ONE.**
  No migration. Three real fixes, one test gap closed; the rest verified false.
  ① **The AI email draft went into the live editor unsanitized.**
  `draftEmailWithAi` stripped `<script>` only, then the Emails tab set
  `innerHTML` to the model's output — so an `<img onerror=…>` (which pasted
  text could talk the model into writing) would run in Sodio's origin. It now
  goes through `sanitizeEditedEmailHtml`, the proposal editor's sanitizer.
  (Jules flagged the wrong line — the `dangerouslySetInnerHTML` there is a
  constant `<p>Hi,</p>`; its other two "XSS" hits are server-built from the
  VP's own form with every field escaped.)
  ② **Two same-named contract files in one upload could overwrite each other**
  (`<ms>-<name>` paths, no unique part). Paths now carry a UUID slice — found
  while checking Jules's "parallelise these" suggestion, which would have made
  the collision MORE likely. Signed URLs (contracts + feedback) and the
  proposal-deck downloads now run in parallel, in order.
  ③ **Saving the O2O questions ignored failed writes** and still said saved;
  retiring removed questions is one `.in()` update; every write is checked.
  ④ `tests/coverage-gaps.test.ts` (15) — member-fields shape checks,
  `personalPageSize`, the approvals lane maps, `isB2B/isBd/isB2C`,
  `icxFunctions`, `fnSetting`, `canRunLcTools`, `canSeePlanning`,
  `canWorkArchived`, and that the AI draft stays sanitized.
  **False, unchanged:** the assistant "unsafe query params" (every model
  filter is AND-ed onto `applyScope`, it can only narrow) · the bulk-delete,
  sandbox-undo and CXP-ZIP loops (sequential on purpose: abort-before-delete,
  journal order, one file in memory) · `ensurePath`/Drive folder walks (each
  step depends on the last; the files.get "loop" is a fallback chain) ·
  snapshot/Map-population micro-optimisations · the "console.log" hits (they
  are intentional operational logs) · "TODO" (a variable named `todo`) ·
  "commented-out code" (an explanatory comment) · the two comment "bugs" ·
  already-tested functions (`canSeeActivationBid`, `actsOverOthers`,
  `reachIds`, `resolveCountry`, `withPersonalDefault`) · long-function
  refactors (no behaviour change, real regression risk) · test-data seeding
  loops (admin-only tooling). **983 tests**, tsc clean.

- **2026-10-07 · v37.9** — **OGV 26.2: A THIRD TRACKER, AND THE BATCHES SHIFT.**
  "Alexandria - OGV 26.2 New Signups" (tab **Main**, 1,519 Techne Summit
  sign-ups on arrival, more to be uploaded) is now synced exactly like the
  26.1 trackers — import every 15 min, workflow cells written back hourly.
  Source key **`ogv_262`**. OGV now has THREE batches: **New** = 26.2,
  **Old** = the 26.1 [New] "Main" tab (`ogv_main`, was New), **Older** = the
  26.1 [Old] "Old" tab (`ogv_old`, was Old). Source keys never change (they
  are row identity) — only the batch label moved. OGT stays New/Old.
  Migration **0085_signup_batch_older** (check now allows `older` + re-tags
  the two OGV sources). `SignupBatch` / `signupBatchLabel` /
  `signupBatchesFor` in types.ts; the Batch filters offer Older for OGV only.
  ① **Access**: unlike the 26.1 trackers (link-shared "anyone can edit"),
  this sheet is shared by name — the service account
  `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com` was added
  as Editor from the IM mailbox. If the import ever 403s, check that share.
  ② **Header differences**, all mapped by name: no Email column;
  "Campaign Name" (alias), "Contact date" (alias of Contacted Date),
  **"AIESEC Representative" → the Referral field** (the member who signed
  the EP up at the booth). "Campus" and "EP Manager" are empty and left
  unmapped. The single "Status" column is the VP status; "Person Status" the
  intake one.
  ③ **Phones lost their leading 0** on the sheet ("1012345678") — and so had
  ~775 rows of the 26.1 Main tab. `trackerPhone` (signups.ts) puts the 0 back
  on bare 10-digit Egyptian mobiles for every OGV tab (`restorePhoneZero`),
  turns Arabic-Indic digits into ASCII and drops pasted bidi marks (all
  tabs). Anything else stays as typed. 1,514 of the 1,519 fixed; the other 5
  are genuinely malformed on the sheet. Sodio-side only — the sheet keeps its
  values (phone is intake, never written back).
  ④ **Techne Summit tag**: the sheet's Campaign Name was empty on all 1,519
  rows, so they were tagged `campaign = 'Techne Summit'` IN SODIO by EP ID
  after the first import (not on the sheet, by request). The tab's
  `keepCampaignWhenBlank` stops a blank cell from wiping that tag; a filled
  Campaign Name cell still wins. Later uploads carry their own campaign.
  `tests/signup-tabs.test.ts` pins the real 26.2 + 26.1 header rows, the
  phone repair and the tab/batch wiring.

- **2026-10-03 · v37.8** — **THE UI AUDIT: ALL ~54k LINES OF COMPONENTS.**
  No migration, no server changes. 22 read-only auditors (every file in
  src/components/crm, activation and ui) found 143 candidates; five fixers
  re-checked each against the code — **139 fixed, 4 skipped** (U049: the
  whole-row CV editor is deliberate, v33.8; U065: not user-visible; U108:
  showing attachments in the product-feedback inbox is a new feature; U116
  needs feedback-attachments.tsx). The ones that mattered:
  ① **Emails tab: attaching any real photo/PDF failed silently** — the file
  was spread into `String.fromCharCode(...)`, which throws past ~64–120 KB;
  now encoded in slices, with a toast if a file can't be read.
  ② **Components defined inside render** (the react-hooks/static-components
  errors) remounted on every keystroke: the IR-call dialog's email-fix box lost
  focus after each letter; SortHead in accounts / sign-ups / members /
  membership closed the column-filter menu on every render. Moved to module
  scope.
  ③ **Dialogs that never re-seeded**: Edit-LC opened blank (saving a rename
  WIPED the country) or with the previous LC's name; Record/Assign partnership,
  reschedule reason, excuse, share/tell-author, B2C call section, referral and
  NextStep cards kept the last target's values. The B2C call-back time shifted
  by the UTC offset on every re-save (datetime-local seeded from UTC).
  ④ **Action results ignored**: spinners stuck when an action threw, optimistic
  switches never rolled back (Podio card, settings), chunked bulk revive/delete
  left the dialog half-done, API-key copy claimed success before the clipboard
  answered, a failed guest-list load could reset a custom guest list to
  everyone.
  ⑤ Smaller: filters that "Clear" didn't clear, stale filters across lane/week
  switches, dashboard month/sprint ranges in the browser's zone (now Cairo),
  index keys on removable rows, popup-blocked contract opening on phones,
  the sidebar's collapsed preference leaking into the mobile drawer, column
  widths never persisting, the activation sheet's first click opening the
  editor and Escape saving instead of cancelling, plus aria-labels on
  icon-only buttons throughout.
  Lint errors 59 → 37 (the rest are set-state-in-effect patterns that are
  deliberate post-mount localStorage reads). 950 tests, tsc clean, build green.
  ⚠️ Not clicked through in a browser — every page involved needs a session.

- **2026-10-03 · v37.7** — **A FULL AUDIT: SECURITY FIRST, THEN THE SERVER CORE.**
  Migration **0084 applied** (via MCP); **0077's file recreated** from the live
  definition (it was applied in v36.3 but never committed — a rebuild would
  have left pg_cron calling a missing function). Paced around the Pro plan:
  read-only auditors on 11 cross-cutting sweeps + every line of actions.ts,
  data.ts, rbac and the sheet sync; every finding re-checked against the code
  before it was fixed, and anything that could change documented behaviour was
  narrowed or skipped (the user's rule: never fix one problem by making another).
  ① **SECURITY.** Storage keys from the browser were checked with
  `startsWith(prefix)` while storage-js puts the key in the URL unencoded and
  `fetch` collapses `..` — `"<own id>/../../contracts/…"` signed any object in
  any bucket. Every sign/confirm path now runs `isSafeStorageKey`, and
  `getContractUrl` signs only files recorded on that deal. Email identity
  lookups (Google sign-in, every request's viewer, the public login page,
  reset) used unescaped ILIKE, so `mona_ali@…` matched `mona.ali@…` and
  `%hallul%@%` mined the member list → `exactIlike`. A test view inherited the
  TARGET's `isAdmin`, so any Admin-tools holder could unmask anonymous LC
  feedback by viewing as an ADMIN_EMAILS member → capped at the real viewer's.
  Anonymous feedback leaked its author through attachment keys (`<author
  id>/…`) → opaque `ref:` handles resolved server-side; anonymous product
  feedback no longer logs its author as the audit actor. The EB-visible Drive
  backup carried password hashes, Google refresh tokens, IR manage tokens and
  anonymous authors → that copy is redacted (bucket + email stay complete).
  `/api/cxp/file` served uploads inline with the uploader's MIME from Sodio's
  origin (stored XSS) → inline only for PDF/PNG/JPEG/GIF/WebP, stored type
  derived from the extension, html/svg/xml refused. Password sign-in had no
  attempt limit and reset was unthrottled (inbox flood, Gmail quota, replaced
  temp passwords) → 10 tries/account/hour, 100/network; resets 10/network/hour
  and one fresh password per member per 10 min. upsertMember let TM Team
  Leaders/Coordinators (and any LCVP) set ANY role incl. LCP → role/function
  changes are the EB's, LCP only by the LCP/admin, nobody re-roles themself.
  `stampWork`, `syncDueRsvps`, `syncTouchPointRsvps` moved out of "use server"
  files (they were unauthenticated public endpoints). 0084: the two SECURITY
  DEFINER counters were still executable by PUBLIC (0030/0064 revoked the wrong
  roles) — `bump_rate_bucket` could overwrite any app_settings row.
  ② **THE 1000-ROW CAP, AGAIN** — now paged: IM prompt results, the approvals
  account picker (stopped at "Dream kids language"), the Violet Man's
  industry/type list (122 of 310 industries), the hourly sign-up export's
  comment read (could BLANK tracker comment cells), captureSheetComments,
  the sandbox rollback (undid the newest 1000 rows then deleted the journal),
  CIC first-caller and audit-log filter options, b2cCicStats, the unreported
  visits banner, next working hours, working-hours verdicts (dropped late
  stamps → suggested absent), attendance history, open appeals, the deals read
  in the Drive export, TL-plan allocations.
  ③ **CORRECTNESS.** Calendar events at 23:30+ (follow-ups) / 23:00+ (visits)
  ended "earlier" than they started and Google refused them → real next-day
  end. Next-step dates on contact/direct-visit/report skipped the v36.6 sanity
  check (a year-9999 step was stored). Function-settings saves never reached
  the audit log (key passed as a uuid). Cairo day bounds for plan actuals, the
  accounts "Added" range, the consideration report and TL-plan months (were
  UTC). TM directory windows OGX by assigned_at like the dashboard.
  logContact/scheduleVisit no longer report success when the account update
  failed. IR slot-request accept claims the request first (no double accept)
  and refuses past times; the decline email names the real host. Composed
  emails left as drafts are logged as drafts. Sandbox: no real calendar
  deletes/renames, no Drive export, no cancelDeal (a delete can't be undone).
  saveRoutine's update path no longer touches another owner's routine.
  ④ **CHANGELOG MOVED** out of AI_CONTEXT.md (431 KB → 56 KB): it was ~87% of
  the file every session and agent auto-loads. Add entries HERE, at the top.
  ⑤ **LEFT ALONE ON PURPOSE:** the sign-up import's GitHub cadence (~4–12
  runs/day — costs Vercel nothing; the user's call); RSVP attendance sync is
  still not wired to a cron (wiring it would start writing attendance); BCC on
  composed-email drafts still dropped (needs a gmail.ts option); 301 sign-ups
  still sit with deactivated members (a release policy is a decision).
  Not audited this round (budget): the UI components (~48k lines).
  Help: forgot-password FAQ (cooldown, "too many attempts"); HELP_VERSION →
  v37.7. **950 tests** (13 new), tsc clean, production build green.

- **2026-10-01 · v37.6** — **JULES'S 21 SUGGESTIONS, CHECKED ONE BY ONE.**
  No migration. Two real bugs (neither the one Jules named), one real test gap;
  the rest verified false and left alone.
  ① **The sign-up column filters only ever saw the first 1000 rows.**
  `signupFilterOptions` read each column with `.limit(5000)`, but the API caps
  every response at 1000 — so OGV's Campaign funnel offered 13 of its 22
  campaigns (verified against prod: old read 1000 rows / 13, new 2117 / 22).
  Each column is now paged with `fetchAll` and the five run in parallel; the
  page catches a failed read and shows no options rather than crashing.
  ② **TM stats could drop attendance silently.** `tm-stats.ts` chunked the
  `.in()` by 100 sessions (correct — URL length) but read each chunk in ONE
  request, so >1000 attendance rows in a chunk (≈15 recorded LC sessions)
  lost the rest. Each chunk is now paged. Latent — 0 recorded sessions in the
  last 30 days today.
  ③ `tests/avatars.test.ts` — the avatar URL builders had no tests.
  **False, unchanged:** sane-date / dial-codes / filters-from-params /
  looksLikeEmail "untested" (all already covered) · the bounces retry loop and
  the pending-prompts guard loop (deliberate, ≤2 and ≤5 iterations) · the
  "N+1" in tm-stats as described (one query would break the URL) ·
  `Math.random()` in Meet `requestId` (an idempotency key, not a secret) · the
  two `dangerouslySetInnerHTML` "XSS" (server-built from the VP's own form,
  every field escaped; contentEditable needs HTML) · the two "bugs" in
  comments (they describe fixed history) · the five refactor suggestions
  (not bugs; high regression risk for no behaviour change).

- **2026-10-01 · v37.5** — Two visual fixes, no migration. ① **The Road to
  Activate walker stood before the month he was in**: the man was placed on a
  road 40 units shorter than the month posts were, so on 1 Oct (day 61/124) he
  sat ~20 units short of OCT and OCT read as not yet passed. One `roadX`
  mapping now places both, and a post counts as passed by DATE
  (`p.at <= progress`), not by comparing pixels. ② **MM access select was cut
  off**: each option carried a two-line hint, and whatever is inside a Radix
  item is also what the closed trigger shows — so the trigger showed
  "The wh…". Options are the label only; the hint for the current choice sits
  under the MM's name, and the trigger is full-width on a phone.

- **2026-10-01 · v37.4** — **THE B2C CALLER AND OUTCOME STOP CANCELLING EACH
  OTHER, AND VPs SET EACH MM'S ACCESS.** No migration.
  ① **B2C CIC: "assign myself, pick an outcome → I'm unassigned; assign
  myself again → the outcome is gone."** The list's B2C cells read "the latest
  B2C call with NO outcome", and `assignB2cCic` reused the same row. Recording
  an outcome closed the row → the caller cell (open rows only) went blank →
  re-picking yourself INSERTED a fresh empty row → the outcome cell went blank.
  Production carried it on 1 Oct (Salma: "Out of service", then an empty row a
  minute later — that one row was deleted). Now `src/lib/b2c-cic.ts` is the one
  rule: the current call is the LATEST B2C row, recorded or not (the detail
  dialog has done this since v36); re-picking the same caller is a no-op; a
  blank call is handed over; a recorded call + a DIFFERENT caller = a new call
  (the old one stays in History, shown as "before: …" under the cell). A
  recorded outcome stays editable in the cell. `clearB2cCic` also refuses a row
  that carries an outcome. The Call/WhatsApp prompt (`my_open_b2c_call_id` +
  new `my_b2c_call_recorded`) now finds the latest call too and opens a NEW
  call (`startB2cCall` returns its id) when the last one is recorded — it used
  to hand a B2C caller with a recorded call the OGX owner's form, which refused.
  ② **🔑 MM ACCESS** (Settings → My function): the function's LCVP/Director
  (LCP/admin for all) sets, per Team Leader / Coordinator of IGV · IGT ·
  B2B&BD (stored once under B2B) · B2C · OGT · OGV: **team** · **whole
  function** · **only themself** · default (TL → team, Coordinator → self).
  Stored in `function_settings.settings.mmAccess` ({memberId: mode}); the
  generic `saveFunctionSettings` strips that key so a stale card can't wipe it,
  `setMmAccess` validates (active MM who works the function, no test view) and
  bells the MM. `getViewer` resolves `reachMemberIds` (`viewerReach`: explicit
  settings only — an explicit "none" is never undone by another function's
  untouched default; "function" = every active non-leader of that function, one
  members query only when needed). `reachIds(v)`/`actsOverOthers(v)` in rbac
  replace every ACCESS use of `role === "Team Leader" && teamMemberIds`:
  `accountScope`, `canReassignAccount`, `canEditRequestState`,
  `canWorkSignup`, the sign-ups mine/team/referral/archived views,
  `signupReassignTargets`, `reassignSignup`, B2C CIC targets + `assignB2cCic`,
  `reassignIrCall`, `canEditApproval`, the consideration "calls need you" scope.
  STRUCTURE is untouched on purpose: team card, team plan, team leaderboard,
  attendance, PDP, calendar-item assignees and email groups still follow the
  Manager column. Nothing set = byte-for-byte the old behaviour (tested).
  ③ **Help centre**: new 🔑 MM access article; CIC (the current-call rule),
  Function defaults (moved to Settings in v37.2 — the article still said
  profile), Edit the membership (still called the sheet two-way and said
  "yes, edit the sheet" — wrong since v37.2), Say something to the LC (v37.3's
  answers + Close it) and Reporting IR calls (departed hosts, v37.1) updated;
  HELP_VERSION → v37.4; the Violet Man taught the same. **931 tests** (19 new
  in `tests/mm-access.test.ts`), tsc clean, production build green.
  ⚠️ Not clicked through in a browser — /signups and /profile/settings need a
  signed-in session.

- **2026-09-26 · v37.3** — **THE ANSWERS TO "SAY SOMETHING TO THE LC" ARE
  VISIBLE.** Since v34.7 every rating, sentence, acknowledgement and skip was
  stored in `im_prompt_responses` and nothing ever read it. /admin now shows
  "What the LC answered" under the composer (`im-prompt-results.tsx`,
  `server/im-prompt-results.ts`, read as the REAL viewer, admin tools only):
  per prompt — sent / answered / skipped / still waiting, the rating average
  and spread, every answer with name and time, who hasn't answered, and
  "Close it" (takes it off the screens still waiting; answers stay). Export:
  `im_prompts` (Prompts + Answers sheets). No migration.

- **2026-09-26 · v37.2** — **SETTINGS IN SECTIONS, EXPORT EVERYWHERE,
  MEMBERSHIP IN SODIO, AND A REAL NEW-TERM / NEW-PEAK FLOW.** No migration
  (everything new lives in `members.settings` and `app_settings`).
  ① **PLANNING IS THE LEADERS'.** Members (and MMs) no longer receive their
  managers' planning anywhere: the period-report cron sends TWO versions —
  leaders (LCP/LCVP/Director/ADMIN_EMAILS) get the plan check and the MM plan
  list, everyone else the same report without them — and the OGX lane's
  "VPs' plan vs achieved" card is nulled server-side for non-leaders (an MM
  keeps their own filed plan).
  ② **EXPORT, FOR WHAT YOU CAN SEE.** `src/server/exports.ts` is the registry
  (accounts · sign-ups · approvals · IR calls · partner LCs · CV pool ·
  membership · members directory · attendance · CXP · dashboard workbook);
  each export is built by the SAME scoped reader its page uses, with the SAME
  URL filters (`src/lib/filters-from-params.ts`, now shared by the accounts
  and sign-ups pages; `src/lib/dashboard-lanes.ts`, now shared by the
  dashboard page). `/api/export` STREAMS the JSON book (a 4.5 MB body would
  otherwise be refused) and audit-logs every export; `ExportButton` builds
  Excel (every sheet) or CSV (one sheet, formula-injection-safe) in the
  browser. Buttons on Raising, Sign-ups, the Dashboard, Consideration (the
  open tab), Attendance, Members, CXP and Membership; Settings → My data lists
  them all. Verified live: an admin exports 3,629 accounts, a Member 60.
  ③ **SETTINGS, IN SECTIONS SHAPED TO THE PERSON** (`/profile/settings`,
  `settings-hub.tsx`): Notifications & account (the existing panel) · **My
  defaults** — home page, dashboard lane, rows per page, Sign-ups view, stored
  in `members.settings.defaults` and READ by "/", the dashboard, the four
  paged lists and Sign-ups (`saveMyDefault` validates each against what the
  person may open) · **My team** (TL: active/inactive) · **My function**
  (function defaults, moved off the profile) · **My data** · **Handover**
  (leaders) · **LC & new term** (LCP/admins, `canRunLcTools`).
  ④ **MEMBERSHIP LIVES IN SODIO** (the LC's decision). `app_settings`
  `membership:source` defaults to "sodio": the 30-min sheet import is a no-op,
  and the "CRM — Membership" sheet is a MIRROR (`mirrorMembershipToSheet`
  rewrites it; per-member edits still write their row). The import was split
  so a FILE runs the exact same rules (`applyMembershipGrid`), with a dry run
  (`previewMembershipGrid`: new / changed-with-what / unchanged / unreadable
  with the reason / leaving). /membership has Upload + Download + "Rewrite the
  sheet". A plain update is the EB's; a **restart** (whoever isn't on the file
  goes inactive — history kept) is the LCP's/admins', and refuses a file that
  would deactivate more people than it lists. Verified: exporting today's 83
  members and previewing that file = 83 unchanged, 0 new, 0 leaving.
  ⑤ **NEW PEAK / NEW TERM** (Settings → LC & new term, `lc-actions.ts`,
  `lib/lc-term.ts`): a PEAK restarts membership and keeps planning; a TERM
  restarts both. Steps: planning (link the sheet — access checked — or upload
  the planning workbook .xlsx, parsed by the same `importPlanningSheet` /
  `importBdB2bPlanning` through `readPlanningTab`; "later" leaves a reminder),
  membership restart from a file, handover (general + per function + links,
  `lc:handover`, read by leaders in Settings → Handover), then Start (stamps
  `lc:term`, keeps `lc:term-history`, fresh checklist, bells the EB).

- **2026-09-26 · v37.1** — **A FRESH CXP DIRECTORY, PLANS THAT FOLLOW THE
  VIEWER, DEPARTED PEOPLE STOP OWING REPORTS, TLs MANAGE THEIR TEAM'S STATUS.**
  No migration.
  ① **CXP STARTS A NEW DRIVE DIRECTORY** (the LC's call: forget the old
  system's files). "Sodio — CXP Submissions" (`1MLaJcRv10DNcjZUt-9h_5TYPKBgkI2AL`),
  owned by the IM mailbox and shared with the service account as writer —
  the same model as the Aug-26 root, which is left untouched. Its id lives in
  `app_settings` `cxp:drive-root`, read FIRST by `cxpRoot()`;
  `CXP_DRIVE_FOLDER_ID` is only a fallback now. The three Sept-20 test uploads
  still download (they are addressed by file id).
  ② **APPROVALS PLAN VS ACHIEVED FOLLOWS THE VIEWER** — the rule the raising
  lanes already follow (v25 / v36 ⑤): VP · Director · LCP · admin → the
  planning sheet vs the lane; Team Leader · Coordinator → the plan THEY filed
  on their profile (mm_plans approvals; a sprint is half the month, rounded
  up) vs their own MOS (a TL's own + team); a Member → no plan, just the
  counts and boards. `ApprovalPlanSource` in `lib/icx-approvals.ts`,
  `approvalPlanSourceFor` in `server/icx-approvals.ts`. The lane's
  "Consideration plan" card (every MM's plan summed) is leaders-only, and
  the period-report email — sent to members too — shows the approvals count
  without a plan.
  ③ **A DEPARTED HOST'S UNREPORTED WORK IS NOT FLAGGED.** An inactive member's
  past-due IR calls no longer show "⏰ Time passed — report it", don't count
  in "N calls need you", the dashboard's "Waiting to be reported" or the
  leaderboard's Waiting column (`host_inactive` on IrCallRow; `hostGone` in
  `considerationStats`), and their visits leave the "N visits need a report"
  banner. The rows themselves stay — history is not deleted.
  ④ **TEAM LEADERS MARK THEIR MEMBERS ACTIVE / INACTIVE** from Profile → My
  team (`setTeamMemberActive`): their DIRECT reports only, never themself,
  never from a test view; the EB keeps the full editor. Written back to the
  Membership sheet in the same call (it is two-way — the 30-min import would
  flip it back otherwise). The TL's card now lists inactive reports too, dimmed,
  with "Make active".

- **2026-09-26 · v37** — **CXP UPLOADS ARRIVE, CXP DOWNLOADS EXIST, AND ICX
  APPROVALS ARE COUNTED.** Migration **0083 applied** (the private
  `cxp-staging` bucket, 25 MB cap; the `icx_approvals` table).
  ① **CXP: "IT DOESN'T UPLOAD."** The file rode inside the server action's
  own request, and Vercel refuses any request body over **4.5 MB** before the
  app sees it — while the page promised 25 MB. Phone photos and scanned PDFs
  (most real documents) died with no message; in a month **three** documents
  were ever attached, all small PDFs. Now: the browser PUTs to a signed URL in
  `cxp-staging` (the contracts/CVs pattern) with a progress bar, then
  `confirmCxpUpload` moves it into the EP's Drive folder and deletes the
  staged copy (abandoned ones older than a day are swept). Every failure is a
  toast — the old path threw inside a transition and just stopped. Verified
  live: a 6 MB file through the signed URL, read back, removed. The DB write
  after the Drive upload is now checked (a lost write showed a document as
  missing while it sat in the folder). Uploads are refused in a sandbox test
  view (a Drive file can't be undone). `clearCxpRequirement` existed with no
  button — rows now have 🗑 "mark as not collected" (the file stays in Drive).
  ② **CXP: "NO BUTTON TO DOWNLOAD LIKE THE OLD SYSTEM."** Three faults: the
  weekly **Download ZIP** was leaders-only and hidden on past weeks; it
  `window.open`ed a Drive link after an `await` (popup-blocked); and it was
  built from `selectWeeklyEps` — the EPs that still OWE something — reading
  one stage each, so an EP with everything in was never in its own week's ZIP
  and the ZIP came out empty (Drive's "Generated ZIPs" folder had nothing in
  it, ever). Now a streamed route (`/api/cxp/zip`, exempt from the 4.5 MB cap
  because it streams) builds the ZIP on the fly from `collectedForWeek` —
  the COLLECTED half of the board's own definition (current + overdue +
  always-owed, for the deadline's own month) — stored not deflated, a
  `_README.txt` listing what's in, what's ticked-only and what's missing, and
  a `_SKIPPED` note instead of a failed download when one Drive file is dead.
  **Anyone who reads the function downloads** (the old system's reach),
  past weeks included; the Drive folder of shortcuts stays leaders-only and
  its selection got the same fix. Each document has **View / Download**
  through `/api/cxp/file` — the old "View" pointed at a mailbox-owned Drive
  file most members had no access to — and an EP page has **Download all**.
  Downloads and ZIPs are audit-logged (passports are PII).
  ③ **CXP, ALSO:** 25 EP stages sit in two monthly tabs, so their EP pages
  listed every document twice under one React key — the page keeps the
  newest month per stage. Phones get cards instead of a four-column table.
  ⚠️ **NOT FIXED — A QUESTION FOR THE LC:** `CXP_DRIVE_FOLDER_ID` points at a
  root holding ONE EP folder (4 files, all from Sept 20). The old system's
  trees ("AIESEC in Alexandria Internal Audit System", "EPs Folder (DOCs)")
  are not visible to the IM mailbox at all, so the Drive scan has never
  matched a manually dropped document (0 rows). Share the old root with the
  mailbox (or point the env at it) and the scan picks it up.
  ④ **ICX APPROVALS — THE ICX MOS.** The planning sheet has planned approvals
  per product since v21 and consideration MMs file an approvals plan every
  month; nothing counted one. **Consideration → Approvals** logs them: product
  (GV/GTa/GTe), EP + EXPA id, date, sending LC, how it came (IR call / CV /
  EXPA / referral, linked), our opportunity (account), EP contact, notes. The
  ECB SubTool (already synced for CXP) **suggests** the ICX approvals nobody
  has logged (last 150 days), prefilled; the claim says WHO. **Credit rule
  (the LC's):** one person; a member's approvals also count for their Team
  Leader, whose own count too — two boards, by person and by MM. Crediting
  someone else follows the partnership-target reach. `expa_key` (unique) +
  a bare-EP-id match stop double counting. Shown on the dashboard lane
  (planned vs achieved — month, or sprint on the chip — and the peak, a
  monthly strip, both boards, sources, sending LCs; the consideration
  leaderboard now ranks by approvals), consideration MMs' profile plan,
  /planning (achieved / planned on the approvals row + three cards, and on
  each MM's plan), and the period reports' consideration section (KPI with
  the plan %, per-person column).
  ⑤ **TWO LATENT BUGS FOUND ON THE WAY:** the consideration leaderboard keyed
  CV counts by member ID while everything else keyed by name, so every CV
  uploader got a second row titled with their UUID; and the period report
  asked `lc_partnerships` for a `made_on` column that never existed, so every
  report since v36 said **0 partnerships**. Both fixed.
  ⑥ **"I PICK 100 A PAGE ON CIC AND IT STAYS ON 20."** The sign-ups picker
  dropped `?size` whenever 100 was chosen, because 100 USED to be the
  default — v33.10 made it 20 and the literal was never updated. It compares
  against `DEFAULT_PAGE_SIZE` now, and `tests/page-size.test.ts` fails on
  any table deciding a size param from a literal.
  Help centre: 2 new articles (🏆 Approvals, 🗂️ CXP documents — CXP's first);
  HELP_VERSION → v37. **896 tests** (18 new), tsc clean, lint identical to baseline,
  production build green. ⚠️ Not clicked through in a browser — every page
  involved needs a signed-in session.

- **2026-09-19 · v36.9** — **VP/DIRECTOR PLANNING: A NEW SHEET, A REAL WINTER
  REFRESH, AND BD/B2B GET A GOAL TOO.** Migration **0082 applied**
  (`plan_cells` gains fn `'BD'`/`'B2B'`, scope `'term'`, metrics
  `'revenue'/'contracts'/'slots_igv'/'slots_igta'/'slots_igte'`).
  ① **THE OLD PLANNING SHEET WAS DEAD; THE LC HAS ALREADY MOVED TO A NEW ONE.**
  "Alexandria | Planning Tool 26.1" confirmed **403** for the service account
  — the share never landed, full stop. The LC's own planning has continued on
  a successor spreadsheet, **"Alexandria | Planning Tool 26.2"**
  (`1BF4nh017y12glrOzfQBNarS2tNya9P7QInvpE11HC5I`), shared **"Anyone with the
  link"** — no share step needed, confirmed by reading it directly with the
  service account before touching anything. `app_settings.planning:sheet-id`
  now points at it. **The 6-lane tabs (iGV/iGTa/iGTe/oGV/oGTa/oGTe) kept the
  EXACT layout `importPlanningSheet` already parses** — same "here is the
  overview" / "LC goal distribution by Sprints" markers, same 7-row funnel
  order — so no parser changes were needed there, only the pointer.
  ② **THE WINTER PEAK WAS REFRESHED, SUMMER LEFT ALONE** (by request —
  Feb–Jul's numbers were spot-checked first and are unchanged anyway).
  `importPlanningSheet` gained an optional `monthsFilter` param; a one-off
  script (`scripts/reimport-planning-26-2.mjs`) ran it for Aug 2026–Jan 2027
  only. IGV's August goal alone moved 15 → **26** opens — the winter targets
  really had changed, confirmed before reimporting by diffing the sheet
  against the live `plan_cells` rows.
  ③ **BD & B2B GET A REAL GOAL-VS-ACHIEVED, FOR THE FIRST TIME.** Both
  functions have had a dashboard lane since v15/v16 with nowhere to show a
  target — `performance_goals` was retired in v22 ("goals come from
  planning") and the 6-lane `plan_cells` importer explicitly skipped them.
  Their sheet tabs don't fit that shape: **BD** sets one term-wide revenue
  figure ("BD Goal 26.27" = 124,000 EGP) + a contract-count target (12); **B2B**
  sets a per-product slots split (IGV 30 / IGTa 21 / IGTe 21) + its own
  (currently unfilled) revenue cell. New `importBdB2bPlanning` reads both by
  MARKER TEXT (never a fixed cell address — the same caution the 6-lane
  parser already follows), storing them as `plan_cells` `scope='term'` rows.
  **"Achieved" is TERM-TO-DATE** (since the term's own February), not scoped
  to a sprint/month, because the target itself isn't one — a new
  `dealsTotalsForAccountFn(fn, from, to)` sums `deals` joined to accounts
  carrying that exact function LABEL (⚠️ deliberately NOT `laneOpensActual`,
  which blends every product's opens together across whichever account raised
  them — BD/B2B need their OWN accounts' deals only). Shows as a new
  `TermPlanCard` on the B2B dashboard lane (leaders only, same gate as the
  6-lane `lanePlan`) and as a "Term check —" line in the B2B/BD period-report
  email, replacing what used to be total silence on the plan there. Either
  half is omitted wherever the VP hasn't actually filled the number in yet
  (B2B's revenue currently reads 0 — a live formula over blank input cells,
  not a bug) rather than showing a goal of zero.
  ④ **THE OGX (oGT/oGV) PERIOD-REPORT EMAILS HAD NO GOAL-VS-ACHIEVED AT
  ALL** — `buildOgxReport`'s `planLine` was a fixed methodology sentence
  about what the funnel counts, never a comparison, even though the OGX
  DASHBOARD (`ogxDashboard.lanePlan`) has compared applicants/accepted/
  approvals plan vs sign-ups-worked since v33.52. The email now runs the
  identical `plan_cells` lookup and the identical "worked in this window"
  rule the dashboard's own `tally()` uses (so the two can never disagree),
  and prints e.g. *"Plan check: 34 of ~50 applicants · 12 of ~20 accepted ·
  4 of ~9 approvals planned for this sprint (44% of the approvals goal)."*
  before the same methodology note as before. Falls back to the methodology
  note ALONE when no plan_cells target exists for that window (e.g. before
  any import has run).
  ⑤ **DELIBERATELY LEFT OUT, after actually opening the tabs first: B2C and
  TM.** B2C's goal-setting tab plans a sign-up/marketing-channel funnel
  (#SU/#APP/#APD by GTa/GTe/GV, Campus/PR/Event counts) that nothing in
  Sodio's B2C module tracks — B2C's own data is accounts + contract-signed
  deals, not sign-ups, so there is no honest "achieved" to show against it.
  TM's tab ("Funnel & HR Plan") plans **internal AIESEC member recruitment**
  (staffing the LC itself) — a different domain from every other function
  Sodio tracks, with zero comparable data in the CRM. Both would need a new
  tracking feature, not a planning refresh, and are documented here rather
  than silently skipped.
  ⚠️ **The self-serve "Re-import from sheet" button stays removed** (v26) —
  by request, this remains a by-hand action; `runPlanningImport` (now also
  calling `importBdB2bPlanning`) is reachable only via a dev session or a
  future UI re-add, not from `/planning` today.

- **2026-09-14 · v36.8** — **THE BID PAGE, ROUND TWO.** No migrations; data
  fixes applied to prod.
  ① **MMs AND ABOVE ONLY.** `canSeeActivationBid` (master, or any role but
  Member). `/activation` left GateClient's ALWAYS_ALLOWED; the layout adds it
  to the gate routes for exactly them; the page redirects a Member to the
  public `/activate26`; `editor()` and both read actions refuse a Member.
  ② **THE FLIP BUG.** The OCVP cards vanished after a flip and came back on
  scroll: `useReveal` marked revealed elements with a CLASS, and React
  re-renders `className` (the flip toggles `is-flipped`), wiping it — a
  `[data-reveal]` without it is opacity 0. Revealed is now the `data-in`
  ATTRIBUTE, which React never touches; every `.is-in` selector moved with it.
  ③ **"ADD SECTION DOESN'T WORK."** Supabase's edge logs show the action's
  first query (`select id, position`) never ran all day, and no test view was
  on — the click never reached the server. Not reproduced (the page needs a
  signed-in session). Hardened instead: a **+ Section** button in the dock and
  a big button after the acts both open ONE dialog; success toasts and
  scrolls to the new act; `run()` now logs a thrown save to the console;
  ids come from `newSectionId` (an Arabic title → `s_section`, never empty).
  ④ **NO "DONE".** Nothing on the page is a task: the timeline's Done column,
  the checkpoint "Mark done"/progress, the checklist ticks and the confetti are
  gone; `done` was stripped from every row and from the checkpoints/selection
  columns in prod, and `seedPlan` drops it from seed.json.
  ⑤ **THE WEEK BOARD** is the timeline's default: weeks × teams, every item in
  full with its date, "↳ … until" for what's still running, checkpoints in the
  week label. Gantt and Agenda stay.
  ⑥ **BULK EDITING LIKE SHEETS** in `sheet-grid.tsx`: range selection (drag,
  Shift+click/arrows, column header), Delete clears, ⌘/Ctrl+D / R fill,
  ⌘/Ctrl+C copies the block, one pasted value fills the range, a "Set all to…"
  bar, and ticked rows deleted together (`deleteActivationRows`, with Undo).
  ⑦ **THE CASTING LIST, REPAIRED** (a paste had appended the whole Mapping
  again): 252 → 162 live rows — 99 duplicates/blanks/the pasted header
  soft-deleted, names Title-Cased and ALL-CAPS text tidied, 5 spelling
  variants matched to their members, and the 9 active members missing from it
  added (LCP/LCVP → EB, Director/TL/Coordinator → MM). The list heading is
  **Mapping** (`config.listTitle`, editable in Edit mode) and "Showtime" is
  **HR Plan**, like the sheet.
  ⑧ **LOOK**: each act is its own stage (`.circus-stage`, gold footlight) with
  an intermission ornament between acts; two coaches sit side by side; the
  hero's pointer spotlight fades instead of cutting at the hero's edge; the
  Greatest Showman poster sits behind the marquee (masked on every side) and
  under the curtain call.
  ⑨ Also: the 8 accounts with impossible next-step dates were cleaned (three
  slipped years → 2026, five junk dates cleared — 7 of the 8 were one
  member's).

- **2026-09-14 · v36.7** — **THE ACTIVATE 26' BID PAGE.** Tables from migration
  **0081** (`activation_sections`, `activation_rows`, `activation_set_cells`).
  The LC is bidding to host Activate 26' and was asked to keep the plan in
  Sheets; it lives here instead, editable like a sheet by every member and
  readable by anyone at `/activate26`. Theme: *The Greatest Showman* — a
  midnight big top (`circus.css`, its own committed look, Rye + Playfair via
  next/font, all motion off under reduced-motion).
  ① **MERGED** "Activate" (Timeline, Checkpoints) and "Activate 26'"
  (Structure & JDs, Mapping, HR Plan, OC-TimeLine1) into five acts: the road
  (a Gantt per team, agenda on phones), nine checkpoints, the ringmasters,
  the casting call + OC selection, and showtime (Day 0–3). Typos and
  ALL-CAPS were tidied; content was not changed. The HR Plan's unrelated code
  block ("Atomic Treasure…") was left out.
  ② **THE DATES WERE FITTED, NOT INVENTED.** The sheet ran 25 Sep → 22 Dec,
  past its own Day 0/Day 1 (2–3 Dec), and its Checkpoints tab carried
  different dates (30 Sep → 25 Nov) that contradicted the timeline.
  25 Sep – 6 Oct kept its exact dates; 7 Oct – 22 Dec kept its order and
  relative spacing, compressed to end 1 Dec, so the checkpoints fall exactly
  every 5 days (18 Oct → 27 Nov) and Day 0–3 are 2–5 Dec. Every bar keeps its
  sheet date in `original` (edit mode shows it). Pinned by
  `tests/activation-seed.test.ts`.
  ③ **EDITING**: tables become a sheet in Edit mode (type-to-edit, Enter/Tab,
  arrows, paste a block from Google Sheets, add/rename/retype/hide/delete
  columns, insert/move/delete rows with Undo); the road drags and resizes;
  acts can be renamed, reordered, hidden from the public page, added and
  (custom ones) deleted. Cell saves merge ONE key server-side, so two editors
  never overwrite each other's cells; edit mode polls every 15 s while
  visible. Deleting a column keeps its data (re-adding the same name restores
  it).
  ④ **PUBLIC**: `publicPlan` drops hidden acts, editor names and the pre-fit
  dates, and shows the casting list's numbers but NO names unless
  `namesPublic` is on. ⚠️ The public page is `force-dynamic` on purpose —
  prerendering it would need the database at build time.

- **2026-09-14 · v36.6** — **ACCOUNT EDITS SAVE THEMSELVES, AND THE WALKTHROUGH SHOWS
  ONCE.** Migration **0081 applied** (`members.tour_seen_at` + the Activate bid
  tables, used from v36.7).
  ① "They edit an account, they get outside and nothing happened." Measured
  first: every account PATCH that reached Supabase in the last day was a 204,
  and the audit log held only ~20 `update` saves in 30 days — the edits were
  lost BEFORE being sent. The Details, Contact info and Next-step cards only
  saved on a button that appeared once something changed, and the Next-step
  one stayed DISABLED while the step had no date, with nothing saying why.
  They now autosave: `src/lib/autosave.ts` (pure, tested) + `use-autosave.ts`
  flush on a pause, on blur, when the tab is hidden (tapping WhatsApp/Call),
  on pagehide and on unmount; `beforeunload` asks while anything is unsaved;
  `SaveStatus` says Saving / Saved / "Not saved yet — why" / "Not saved —
  Retry". A failed save is kept, never dropped. The function MOVE stays an
  explicit "Move to X" button. ⚠️ Any new editable card should use
  `useAutosave` — `tests/account-edits-save.test.ts` pins the four on the
  account page. Also: `next_step_date/time` are validated (`lib/sane-date.ts`)
  — "20888-09-17" was being stored and then refused by Google Calendar.
  The live clash check (v36.5) was checked and is NOT the cause: it skips
  values an account already holds.
  ② The first-run walkthrough kept reopening for some members (Yassin
  ElHawash). "Seen" was a localStorage flag written only on Done/✕, so leaving
  mid-tour, clearing the browser or a second device restarted it. It is
  `members.tour_seen_at` now, set the moment it OPENS (`lib/tour-state.ts`,
  `markTourSeen`); everyone who had already completed onboarding was
  backfilled as seen. Help's "↻ Replay the walkthrough" still opens it.

- **2026-09-12 · v36.5** — **THE DUPLICATE GUARD REFUSES ACROSS FUNCTIONS AND WARNS
  AS YOU TYPE; THE DRIVE IMPORT READS FILES THEIR NAME COULDN'T SETTLE; CC/BCC
  ON PROPOSALS.** No migrations.
  ① Reported the day after v36.4: "u didn't do it, it doesn't work!". The data
  showed exactly why: at 12:56 "boba spot" (BD) was added with the phone of
  "boba spot cafe" (IGV), and "Tim's coffee" (BD) with timscoffee.eg's (B2B).
  v36.4 refused only inside the same name world — copying the name rule, which
  nobody asked for — and BD is its own world, so neither was stopped. The rule
  is now the floor's: ANY other account (`contact-clashes.ts` no longer
  filters). It also runs LIVE while typing (`checkContactClashesLive` in
  `server/contact-actions.ts`; `useContactClashes` + `ContactClashWarning`) on
  the add dialog and the account page, and Save stays off until the value
  goes; the server still refuses on its own. The two duplicates above were
  left for a human to merge.
  ② Drive import: two real CVs ("CV_ Tunisia opportunity.pdf", a Canva export
  "CV Professionnel Minimaliste Bleu_…pdf") were skipped as "Untitled
  document" — judged by file names that named nobody. The classifier now
  flags `unsure`, and `needsContentCheck` sends those — plus any rejected file
  whose name says CV/resume and any CV without a name — to
  `readDocByContent`, which downloads the file and has Gemini READ it (4 at a
  time, at most 20 per scan). Files already recognised as certificates or
  transcripts are not reopened.
  ③ Proposal emails: CC and BCC under the recipient (up to 10 valid addresses
  each; the recipient is never copied to themselves).

- **2026-09-11 · v36.4** — **SEARCH BY NUMBER, ONE COMPANY ONE ACCOUNT, LOCATIONS,
  A DRIVE CV IMPORT, AN AI THAT READS EVERYTHING, AND AN EDITABLE PROPOSAL.**
  Migrations **0078, 0079 and 0080 applied**.
  ① **`contact_key` (0078)** — ONE SQL function turns a phone (digits; 01…/02…/
  03… read as +20; a wa.me link IS that phone), an email (lower-cased) or a
  link (no scheme, www., m., trailing slash or ?query; fb.com = facebook.com;
  redirect wrappers and bare platform front pages yield nothing) into a
  canonical key. `accounts.contact_keys` is a GENERATED, GIN-indexed column of
  them, so no write path can forget it, and the same function reads the typed
  side of every comparison — **never re-implement it in TypeScript**.
  ② **Search by number** — `account_ids_matching_contact(q)` (4+ digits, or an
  @ . /) is OR'd into `buildAccountsQuery`'s name match: "0101234" finds
  +201012345678, a pasted Instagram link finds its account.
  ③ **One company, one account** — asked for in as many words ("abc
  kindergarten and abc pre school"). `account_contact_clashes()` →
  `server/contact-clashes.ts`: `createAccount` (so the import and the direct
  visit too) and `updateAccountContacts` refuse a phone, email or link another
  account in the SAME name world already holds, with that account's details
  in the refusal. Cross-world is allowed, matching the v33.29 name rule; only
  values NEW to an account are checked. Measured before: 413 values were
  already shared by 814 accounts (393 within one world) — left as they are.
  ④ **Location** — maps.app.goo.gl, goo.gl/maps, google.*/maps, Apple Maps and
  Waze tag "Location" and draw `GoogleMapsIcon`; 69 existing links re-tagged
  (0080). `l.facebook.com/l.php` — pasted on 6 unrelated accounts — no longer
  yields a key.
  ⑤ **Bulk edit** — the explanatory note is gone and the function the whole
  selection is already in is not offered.
  ⑥ **The Violet Man reads everything the viewer can** (over a screenshot of
  him saying he couldn't filter by industry). `searchAccounts` takes every
  account filter (industry and type matched loosely against the values that
  exist; responsible by name, "me" or "unassigned"; archived
  exclude/include/only) and returns every field; `getAccountDetail` returns
  all of it; new `findMembers`, `searchSignups` (OGX/B2C), `searchPartnerLcs`
  and `searchIrCalls` (consideration). Each tool is offered only to people
  who can open that module and runs the page's own scoped read.
  ⑦ **Drive CV import (0079)** — `lib/drive-cv-plan.ts` (pure, tested) +
  `lib/drive-cv-import.ts`; `scanDriveCvFolder` plans, `importDriveCv` copies
  one file per call. Gemini sorts the tree (CV or not, person, GTa/GTe,
  sector); rules stand in when it's unavailable. ⚠️ The mailbox that downloads
  can read Sodio's own Drive (backups, CXP, screenshots), so anything the
  mailbox OWNS and the CRM folder are refused, and every file's parents are
  walked up to the scanned root before a byte is copied. `cvs.drive_file_id`
  (unique) makes a re-import skip, `file_hash` still de-dupes by bytes, and
  `source_path` / `product` record where it came from.
  ⑧ **Proposal preview** — one dialog, two views (the second, stacked dialog
  was why "Keep editing" closed everything); the letter is `designMode` in a
  script-less same-origin iframe, and the edits — sanitised by
  `lib/email/edited-html.ts` — are what gets sent.

- **2026-09-10 · v36.3** — **BULK EDIT, THE SHEET EXPORT FINISHES, AND THE
  REMINDERS RUN ON TIME.** Migration **0077 applied** (`visit_followups_due()`).
  ① **BULK EDIT.** The active list's bulk bar gains **✏️ Edit**: move the
  selected accounts to another function the viewer works and/or file the same
  comment on each (≤50). `bulkEditAccounts` decides nothing new — every row
  goes through `moveAccountFunction` and `addComment`, so a bulk edit can never
  do what a single one couldn't, and the first refusal comes back verbatim. A
  name clash when moving into the BD/B2C worlds now says so instead of a raw
  23505.
  ② **YARA'S 50 → B2B.** The 50 pool accounts handed to Yara Ali on
  2026-09-01 that landed in BD (v36.2 ③) were moved to B2B, as asked: all
  untouched, 0 name clashes in the ICX world checked first, project/product
  cleared, one `move_function` audit row each under Ahmed.
  ③ **THE SHEET EXPORT WAS CANCELLED ON EVERY RUN.** Cause, from the run log:
  one protected cell on the OGX tracker's "Old" tab made Google refuse the
  whole sign-up batch, and v36's fallback then wrote every cell on its own
  until GitHub's 10-minute limit. `writeSignupsBackBatch` now reads the tab's
  protected ranges first (`isCellProtected`, honouring warning-only ranges,
  unprotected holes and ranges the service account may edit), writes the rest
  in ONE batch, and narrows any leftover refusal by Google's own `data[i]`
  index or by halving, under a 4-minute cap. Refused rows still hold the
  watermark back. `tests/sheet-protection.test.ts`.
  ④ **REMINDERS BACK ON pg_cron — GATED, SO VERCEL CPU BARELY MOVES.** GitHub
  ran the 30-min reminder schedule 5 times in 24 h. Now pg_cron asks
  `visit_followups_due()` every 15 min — pure SQL, free, "no" before 07:00
  Cairo — and calls `/api/cron/visit-followups?passes=reminders` ONLY when a
  visit follow-up, B2C call-back or next step is actually due; `passes=
  reminders` skips the Gmail bounce scan, which stays on GitHub as the new
  `ir-bounces` job. `visit-followups` is manual-only in `crons.yml` now —
  never schedule it in both places, or a reminder can go out twice. The SQL
  gate MIRRORS `visit-followups.ts` + `lib/next-step-reminder.ts`: change one,
  change the other.
  ⑤ Vercel: the other five projects with functions were pruned to what serves
  a domain plus one rollback each (auditing 29 → 2, website_2.0 37 → 4,
  worldfit-self-discovery 3 → 2, worldfit-careers 5 → 2, yacht-pilates 22 → 3).

- **2026-09-10 · v36.2** — **EVERY EMAIL AND NOTIFICATION HAS A SWITCH, NEXT
  STEPS ARE REMINDED FOR EVERYONE, AND B2B+BD HAND-OUTS LAND IN B2B.**
  Migration **0076 applied** (`accounts.next_step_reminded_key`).
  ① **SETTINGS: 21 TOPICS × {Email, App}.** Asked for in as many words: "turn
  on/off any emails/notifications or both, so be customizable". Every send to
  a member names a topic — `notifyMembers(…, topic)` for the bell (and so the
  phone push), `sendEmail({ topic })` for the inbox — and the ONE filter per
  channel lives inside those two (`membersWanting` / `emailsOptedOut` in
  `server/member-settings.ts`; email is matched by address, @aiesec.net or the
  backup Gmail). 73 call sites were tagged by an AST codemod, not by hand.
  Untagged = always delivered: only the password reset, the welcome, and mail
  to non-members (IR bookers). ⚠️ This REVERSES v34.8's "must-dos stay on" for
  visit follow-ups, attendance and Podio — the floor asked for "any". The five
  v34.8 keys are read into their topics (`LEGACY_SETTING_KEYS`) and dropped on
  the next save. Settings are a page of their own, **/profile/settings**,
  entered from a card on the profile, with All on / All off per channel.
  `tests/member-settings.test.ts` parses every send with the TypeScript
  compiler and fails if a switch has no send behind it, or a send uses a
  channel its topic doesn't offer.
  ② **NEXT-STEP REMINDERS WERE HALF-WORKING.** Measured: of 100 upcoming next
  steps only 50 had a reminder — the only one was the Google Calendar event
  `syncNextStepReminder` writes, 44 owners never connected Google and 6 more
  simply had none. Sodio now reminds every responsible itself on the
  visit-followups tick (`lib/next-step-reminder.ts`) — which is GitHub
  Actions `crons.yml`, **every 30 min, 04–21 UTC** (07:00–00:00 Cairo), not
  the 15-min pg_cron `cron.sql` still describes — so a timed step is reminded
  30–60 min before it, a date-only one (84 of the 100) at the 09:00 Cairo
  pass, and a step timed before 07:00 at the first pass. ⚠️ **In practice
  GitHub runs far fewer**: 10 scheduled runs in the 24 h to 2026-09-10 14:00
  UTC instead of ~54 — 5 visit-followups, and 5 sheet exports that hit the
  10-min timeout and were cancelled. Until the tick moves back to pg_cron
  (the route still exists), every visit-followups pass is hours apart. One
  bell + one email per person per pass; once per (date, time) via `next_step_reminded_key`, so
  moving a step re-arms it. Topic `next_steps`. The calendar event stays as a
  bonus. ⚠️ 689 open next steps are already OVERDUE and are deliberately not
  chased — what an overdue digest should say is a decision, not a bug fix.
  ③ **B2B BEFORE BD.** "When an unassigned account is assigned to a B2B and BD
  user, make it B2B not BD." Claims already picked B2B; HAND-OUTS took the
  target's first-listed function, and three of the eight dual members are
  listed "BD, B2B" — so all 50 pool accounts handed to one of them on
  2026-09-01 landed in BD. `raisingFunctionsOf` moved to `rbac.ts` and, with
  `claimTargetFunction`, runs through `preferB2bOverBd`. Those 50 existing
  accounts were NOT converted — waiting on a yes.
  ④ Vercel: the old CRM deployments were deleted (94 → 2: live + one
  rollback). The retention policy (30 days, keep 10) could not be changed
  through the API — it is a dashboard setting.

- **2026-09-10 · v36.1** — **VERCEL'S STORAGE CEILING, A PODIO FALSE "SUBMIT
  IT", AND PARTNERSHIPS WITH LCs ALREADY CALLED.** No migrations; one new
  private Storage bucket (`proposals`).
  ① **THE FREE TEAM HIT 100% OF ITS 10 GB FUNCTION STORAGE** (Vercel email,
  2026-09-09). Measured on a local build, every function traced **~97 MB**:
  **39.7 MB was the four proposal PDFs** — `outputFileTracingIncludes:
  { "/**": ["./proposals/**"] }` copied them into EVERY function to serve one
  action — and a **12.4 MB chunk, twice (page + route bundles), was
  `googleapis`**, whose index loads all ~330 Google APIs, so YouTube, BigQuery
  and Android Publisher rode along for the four we use. Vercel keeps every
  deployment's functions, and the ship rule deployed commits TWICE (git push +
  `vercel deploy --prod`: 930a561 has two production deployments, 0fb6d27
  three). Now: the decks live in the private `proposals` bucket
  (`scripts/upload-proposals.mjs`; the repo copy stays the source and the tests
  still check it) and are downloaded at send time; `googleapis` →
  `@googleapis/{gmail,sheets,drive,calendar}` behind `src/lib/google/apis.ts`,
  which keeps the `google.*` shape — **never import `googleapis` again**;
  `vercel.json` skips a build whose changes since the last deploy are only
  docs/tests/android/outreach/migrations/proposals; and the ship rule stops
  double-deploying. **Heaviest function trace: 97.0 MB → 5.3 MB; everything
  traced across all routes: 75.5 → 11.3 MB.** ⚠️ Old deployments keep counting
  until they expire or are deleted — see §9.
  ② **PODIO SAID "NOT ON PODIO" FOR A PARTNER IT HAD JUST RETURNED.** Reported
  with screenshots: the national form's dropdown showed **Momo’s Burgers** for
  "Momo's Burgers", and Sodio answered "Not on Podio — you still need to submit
  it" while listing that very name under "Podio did return". Podio stores the
  curly ’, a keyboard types the straight ', and `podio.ts` compared them
  character for character — the one wrong answer that makes a member submit a
  duplicate. `podioNameKey` folds quotes, dashes, accents and zero-width
  characters before the exact comparison ("Gateway" still ≠ "Gateway Urban");
  `tests/podio-name.test.ts`. The CRM's OWN duplicate check was measured and
  does not share the bug: 19 account names carry typographic characters, 0
  collide once folded.
  ③ **"AIESEC in Bengaluru already has GV IR calls — that IS the working
  relationship, nothing to record."** v33.39 refused a partnership (and a
  target) on any LC already called for the programme. v35.1's road contradicts
  it — the calls are the scheduled/done STAGES and the WhatsApp group is the
  partnership — so an LC worked through calls could never reach its last stage.
  Removed from `recordLcPartnership`, `assignLcPartnership` and every button and
  programme option that stood down (`callProducts` is gone from the registry
  rows). Only a partnership already MADE on the programme still blocks one.

- **2026-09-05 · v36** — **THE LOGS GROW UP, THE LOGIN STOPS GUESSING, AND TWO
  FEATURES THAT HAD NEVER ONCE WORKED** (migrations **0072 + 0075 applied**;
  **0073 + 0074 written and NOT yet applied** — see the note at the end).
  ① **B2C COULD NEVER COMMENT ON A SIGN-UP. NOT ONCE.** v35.1 ④ shipped the
  code — `actions.ts` writes `author_class: "b2c"`, `types.ts` declares the
  third class, `signups-view.tsx` renders a third thread — and **the CHECK
  constraint was never widened.** `0025_ogx_signups.sql:68` is still the only
  place the column is constrained anywhere in the repo and it said
  `('member','vp')`, so every attempt since 2026-08-28 died on a raw Postgres
  error shown to the member in a red banner. Measured before fixing: 3,166
  'member' rows, 21 'vp', **ZERO 'b2c'**, against 70 B2C calls by 2 callers.
  0075 widens it. ⚠️ THE LESSON IS IN THE MIGRATION, because it will happen
  again: migrations here are applied BY HAND, so code and schema ship on two
  clocks, and a CHECK listing string literals is the sharpest form of that trap
  — the TS union and the SQL check are two copies of one list and only one is
  enforced at build time.
  ② **AND THE B2C CALLER WAS BEING HANDED SOMEBODY ELSE'S FORM.** Tapping
  Call/WhatsApp on a CIC row opened the contact prompt for everyone and saved
  through `updateSignupContact`, gated on `canWorkSignup` — the sign-up's
  OWNER. A B2C caller never is. Pressing "Log it" returned **"You are not
  allowed to work this sign-up."** The prompt now asks who is calling and
  offers the form that person can save: the OGX contact for the owner, the five
  B2C outcomes for the B2C caller, with the call-back time. ⚠️ It never writes
  the OGX funnel — that isolation is the v35.1 design. `my_open_b2c_call_id` is
  resolved SERVER-side beside `can_work`, and had to move once while being
  written: the obvious home was `withCaps`, which runs BEFORE `cic_calls` is
  attached, so a flag computed there is null on every row forever.
  ③ **THE ACTIVITY LOG BECAME A CONSOLE** (0072). The old page fetched the
  newest 80 rows and grepped them IN THE BROWSER, so on 14,890 rows it could
  not see past the last 80 — and said "Nothing matches" when the truth was that
  it had never looked. Everything filters, orders and pages in Postgres now: by
  person, action, entity, category, outcome, a Cairo date range and free text,
  with CSV export and the filters in the URL. Rows carry what they never did:
  **before → after** (`updateAccount` logged only the NAMES of changed fields),
  **who REALLY acted** (an action inside a test view is credited to the member
  being impersonated — it reads "by Ahmed · acting as Hana"), a **category**
  and an **outcome** (went through · refused · failed), and a human summary.
  `logAudit` keeps its exact signature — all ~123 call sites unchanged — and
  everything new arrives through an optional 6th `opts`. The shape ladder
  (v2 → v1 → legacy) re-probes every 2 minutes so a migration landing heals a
  warm server without a redeploy. **Auth events exist at last**: there was not
  one in 14,184 rows.
  ④ **THE LOGIN ASKS WHO YOU ARE, THEN SHOWS ONE DOOR.** Reported as "many
  wrong behaviours", and it was the page's fault: a Google button and a fully
  operable password form side by side, and the member left to guess. The guess
  is wrong for a quarter of the LC — **6 members have never had a password**
  (the box could only ever fail, and its placeholder told them they had one),
  **15 have no AIESEC address at all** and sign in with their phone in BOTH
  fields (said nowhere until after they failed), and a personal Gmail, a typo
  and a real member who had not signed in yet all got THE SAME SENTENCE. Now:
  one field, Continue, and only the door that works — greeted by name, so a
  wrong address is answered before a password is typed. The decision is
  `routeLogin` in `src/lib/login-routing.ts`, pure, shared with the server,
  pinned by 19 tests. ⚠️ The doors that must not close are tested as such: an
  emailed temporary password BEATS Google-first (`okTemp`), a phone-only member
  with only a temp password keeps the phone door, and "Forgot password?" is
  offered only when an inbox exists to send it to.
  ⑤ **A PLAN IS PRIVATE TO THE PERSON WHO FILED IT.** Every member of a team
  was served their Team Leader's plan — target and shortfall — on their own
  dashboard, daily. The client's `isOwnPlan` flag only changed the WORDING; the
  numbers were already in the payload. Gated server-side. ⚠️ The third leak was
  the assistant: `assistant.ts` printed `dash.teamPlan` into the Violet Man's
  context, so a member could just ask him. The FUNCTION's shared goal is
  untouched — v33.52 exists because members had no goal to see.
  ⑥ **A COORDINATOR IS AN MM WITH NO TEAM.** Verified: all 4 active
  Coordinators have zero direct reports and nobody is filed under one. Sodio
  already gave them no team treatment anywhere while still offering them in the
  Manager picker — so the one thing you COULD do was file somebody under a
  Coordinator and have them vanish from every team view. `MANAGER_ROLES` drops
  them and MOVED to `types.ts`, because the editor is a CLIENT component and a
  value from `google/sheets.ts` would drag googleapis into the browser bundle
  (the v34.6 API_FIELD_LABEL trap). One list, both sides.
  ⑦ **CONSIDERATION IS A JOB, NOT A RAISING CREW THAT DID NOTHING.** Eleven
  people (8 IGV, 3 IGT) appeared in every sprint and month report as raisers
  with 0 of everything, because `buildFunctionReport` picks its crew by
  `functions` alone. The report has TWO SECTIONS now; the consideration one
  carries calls done, upcoming, LCs reached and 🤝 partnerships, per person,
  from the calls themselves. The 8 who work BOTH appear in both, and the email
  says so. Attributed by member ID, never the name snapshot (the v35 CIC
  defect). ⚠️ They still RECEIVE the email — dropped from the waterfall, not
  from the function.
  ⑧ **NATIONAL RANKINGS PER APPROVALS, FROM CORE** — and they were **never
  wired**: `coreFor()` was written and never called, so the parser, the
  fixtures, the 21 tests and the rendering would all have shipped as dead code
  with no report carrying a rank. An unused local is a warning, not an error.
  `src/lib/core-rankings.ts` reads BOTH the homepage top-10 board and the full
  Egyptian table, so Alexandria's EXACT rank is available even when she is
  outside the top ten — which happens. One fetch per invocation feeds all ~20
  reports. Labelled term-to-date; an unreachable CORE prints a line saying so
  rather than vanishing.
  ⑨ **THE BLUE DOT.** `templates.ts:841` ended every period report with
  "Questions? Ask The Violet Man. 🔵" — the only 🔵 in src/, on an identity
  violet since v34. Also the assistant's own prompt still told him his panel
  had a "blue header".
  ⑩ **THE PODIO REMINDER GOES UP TO THE TEAM LEADER, NEVER A VP.** The rule
  from the floor, verbatim: *"if member it should be sent to the TL, and if for
  TL it should be sent to the TL himself only, no VPs on it"*. ⚠️ A member's
  manager is NOT always a Team Leader — `defaultManagerId` attaches anyone with
  a blank Manager cell to their VP — so the chain is walked and anything that
  is not a TL is DROPPED rather than promoted back into the VP inbox this
  change exists to empty. An unowned account raises nothing at all now.
  ⑪ **ALL OGX**, the lane ICX has had since v9 — one funnel over both sides,
  with a **Both sides** table inside it so the aggregate does not hide which
  side needs you. "OGX" means every side THIS VIEWER may see, never a
  hard-coded pair. Verified: 3,104 sign-ups = OGT 1,067 + OGV 2,037, and the
  sides add up to the total on all six metrics.
  ⑫ **THE HELP CENTRE** — 70 articles (65 before). The stale ones first,
  because a wrong article is worse than a missing one: **admin-toolkit still
  documented "Undo from the logs"**, deleted in v34.3 and wrong for two
  releases; signing-in and login-problems described a page that no longer
  exists; plans-are-the-goals implied you could see your team's plan. Five new:
  deleting an account and cancelling a deal, the cross-function open, the IM
  prompt composer, API keys, and IR slot requests. HELP_VERSION → v36.
  ⑬ **ALL OGX WAS SHOWING ICX**, reported from the floor as exactly that. The
  dashboard PAGE decided whether to FETCH `ogxDashboard`; the dashboard VIEW
  separately decided whether to RENDER it — two hand-written copies of
  `fn === "OGT" || fn === "OGV"` in different files, and the aggregate went
  into one of them. ⚠️ It fails SILENTLY (`isOgxLane && ogx`), so it falls
  through to the other module's numbers rather than blanking. There was a THIRD
  copy in the same file deciding whether to clear stale ICX member/team ids
  when crossing worlds — so All OGX kept an ICX member id and zeroed itself,
  the exact failure that line exists to prevent. One `isOgxLaneKey`, pinned by
  a ratchet that catches any hand-rolled comparison whatever the variable is
  called (the first version only caught the shape I happened to be looking at).
  ⑭ **THE O2O / PDP MODULE** (0074 applied): `/pdp`. Mine · My people · the LC.
  Last month's numbers are READ from `listMembersDirectory` — the same reader
  the TM directory uses — and FROZEN on filing, so the gap keeps matching the
  steps agreed against it; `funnelGap` returns null rather than inventing one,
  and the form says so. The member ticks their own weekly steps, and re-editing
  the wording carries the ticks across. ⚠️ "My people" is the viewer's own
  direct reports INCLUDING TM's — the first cut gave a process owner all **79**
  active members under that heading; filing for anyone else is the unsticking
  case and lives on the LC-wide list. No new cron (it rides
  attendance-reminders, so the deadline is a floor); the prompt is SKIPPABLE
  and has its own self-heal branch in `openPendingPrompt`.
  ⚠️ **STILL PENDING, deliberately**: migration **0073** (an unowned account
  carries NO function — the 229-row pool) is WRITTEN AND NOT APPLIED. The code
  handles a null function everywhere, but the pool's claim path and its UI are
  unfinished — applying it now would blank 229 accounts' functions before the
  screen that gives them one back exists. The CXP module still has no help
  article, and `/pdp` has not been clicked through in a browser (it needs a
  signed-in session).
  **721 tests** (618 before), tsc clean, production build green.

- **2026-08-28 · v35.1** — **SEVEN FROM THE FLOOR** (migrations **0070 +
  0071 applied**: B2C call outcomes, the partnership stage).
  ① **"GLOBAL VOLUNTEER" IS NOT A DIFFERENT PROGRAMME FROM "GV".** The badge
  matched abbreviations with `includes("gv")` — and **"global volunteer" does
  not contain the letters "gv"** — so the 31 REFERRAL rows, the only ones that
  store the programme's full name, fell through to the raw-value branch and
  rendered a wide red "Global Volunteer" pill in a column of tidy GV/GTa/GTe
  badges. Same programme, two different-looking rows on one list, which is
  exactly how it was reported. The long forms are matched explicitly now,
  `addSignupReferral` writes the tracker's own "GV", and the 31 rows were
  backfilled (they carry `source='referral'`, so nothing syncs to a sheet).
  ② **AN ACCOUNT CAN BE DELETED, NOT JUST ARCHIVED.** Archiving is a decision
  about a real business and it doubles as the blacklist — it stops the name
  ever being re-added. **A typo is not a decision**, and archiving one blocks
  the CORRECT spelling from ever being entered, which is why "just archive it"
  was never the answer. The rule (the user's call): an account with **nothing**
  on it — no contacts, visits, deals or comments — is deleted by anyone who may
  edit it, because there is nothing to destroy; the moment it carries history
  it takes a **VP/Director/LCP and the name typed out in full**. The dialog
  asks the server what is actually on the account first, so it says "nothing
  has been logged on it" or "this destroys 6 contacts and 2 deals" rather than
  a generic warning. The database cascades (contacts, visits, comments, deals →
  allocations), so it is one atomic statement; **contract blobs are removed by
  hand** because no foreign key reaches a storage bucket. Refused in the
  sandbox and during an LC test session — a cascade cannot be rolled back.
  ③ **AND A DEAL CAN BE CANCELLED.** It could be corrected since v33.19 and
  never taken back, so a deal recorded on the wrong account — or one that fell
  through after signing — sat in the funnel forever inflating the account, the
  lane and somebody's personal opens. ⚠️ **It DELETES the row rather than
  flagging it cancelled, deliberately**: deals are read in seventeen places
  (the account header, the pipeline stage, lane slots, allocations, the
  leaderboards, the period reports, the Drive mirror), and a `cancelled_at`
  that one of them forgot to filter is a number that is quietly wrong forever.
  A cancelled deal is not a deal. What survives is the part a human reads — a
  comment on the account naming the opens, the amount and the reason, plus the
  audit row. The counters recompute from what is left, so an account dropping
  to zero deals also drops back out of "Deal Done".
  ④ **B2C HAS A VOICE ON THE SIGN-UP.** B2C rings the same person to sell a
  course and had **nowhere to write down what was said** — `addSignupComment`
  refused them outright, because they are neither the owner nor a VP, so the
  selling context lived in WhatsApp while the row looked untouched. They
  comment in their own class (`author_class = 'b2c'`), shown as its own thread,
  from the detail dialog AND from the CIC list's ➕. ⚠️ **It never reaches the
  OGX tracker's Comment cells**: that log belongs to the OGX crew, and the
  sheet write-back only knows "member" and "vp" — the push is skipped anyway
  rather than relying on that.
  ⑤ **WHAT ACTUALLY HAPPENED ON A B2C CALL** (0070). "Called: Yes / No" was one
  question covering four situations with four different next moves: **Answered
  · Busy · Didn't answer · Out of service · Call back**. Busy and no-answer
  mean try again, out of service means the number is dead and trying again is
  wasted work, and a call back is an appointment the person themselves asked
  for. `contact_status` is now WRITTEN FROM the outcome (`answered` → Yes,
  everything else → No) so the B2C dashboard card, the called count and the
  open-calls count keep meaning what they meant and pre-0070 rows still read
  correctly. "Interested" is offered only when they picked up, and a stale one
  is cleared when the outcome says the call never happened. **A call-back asks
  for a time and nudges the caller when it falls due** — it rides the existing
  visit-followups pass rather than earning a cron (the invocation ceiling,
  v34.7), so the time is a FLOOR, not an alarm, and the stamp lands only after
  the nudge is out so a failure retries.
  ⑥ **THE ROAD TO A PARTNERSHIP** (0071). A target was one bit of information —
  it existed, then one day it was "done" — which told the member holding it
  nothing and the MM watching it less. It is a process, and the floor already
  describes it the same way: **contacted → answered → IR call scheduled → IR
  call done → WhatsApp group made**, and the last one IS the partnership.
  **Two of the five are facts Sodio already holds**: an IR call with that LC
  for that programme IS "scheduled", a completed one IS "done", so nobody types
  them. ⚠️ **`stage` stores only the HUMAN's half** — the call stages are
  derived at read time from `ir_calls` (in `listPartnerLcDetails`, where the
  calls are already in hand: no extra query, and no way for the card and the
  queue to disagree) and the card shows **whichever is further along**. That is
  what makes automatic movement forward only: a cancelled call can never drag a
  partnership backwards, and a human can always push ahead of the calls. Said
  plainly, because it is the trade: a manual stage BELOW what the calls prove
  does not stick. Setting the last stage is refused here on purpose — the group
  being made goes through `recordLcPartnership`, where the crediting, the
  anchoring IR and the refusals already live. 16 tests pin the merge.
  ⑦ **AN MM'S REACH IS THEIR FUNCTION, AND A MEMBER CAN TARGET THEMSELVES.**
  Handing out a partnership target was limited to the MM's own TEAM, which is
  not how the consideration floor works — an LC is approached by whoever is
  free, and an IGV MM watching an IGV target could not hand it to an IGV member
  on somebody else's team. An MM now reaches every consideration member working
  **their own ICX function**; `partnershipCrossTeam` keeps its meaning by moving
  up a level (with it on, the whole crew, both functions). And a **Member may
  take a target themselves** — setting your own and walking the road to it is
  the point of the process, and needing an MM to file it first was friction
  with no safety in it. A Member reaches exactly themselves: acting on somebody
  else's target (handing out, clearing, moving) is a separate capability
  (`canTargetOthers`), so the buttons offer exactly what the server allows.
  ⑧ **CASE SENSITIVITY: CHECKED, AND THE ACCOUNT CHECK IS ALREADY CORRECT.**
  Reported as "Sodio's own duplicate check is case-sensitive". Verified against
  production before changing anything: `normalized_name` is a generated,
  lower-cased column (**4,501 accounts, zero mismatches**; the blacklist's 39
  rows likewise), the lookup is an ILIKE on top of it, and a mixed-case name
  finds the row. So "Gamal" and "gamal" are already one name. **6 new
  assertions pin it as a ratchet** rather than a fix, and the Podio check keeps
  its own matching — it asks a third party about THEIR data. ⚠️ The screen where
  this was seen is still unknown; if a case variant really got through
  somewhere, that path needs finding rather than assuming.
  **618 tests** (602 before), tsc clean, production build green.

- **2026-08-27 · v35** — **THE BELL REACHES THE PHONE, AND SODIO GETS AN APP**
  (migration **0069 applied**: `push_subscriptions`).
  ① **THE BELL ONLY EVER RANG INSIDE AN OPEN TAB.** Sodio has had in-app
  notifications since v8 and no way to reach anybody who wasn't looking at it —
  which is *why* everything urgent had to travel by email, and email volume is
  the thing the floor complains about. Web Push closes that: a member turns it
  on at **Profile → ⚙ Settings → "Notifications on this phone or laptop"** and
  everything Sodio already puts on the bell arrives on the device. **Hooked
  into `notifyMembers` and nowhere else** — one line, at the single choke point
  every notification in the system already passes through — so there is no
  second list of "things that also push" to fall out of step, and a feature
  written next year gets phone delivery by writing a bell notification exactly
  as it does today. It is per **DEVICE**, not per member (phone and laptop are
  separate rows keyed by the push endpoint), off until switched on, and the row
  carries a **Test it** button, because "did that work?" is otherwise
  unanswerable until something real happens. Delivery is best-effort and runs
  in `after()`: the bell is the record, the push is a courtesy, and a push
  service having a bad minute must never fail the action that raised it. A
  404/410 back from an endpoint **deletes** the row rather than retrying it
  forever — the only way the count of reachable devices stays honest.
  **The one opt-out that already existed carries over for free**: the
  highest-volume message in the system — the crew-wide "a visit was booked"
  FYI, 521 in a week — is filtered by `bellVisitAnnouncements` BEFORE
  `notifyMembers` is called, so a member who switched that bell off does not
  get it on their phone either. That is a property of hooking at the choke
  point rather than at each call site.
  ⚠️ **No per-member kind-by-kind controls and no quiet hours** — deliberately
  not built, not forgotten. The switch is all-or-nothing per device today; if
  an overnight cron starts waking people, quiet hours is the next thing to
  build, and the v34.8 rule applies to it (a dead toggle is worse than no
  toggle).
  ② **THE ADMIN CONSOLE FOR SENDING ONE IS THE ONE THAT ALREADY EXISTED.**
  "Send a message" on the bell (v8) composes to everyone / a function / a role
  / hand-picked people and calls `notifyMembers` — so it reached phones the
  moment ① landed, with no second composer to drift from it. Its description
  now says so. The /admin health card gained the other half of "managing"
  them: configured or not, **how many devices, and how many of the LC those
  devices actually belong to** — because a green tick over a channel nobody
  has turned on tells you nothing.
  ③ **THE ANDROID APP IS A TWA, WHICH IS THE WHOLE POINT.** `app.sodio.crm` on
  Play is a Trusted Web Activity around sodio.vercel.app: not a copy of Sodio,
  not a webview wrapper — Sodio, full-screen, in an app icon. **Every deploy
  reaches every phone the moment it lands**, with no store review between a fix
  and the floor, no second UI to keep in step, and no version that can be
  behind; only a change to the SHELL (name, icon, splash, colours) is ever
  re-uploaded. Its notifications are ①'s, delegated to the app's own tray
  (`enableNotifications: true`), so there is no FCM key and no second sender.
  Generated from `android/twa-manifest.json`; the project itself is gitignored
  build output. Runbook: `android/README.md`.
  ④ **THREE THINGS THAT WOULD HAVE BROKEN IT SILENTLY, AND ONE THAT ALREADY
  HAD.** A service worker is fetched by the BROWSER, not by a signed-in
  navigation, so `src/proxy.ts` would have 307'd `/sw.js` to `/login` and
  registration would have died on the MIME type — push simply never working,
  with nothing saying why. `.well-known` was already exempt; `/privacy` had to
  be added too. And **`public/.well-known/assetlinks.json` has been in the repo
  since the FIRST COMMIT carrying the literal string
  `REPLACE_WITH_PLAY_CONSOLE_SIGNING_CERT_SHA256_WHEN_PUBLISHING` and the
  package `net.aiesec.alexandria.crm`** — a file whose entire job is to remove
  the app's address bar, which could never have done it, and which silently
  shadowed the new route because a static file in `public/` wins. Deleted. The
  route reads `ANDROID_CERT_FINGERPRINTS` instead, and returns an empty array
  when unset — "this site vouches for no app", which is true, rather than a
  broken claim. ⚠️ **The fingerprint that matters is PLAY APP SIGNING's, not
  the local upload key's**, and it does not exist until the first bundle has
  been uploaded. That ordering is the single most common cause of "the app
  looks like a website".
  ⑤ **A PRIVACY POLICY, BECAUSE PLAY WILL NOT LIST WITHOUT ONE** — `/privacy`,
  public (a policy behind a sign-in wall is not one anybody can read before
  deciding to sign in), written from what the system actually does: the tables
  it holds, the Google scopes it asks for, the three processors it runs on.
  ⚠️ It is a statement the LC is making, not boilerplate — **read it before
  submitting the listing**, and update it in the same commit as anything that
  changes what Sodio collects.
  ⑥ **⚠️ PRODUCTION IS 14 DAYS AWAY, NOT TODAY.** The Play account is a
  **personal** one, so Google requires closed testing with **12 opted-in
  testers for 14 continuous days** before it unlocks production, and the clock
  does not start until the twelfth tester opts in. **Internal testing** (up to
  100 testers, live in minutes) has none of that and is a legitimate end state
  for a private LC tool. Both paths are written out in `android/README.md`.
  ⑦ **THE CIC QUEUE FILTERS BY THE FIRST CALLER.** The queue always showed the
  first assignee — that column *is* the first caller — but the only way to
  narrow by them was the name-string funnel every other view uses, and a stored
  name is a snapshot: production holds **"Ahmed kadry" and "Ahmed Kadry", 7
  rows each, one person, one member id**, so the funnel offered him twice and
  either pick dropped half his work. The CIC view's column now reads
  **1st caller** (the counterpart of "2nd caller" two columns over) and filters
  by **member id**, labelled with the member's name TODAY — one option per
  human however many ways the tracker typed them. Its options come from the CIC
  pool itself, through `cicPoolFilter`, the predicate the queue is built from
  and now shares, so the funnel can never offer somebody with nothing in the
  queue. It spans BOTH OGX sides when no side chip is pressed, which is the
  B2C crew's default view and would otherwise have hidden half the callers.
  Offered only to whoever sees the whole queue; below an MM the CIC tab is just
  the calls handed to you. A chip above the cards on a phone — the v33.50
  lesson, a header funnel is unreachable where there is no header.
  **24 new tests** (`push-and-twa.test.ts`, `cic-first-caller.test.ts`) pinning
  the failures that are invisible from the inside: the proxy exemptions, the
  push hook, the no-caching rule in the worker, the TWA manifest agreeing with
  what the site serves, and the 1st-caller filter matching an id rather than a
  name. **602 tests**, tsc clean, production build green.

- **2026-08-27 · v34.10** — **ONE LOGO ON EVERY EMAIL, A SIGNATURE THAT NAMES
  EVERY JOB, A PROPOSAL YOU CAN READ WITHOUT LEAVING, AND THE OPEN THAT
  BELONGS TO THE OTHER FUNCTION** (no migration).
  ① **EVERY EMAIL WEARS THE LC'S MARK, AND SODIO TAKES THE FOOTER.** Since
  v29 there were two headers: the Sodio lockup on internal mail, the AIESEC in
  Alexandria logo on external. That made the same LC look like two
  organisations depending on who was being written to, and it put a tool's
  name where the entity's belongs. `emailHeader()` no longer takes an
  `external` flag — **`alex-white.png` heads every email**, on a navy→purple
  gradient with a purple band under it, and the credit moved to the bottom as
  `sodioCredit()`: **"Powered by Sodio"**, and under it in smaller type
  **"Made by 2.0"** (the mark, linked to elevate2point0.com). It replaces
  `madeBy20()`, which only rode outbound mail; the credit is now on all of it,
  which is what makes it a credit rather than an ad shown to strangers only.
  `crmLink` is false on anything leaving the LC — out there "Sodio" is a name,
  never a door into an internal system. The frame colour followed: a new
  exported `BRAND` object in `templates.ts` holds the palette, and
  `compose.ts` (all four member layouts) + `proposal.ts` re-tinted from AIESEC
  blue to **Sodio purple `#7552CC`**, keeping blue only for links that point
  at AIESEC's own sites and leaving the GV/GTa/GTe product colours frozen.
  The proposal's header logo also swapped from the generic AIESEC wordmark to
  the LC lockup — and its height went 34px → 56px, because `alex-blue.png` is
  716×408 against the wordmark's 1265×259 and at 34px it rendered as an
  unreadable smudge. Checked by rendering all ten samples through
  `scripts/preview-emails.ts` and looking at them.
  ② **THE SIGNATURE READ `functions[0]` AND STOPPED.** Anyone holding two
  functions signed off as one of them — the Director of IM *and* of CXP ICX
  signed every letter as IM alone. `signatureTitle` now maps the WHOLE list
  ("Director of Information Management & Customer Experience (ICX)"), and CXP
  carries its side because ICX and OGX are genuinely different jobs. The side
  comes from the CXP module's own `cxpSides(viewer)` resolver, NOT from a raw
  `sub_functions` string — "ICX" in that column is also Sodio's legacy
  catch-all for raising, and guessing would have mislabelled raisers. The role
  stays singular (a member row holds one `role`), so two functions read as one
  title joined with "&".
  ③ **THE PROPOSAL'S DRAFT OPTION BECAME A PREVIEW.** "Leave it in my Gmail
  drafts" existed so a member could re-read the letter before it went — but it
  did that by sending them OUT of Sodio, and the proposal usually stayed in
  the drafts folder unsent. It is gone. `createProposalDraft` →
  **`sendProposalEmail`** (always sends), plus **`previewProposalEmail`**,
  and both are built by one new private `buildProposal()` so the preview
  cannot drift from what is sent. The popup renders it in an `iframe srcDoc`
  with `sandbox=""` — the same pattern `/emails` has used since v33.25 — with
  **Send** underneath the preview and no redirect anywhere. `ProposalInput`
  lost `sendNow` and `attachmentsNote` (the "remember to attach your files"
  reminder line only ever existed on the draft path), and `proposalDraft()`
  is now honestly named `proposalEmail()`.
  ④ **THE CROSS-FUNCTION OPEN (IGV ↔ IGT).** From the floor: an IGT member
  approached an enabler as IGT, was refused, offered IGV instead and was
  accepted — so an **IGV** open got signed, by an IGT member, on an account
  labelled IGT. The CRM had no way to say that: `recordDeal` zeroed `igv` on
  an IGT account, and only someone who works BOTH functions could relabel the
  account. Now `recordDeal` takes **`raisedFor`**, the Record-deal popup asks
  **"These opens were raised for"** first on any IGV/IGT account, and picking
  the sibling does three things at once — the opens are recorded as that
  programme's (they already fed its lane: `laneWorkSlots`/`laneAllocSlots`
  attribute by PRODUCT, not by the account's function), **the account moves to
  that function** through the existing `fnSpecificReset` path, and a comment
  saying so is written onto the account so both VPs can read it. The rule is
  *follows the latest open*, chosen deliberately over "becomes B2B". **The
  raiser keeps the account and the opens** — `canEditAccount` is by
  `responsible_id`, so nothing is taken. `accountFnTargets` gained the ICX
  sibling so the same move can happen BEFORE the deal from Details → Function,
  and — the part that needed care — it is gated on *working either ICX
  function*, not on working the account's current one, so a move to IGV can be
  moved back. `allowedAccountFunctions` was deliberately NOT widened: an IGT
  member still cannot CREATE an IGV account, only move one they already own.
  The opens-split picker on an ICX account now offers both crews (the account
  page loads both), and `DealEditDialog` shows a product field whenever the
  deal already carries opens of it, so an IGT deal stays editable after its
  account crossed. IGV/IGT share one name-uniqueness world ("ICX"), so the
  move needs no re-check. 17 new tests in `tests/cross-function-opens.test.ts`.
  ⑤ **"VIOLET MAN" ON THE COMPOSER IS NOW "✨ WRITE WITH AI".** The button
  named the assistant instead of saying what it does, so nobody who hadn't
  already met him knew it was the button that writes the email.

- **2026-08-24 · v34.9** — **THE LINK PREVIEW GETS THE CREDIT, THE ADMIN CAN
  SEE THE PROMPT FIRST, AND A GITHUB OUTAGE GOT CHASED DOWN TO ITS SOURCE**
  (no migration).
  ① **"MADE BY 2.0" IS ON THE LINK-PREVIEW CARD.** `og-card.png` — the image
  WhatsApp/iMessage/Slack render when a `sodio.vercel.app` or `/book/<slug>`
  link is pasted — is the first thing an IR abroad or a partner ever sees of
  Sodio, and it was the one external-facing surface the v34.8 credit pass
  missed (the emails got it; this is a static raster the same script has
  generated since v31, not an email). `scripts/gen-brand-assets.mjs` now
  embeds `2.0-dark.png` (the light-ink variant, for the card's navy) as a data
  URI inside the SVG it rasterizes — there is no vector source for the mark,
  so this is the same trick `og-card.png` already used for nothing until now.
  Regenerated and diffed: **only `og-card.png` changed**, byte-identical
  otherwise to the five other rasters the script writes (icons, apple-icon,
  the email lockup) — confirmed with `git diff --stat`.
  ② **THE ADMIN CAN PREVIEW A PROMPT BEFORE IT REACHES 80 PEOPLE.** "Say
  something to the LC" (v34.7) composed a blocking dialog blind — no way to
  see the title/body/response-control combination as a member would meet it
  until it had already gone out. A **Preview** button next to Send opens
  `ImPromptPreviewDialog`, which renders the *exact* thing `PendingPrompt`
  renders for an `im_prompt` row — same fallback copy for an empty body, same
  button labels, and the identical **`Stars` widget, exported from
  `pending-prompt.tsx` and imported rather than re-implemented**, so the
  rating control cannot silently drift between "what admin saw" and "what the
  LC gets." The response-label default ("How would you rate this?" / "Your
  answer") moved out of `server/prompts.ts` into a new pure `lib/im-prompt.ts`
  that BOTH the server action and the preview import — one function, not two
  copies that could disagree. **The preview never touches the server**: Skip
  and Send are inert (a toast says what the real button would do, then
  closes) — a real click would need to answer a `pending_prompts` row that
  was never filed, so faking that would either impersonate the admin's own
  answer or silently do nothing on a control that looks live either way.
  Verified in a browser end to end: typed a title, switched to "Ask for a 1–5
  rating," opened the preview, picked 3 stars on the real widget, clicked
  Skip, watched it close with the inert toast and nothing sent. 9 new tests
  pin that both files import the shared function (not private copies) and
  that the preview carries no import of the real `answerImPrompt` /
  `skipPrompt` actions.
  ③ **THE "GITHUB AUTOMATION IS DOWN" REPORT WAS GITHUB'S OWN OUTAGE, ALREADY
  RESOLVED — NOT A BUG HERE.** The cancelled `Sheet imports` run at 13:37 UTC
  on 2026-08-24 sat with **zero executed steps for its whole ~15-minute
  lifetime** before being cancelled — it never got a runner. GitHub's status
  page confirms an official incident, **"Actions delays in starting runs,"
  investigated 13:56–14:34 UTC that same day** — squarely inside the window.
  `crons.yml`, a completely separate workflow with no shared concurrency
  group, ran anomalously long (9m36s vs its usual ~1min) in the same window,
  which is what you'd expect from a platform-wide runner-provisioning
  slowdown and not from anything in either workflow's own config. The system
  **self-healed exactly as designed**: `imports.yml`'s `concurrency: group:
  sheet-imports, cancel-in-progress: false` allows one running + one pending
  run per group, so once the queue backed up past that, the stuck pending run
  was cancelled in favour of the next tick rather than blocking forever; the
  very next run (14:25) succeeded, and both import scripts are idempotent
  with an unchanged-since check, so nothing was lost — the missed window
  just got picked up whole on the next successful tick. All runs since are
  green. No code was changed for this item because there was nothing here to
  fix.
  ⚠️ **Ship rule, made literal for this session going forward**: every
  finished change in this thread now goes straight through commit → merge to
  `main` → push → `vercel deploy --prod`, without pausing to ask first — the
  standing instruction this file has carried at the top since it was created.
  **393 tests** (384 before, 9 added), tsc clean, production build green, lint
  byte-identical to baseline.

- **2026-08-24 · v34.8** — **THE PROPOSAL SENDS ITSELF, THE IMPORT ASKS THE
  RIGHT QUESTIONS, AND EVERYONE GETS SETTINGS** (migration **0067 applied**:
  `members.settings`, `im_prompts.body` nullable).
  ① **THE B2B PROPOSAL EXISTS, AND THE EMAIL GOES OUT.** B2B accounts have
  defaulted to attaching NOTHING since v20 for the plain reason that no B2B
  deck existed. One does now (`proposals/B2B.pdf`), so the attachment set is
  DERIVED from the email being written — a B2B partnership email carries the
  B2B proposal, an iGV email the iGV deck — and any of the four can be ticked
  on top. BD keeps its empty default: its Talent-Solutions pitch has no deck.
  And the email **SENDS by default** rather than landing in drafts, from the
  member's own Gmail, so the reply comes back to them; drafting is one switch
  away for when they want to re-read it or add a file. ⚠️ The "remember to
  attach your files" reminder is written to the SENDER — on a send-now it
  would go to the company, so it exists only on the draft path, and the extra-
  attachments field hides itself when Send-now is on.
  ⚠️ **The deck arrived at 26 MB and could never have been emailed**: Gmail
  refuses over 25 MB and weighs the message AFTER base64 (+4/3), so 26 MB is
  35 MB on the wire. Its eight full-page 3780×2127 backgrounds were stored
  LOSSLESS at 300 DPI on a 907×510pt page; re-encoded to JPEG at 2000px it is
  **8.4 MB**, verified visually against the original side by side, text layer
  byte-identical. The remaining three decks are still 9–12 MB each, so all
  four together (39 MB) do NOT fit — `attachmentTooBig` says so in the popup
  with the running total, and the server refuses it, instead of letting Google
  reject a send the member can do nothing about. **The three older decks were
  deliberately NOT recompressed** — they are the LC's own documents and
  nobody asked; the same treatment would bring them to ~3 MB if wanted.
  ⚠️ `sendMemberEmail` had no attachment support at all — it and
  `createMemberDraft` were two copies of the same MIME assembly and only the
  draft one had ever learned about attachments, so "send it now" would
  silently have dropped the PDF. One `rawMessage` builder now serves both.
  ② **THE IMPORT ASKS FOR YOUR OWN COLUMNS.** The screen was written for IGV
  and IGT and then quietly reused by everyone: a **B2C member was shown a
  Product column they have no product for, an Industry column their accounts
  do not carry at all, and NO column for the one field a B2C account cannot
  exist without — its Type**. The header line under the upload box read
  "Function (IGV/IGT)" to a BD crew, and there was no worked example anywhere,
  which is why so many uploads came back rejected a row at a time. The columns
  are now ONE description in `lib/import-columns`, keyed by the functions the
  member may actually import into, and the screen, the header matcher, the row
  validator and a new **Download template** button (their columns + one filled
  example row) all read it — so a field cannot appear in the table but be
  missing from the template, or be demanded by the server and never asked for.
  A column that does not apply to a row's function is DROPPED rather than
  written, so an Industry cell can no longer land on a B2C account (which
  `createAccount` never cleared). Values resolve tolerantly ("courses" →
  Courses, "teacher" → GTe, "skill up" → Skill Up!) and the guide is CARDS on
  a phone, table from `sm` up — the v33.50 lesson. **Verified end to end in a
  browser**: a B2C import of a file carrying Industry and Product columns
  produced exactly Name · Type · Phone · Email · Website · Social · Comment ·
  Responsible, matched all three Type spellings, dropped the blank row, kept a
  quoted comma intact and flagged the bad email. 38 tests, including one that
  reads `createAccount` itself so the two cannot drift.
  ③ **⚙️ MY SETTINGS** (0067 `members.settings`, a jsonb blob — the per-PERSON
  twin of `function_settings`, and one blob for the same reason: a store that
  needs a migration per toggle is a store nobody adds toggles to). A
  **searchable** panel on the profile, searching descriptions as well as
  titles because people type the complaint, not the feature — "too many
  emails" finds the email toggles, and it folds Arabic hamza/alef like the
  Help centre. Four optional emails (the crew-wide visit heads-up, period
  reports, shout-outs, the streak nag) plus the bell half of the visit
  fan-out. **Every default is exactly the pre-0067 behaviour**, and a stored
  blob only overrides keys it really carries, so a member who never opens it
  cannot tell it exists. Rows for the phone, password, avatar and function
  defaults JUMP to the card that owns them and flash it rather than building a
  second editor to drift from the first.
  ⚠️ **THE RULE, and it is the v33.32 rule: a dead toggle is worse than no
  toggle.** Every switch is read on a real send path, pinned by a test that
  greps the send paths for each key. And **the must-do emails are listed as
  permanently on WITH the reason** — visit follow-ups, attendance, Podio
  digests, password resets, anything reaching an IR — rather than omitted: a
  settings page that hides what it cannot change teaches people it is
  incomplete.
  ⚠️ `resolveVisitRecipients` returned parallel `announceIds` and
  `announceEmails` that were **NOT index-aligned** (a member with no address
  is in the first and absent from the second). The opt-out wanted to zip them
  and would have mailed the wrong people; it returns one `{id, email}[]` now,
  so the alignment is structural. The audit row also stopped over-reporting —
  it logs who was actually belled and actually mailed.
  ④ **THE VIOLET MAN'S DATES, FIXED AT THE ROOT.** He answered "how many
  visits did I schedule this week" with numbers that were simply wrong, and
  the cause was not the prompt: **nothing in his context had a date in it.**
  The KPI block is all-time, the 150 account lines carry no dates, and there
  was no tool that could count over a window — so he had to invent a number,
  and did. Now: today and every resolved window are IN the context, the KPI
  block is labelled ALL-TIME in as many words, and a **`getNumbers` tool runs
  the REAL `getDashboard`** — the same function the dashboard page calls, the
  same per-KPI date rules, the same RBAC scope — so his answer and the screen
  cannot disagree. He passes a period by NAME; an unknown one is REFUSED
  rather than falling back to an unbounded window, which is the exact failure
  being removed. ⚠️ **The week starts on SATURDAY** (the LC's week since v12) —
  a Sunday-start "this week" would put Saturday's work in the wrong bucket.
  `lib/ask-period` is pure and has 24 tests over the edges that only happen
  twice a year: DST, leap days, January belonging to the peak that started
  last August, and last_sprint crossing a month boundary.
  ⑤ **THE ADMIN'S PROMPT NEEDS ONE FIELD, NOT THREE.** Title AND body AND a
  caption for the rating control, for what is usually one sentence ("Peak
  review is on Sunday"). The title is the message; the body is optional and
  the caption falls back per kind ("How would you rate this?" / "Your
  answer"). The prompt dialog stops apologising for an empty body on an IM
  prompt — that line belongs to the must-dos.
  ⑥ **PODIO'S TWO LABELS ARE TWO DOORS.** "Requested on Podio?" links to the
  national submission web-form; **"Podio state" links to the AMS workspace**
  (`PODIO_AMS_URL`) where the state is actually read off. They are different
  places and the card linked to neither.
  ⑦ **THE HEART IS PURPLE.** 41 blue hearts across 21 files — internal emails,
  the confetti on a recorded deal, the bell, the Help centre, the Violet Man's
  own greeting — are 💜. The internal email templates were ALREADY purple by
  colour (15 × `#7552CC` against one deliberate `#037EF3`, the blue→purple
  accent bar); the emoji was the visible leak, which is exactly what was
  reported.
  ⑧ **"MADE BY 2.0" RIDES THE EMAILS THAT LEAVE THE LC** — IR bookings and
  reschedules, both proposals, and the letters members write to enablers from
  the Emails tab. It deliberately does NOT ride internal mail: the sidebar
  already carries the credit on every page an LC member looks at, and
  repeating it in forty automated emails a day is noise, not attribution.
  Verified by rendering all ten sample emails: the six internal ones carry the
  Sodio lockup and no credit, the four external ones carry the LC's own logo
  and the credit.
  Help centre: **2 new articles** (⚙️ Settings, 📥 Import a list of accounts) +
  the proposal article rewritten; the Violet Man teaches all of it.
  **384 tests** (272 before), tsc clean, production build green, lint byte-identical to baseline.

- **2026-08-22 · v34.7** — **TWO PROMPTS AND A DATE FUNNEL** (migration
  **0066 applied**: `im_prompts`, `im_prompt_responses`).
  ① **THE IM DIRECTOR CAN SAY SOMETHING TO THE LC.** A card on `/admin`
  composes a prompt the floor meets the next time they open Sodio — a dialog,
  not an email nobody reads. Everything is the author's: who sees it (everyone
  / functions / roles / named people), what comes back (**nothing** ·
  **acknowledge** · a **1–5 rating** · **a sentence**, with your own question
  above the control), and whether it can be waved away at all. Responses land
  in `im_prompt_responses`, and a SKIP is recorded too — the director should
  see who never engaged, not a silent gap.
  ② **LC TOUCH POINTS ASK FOR THEIR RATING, 7 HOURS LATER.** Long enough that
  it is over and they have an opinion, close enough that they remember it. **LC
  scope only** — a team meeting is its own crew's business, and blocking
  seventy people over one is how a prompt becomes something people click past.
  The rating writes the SAME `lc_feedback` row the Feedback page writes, so
  there is one rating in one place.
  ③ **BOTH RIDE `pending_prompts` (0031), AND THE SKIP LADDER IS ITS
  `reminders` COLUMN** — no new table, no new mechanism. Skip once and it says
  the feedback matters and returns TOMORROW; skip a second time and it retires
  for good. Because the count lives on the row and not in localStorage, it
  survives a new device and a cleared browser. The prompt is filed by the cron
  and shown on next open, so somebody who never opens Sodio that evening still
  meets it rather than the window passing in silence.
  ④ **NO NEW CRON.** The pass runs inside the existing daily
  `touch-point-feedback` job, because Vercel is at its invocation ceiling. The
  7-hour mark is therefore a FLOOR, not an alarm: the prompt appears at the
  next run after it passes. The reader self-heals — a prompt whose parent was
  switched off, or whose session was cancelled, resolves itself instead of
  blocking the app forever (the v29.2 stranded-prompt lesson).
  ⑤ **DATE COLUMNS FILTER BY RANGE.** Every other column got its funnel in
  v33.3 — "if it is a column, you filter it from the column" — but the date
  columns were skipped, because a date is not a pick-list. `DateRangeFilter`
  opens a from → to pair instead: on the accounts list's **Date added**
  (clamped to today, since an account cannot be created in the future) and on
  the IR call log's **When** (deliberately NOT clamped — a call can be in the
  future). Both ends are optional: from alone reads "since", to alone "until".
  ⚠️ Verified against the live database: an `im_prompt` was filed for the
  admin's own account, walked through both rungs of the ladder (first skip →
  `reminders 1`, unresolved; second → resolved AND a skip row recorded), then
  deleted. The touch-point pass was NOT observed firing — no LC session has run
  in the last four days, so it correctly has nothing to file.

- **2026-08-22 · v34.6** — **THE API GETS A SCOPE, AND ITS OWN DOCS**
  (migration **0064b applied**: scope columns on `api_keys`).
  ① **A KEY IS ISSUED FOR SOMETHING SPECIFIC.** It names the **functions** it
  may read (IGV / IGT / B2B / BD / B2C), how much of each account it gets back
  — `names` (name + normalized, enough to dedupe and nothing else) ·
  `pipeline` (+ function, product, owner, dates) · `contacts` (+ phones,
  emails, links) — whether the archive and blacklist are included, an optional
  expiry and an hourly ceiling. **Scope is the KEY's, never the request's**:
  there is no query parameter that widens it, so a names-only MR bot cannot be
  talked into returning a lead list. Verified against the live database with
  two real keys: a names-only IGV key returned 831 records carrying exactly
  `name` and `normalized`, a contacts key returned 4,450 across four functions
  with the full shape.
  ② **AND IT DOESN'T COST VERCEL ANYTHING.** The plan is already past its CPU
  allowance, so: a **module-memory snapshot** shared by every key with a 5-min
  TTL (module memory, NOT `unstable_cache` — `revalidatePath("/", "layout")`
  runs on ~94 write paths and would evict it continuously, the v33.46 lesson);
  an **ETag**, so a well-behaved client gets a `304` with a zero-byte body
  (measured); and a per-key hourly limit through the same atomic bucket RPC the
  public booking page uses, failing OPEN so a broken counter can never take the
  API down.
  ③ **`GET /api/v1/docs` IS THE WHOLE THING IN ONE MARKDOWN FILE**, served as a
  download and written for the way people actually integrate — hand it to an AI
  and let it write the client. It states THAT key's own scope, so "why am I not
  getting phone numbers" answers itself.
  ④ **THE UNCHECKED-ON-PODIO DOT IS GONE.** It was the muted grey one and it
  fired on nearly every account, which is the definition of a signal that tells
  you nothing. The 🔎 Needs-Podio-checking filter is still the queue for that
  work.
  ⚠️ `API_FIELD_LABEL` lives in `src/lib/api-scope.ts`, not in
  `server/api-keys.ts`: the admin card is a client component and importing a
  VALUE from a `server-only` module fails the build (a type-only import is
  fine). That is the whole reason the file exists.

- **2026-08-22 · v34.5** — **"NONE OF THESE TIMES WORK"** (migration **0065
  applied**: `ir_slot_requests`).
  The public booking page could only ever offer what a host had already opened,
  so a consideration member with no availability left — or none that suited an
  IR eight zones away — was a dead end, and the LC lost the conversation to
  whatever that IR did next.
  ① **THE IR ASKS FOR A TIME THAT DOES NOT EXIST.** "None of these times work?"
  under the slot grid swaps it for a date and time **in their own zone**, and
  files a request. `requestIrSlot` validates exactly what the booking path
  validates — a public endpoint trusts nothing: the email's DOMAIN, a phone
  with a country code, a known IR role, the country against the real list, the
  sandbox guard and the per-IP throttle. It also refuses a time inside the next
  hour or past a few months, and a partial unique index means the same person
  asking twice for the same slot gets told so rather than filling a queue.
  ② **NOTHING IS BOOKED BY IT.** The host's calendar stays theirs: the request
  is a bell plus an email, and it appears at the top of their IR-calls tab.
  **Accepting** turns it into a real call through the same machinery as any
  other booking — the row, the calendar event on their own calendar (the IM
  mailbox when they have no live grant, the v33.19 tier-2 path), the Meet link
  and the identical confirmation the public page would have sent, manage token
  included. **Declining** emails the IR with whatever the host typed, word for
  word, and points them back at the times that ARE open. A lead sees the whole
  floor's asks so somebody who is away can still be answered for.
  ③ **THE LOCAL TIME IS CONVERTED TWO-PASS**, not with `new Date("…T…")` —
  that parses in the BROWSER's zone, which is the exact bug the zone picker
  exists to avoid for anyone on a VPN or a second clock. Verified by
  round-tripping seven zones including both European DST folds and Egypt's own
  spring-forward: every one reads back as the time that was typed.
  ⚠️ Deliberately NOT done: `bookIrCall` was left alone. It is a public,
  load-bearing endpoint and the accept path duplicates its tail rather than
  refactoring it mid-session — the two flows genuinely differ (one validates
  against offered slots, one is an explicit override by the host).

- **2026-08-22 · v34.3** — **THE MOBILE PASS, AND ONE FEATURE DELETED**
  (no migration).
  ① **THE HELP PAGE STILL LOOKED DEAD, AND THE SHIMMER WAS NEVER THE FIX.**
  v34.1 gave help-view its pending flag; the report came back unchanged. The
  reason is that there is NOTHING TO LOAD — every article is bundled into the
  page, so `router.replace` swaps the view in the same frame and a loading
  state has no time to appear. The actual bug was `scroll: false`: the content
  changed and THE PAGE DID NOT MOVE, so someone scrolled halfway down a list of
  categories tapped a topic and saw the same screen. `go()` now scrolls to the
  top for any view change (and deliberately not while typing in the search
  box). And `.nav-pending`, which was a 55% dim and nothing else, gained a thin
  brand-coloured bar across the top — the convention browsers already taught
  people to read.
  ② **`Card` SHIPS WITH `py-6 gap-6`**, so every compact KPI whose CardContent
  was `p-3` rendered as 48px of dead space wrapped around small text: big
  boxes, tiny characters, exactly how it looked on a phone. `py-0` hands the
  spacing back to the content, on the dashboard KPI cards, the attendance row
  and the calendar grid; labels went to 11px uppercase and the numbers up a
  size.
  ③ **THE PARTNER-LC NAMES WERE STACKING ONE CHARACTER PER LINE.** The name had
  `flex-1` beside six `shrink-0` badges and buttons, so a 375px card left it a
  sliver and `break-words` then snapped "AIESEC in ABC" vertically. It takes a
  full row below `sm` and shares the row from `sm` up.
  ④ **THE ROAD TO ACTIVATE WAS EMPTY DOWN ITS RIGHT SIDE ON A PHONE.** The road
  itself is `hidden sm:block`, and the two remaining blocks are both
  `shrink-0`, so with nothing between them they bunched at the left. One
  `justify-between`. The brief dialog also drops to `p-4` below `sm` — `p-6` on
  a 375px screen left it ~295px and it read as cut off.
  ⑤ **THE HOME SCREEN AND THE SIDEBAR SHOWED DIFFERENT MARKS.** The mobile top
  bar rendered at 24px, and the identity's own rule drops the purple node below
  32px — so the logo the LC sees most had no dot. The node now holds down to
  28px (it still reads there), the top bar renders at 32, and **the favicon
  carries the dot too**: one mark everywhere beat the sheet's small-size rule,
  checked at 16/24/32/48px before shipping.
  ⑥ **THE FEEDBACK FORM ASKED THE WRONG QUESTION FIRST.** Shout-out/Concern was
  the first control and then HID ITSELF the moment you picked "A touch point",
  because a session is rated, not praised or reported. "What is it about?" now
  comes first and the tone toggle follows only when a tone is the right
  question.
  ⑦ **THE AUDIT-LOG UNDO IS DELETED, NOT HIDDEN.** ⚠️ It could never undo
  anything. `logAudit` mints a `change_set` for the audit row and `recordUndo`
  mints its OWN for the same request, so the two never joined — measured
  against production before touching it: **0 of 11,130 audit rows had a single
  replayable journal row**, and it has been that way since v32. Repairing a
  rollback engine nobody has ever successfully run is how you corrupt data, so
  the button, the checkboxes, the bulk bar and `undoAuditEntries` are gone. The
  LOG stays — it is the record and it is accurate — and the **sandbox /
  LC-test-session rollback is untouched**: it keys on `session_id`, not
  `change_set`, and it works.

- **2026-08-22 · v34.1** — **SEVEN FROM THE FLOOR, AFTER THE IDENTITY SHIPPED**
  (no migration).
  ① **THE PRODUCT FILTER FILTERED THE WRONG FIELD.** That column renders
  `productBadge(function, product)` — IGV · IGTa · IGTe · IGT · B2B · BD · B2C
  — but its funnel filtered `accounts.product`, which only ever holds GTa/GTe.
  A crew looking at IGV and BD rows was offered "IGTa / IGTe", every pick
  matched nothing, and "All" showed everything: the control looked like it did
  nothing, which is exactly how it was reported. It now offers what the column
  SHOWS. That needed a new param — `?lane`, a csv OR'd server-side across
  (function, product) pairs — because `fn` is validated as a SINGLE value and a
  multi-pick would have been dropped whole, and because mixing a function pick
  with an IGT side on `fn`+`product` would silently AND to zero rows. Plain
  "IGT" stays on the list: most imported IGT accounts have no product set and
  would otherwise be unreachable from that column.
  ② **CLICKING A HELP TOPIC LOOKED DEAD.** `help-view` had
  `const [, startNav] = useTransition()` — it ran the navigation inside a
  transition and threw the pending flag away, so nothing rendered while the
  page fetched. Seven other views do this correctly. Fixed, and **pinned by
  `tests/nav-pending.test.ts`**, which fails if any component navigates while
  discarding the flag, or if any `*-view.tsx` navigates without rendering
  `nav-pending`. The one exception is listed with its reason
  (`account-detail-view` only navigates after a rename, from a dialog that has
  its own pending state). Verified the test FAILS on the old code before
  keeping it.
  ③ **A VISIT CANNOT BE BOOKED BETWEEN 3 AND 7 IN THE MORNING** — that is a
  slipped AM/PM, not a plan. Midnight–3 and 7–9 are legal but ask first. The
  rule is one tested pure module (`lib/visit-time`) read by the server and by
  every input that can book: the Schedule/Move dialog, the contact log's
  "Visit Scheduled" result, and the direct visit's "come back another time".
  Guarded at `scheduleVisit` (the single choke point all three route through)
  AND early in `logContact`, so a refused time cannot leave a phantom contact
  behind — the rule that file already had. ⚠️ Deliberately NOT applied to the
  direct visit's own "when did it happen": that records a visit that already
  took place and never goes through `scheduleVisit`.
  ④ **ONE PODIO EMAIL A DAY, NOT ONE PER ACCOUNT.** The cron sent one email
  PER ACCOUNT to the responsible AND every VP/Director of the function, so a
  member holding twenty due accounts got twenty emails on one morning and the
  leaders got everyone's. It is a digest now, to the person who can act: the
  owner. Accounts are grouped per recipient, split into "still pending" (the
  week-later nag) and "also due now", and an account is stamped only AFTER its
  digest actually sends, so a failed send retries tomorrow instead of going
  silent. ⚠️ An unassigned or deactivated-owner account still goes to the
  function's leaders — "owner only" would otherwise drop it out of the cycle
  entirely. The bell is grouped the same way. The per-account template is
  deleted rather than left dead.
  ⑤ **A SMALL DOT SAYS AN ACCOUNT NEEDS YOU.** Every signal already existed —
  an unreported visit whose day has passed, a Podio refresh come due, no next
  step, three unanswered attempts — but each lived in a different email, bell
  or filter you had to know to apply, so a row that needed work looked exactly
  like one that didn't. `lib/account-actions` is pure and tested, computed from
  data the list already carries (no extra query); amber is a nudge, violet is
  overdue, and the detail is one hover or tap away. On the table and both
  mobile card views. An archived account reports nothing — it is out of the
  game. The Podio-check signal skips UNOWNED accounts for the same reason the
  server's own `needs_podio` filter does: nobody is going to submit a name
  nobody has been given.
  ⑥ **AN EMAIL ADDRESS CAN NO LONGER BE SOMEBODY'S NAME.** The membership
  editor's `name` only required two characters, so an @aiesec.net address
  passed straight through and became that member's display name on every
  leaderboard and in the greeting of every email. `lib/member-fields` checks
  SHAPE — not identity, because this LC's names are Arabic, English,
  hyphenated and occasionally one word — and refuses an address, a phone
  number, a link, or anything with no letters, saying which field it belongs
  in. Wired into the schema AND into the sheet import's existing
  shifted-row guard, which already skips-and-logs a misaligned row: a name cell
  holding an address is the same class of mistake, and it is the one that shows.
  ⑦ **CONFIRMED, NOT CHANGED: OGT planning is OGTa + OGTe**, exactly like IGT
  is IGTa + IGTe. `PLAN_FUNCTIONS` carries all six, `planFnsFor` expands
  OGT → OGTa+OGTe, the sheet has a `🎯 oGTa`/`🎯 oGTe` tab each, and
  `ogxDashboard` sums the pair. Nothing to do.
  Also: the favicon was already correct on production — `icon.png` served
  there is byte-identical to the new mark, so an old logo in a tab is the
  browser's cache, not the deploy.

- **2026-08-21 · v34** — **SODIO GETS ITS OWN FACE** (no migration; a
  visual-identity pass — no RBAC, data-layer or gamification behaviour was
  touched). The identity was designed in Claude Design and delivered as
  `Sodio CRM visual identity.zip`; the logo SVGs it shipped now live in
  `public/brand/logo/` and are the source of truth for every raster.
  ① **THE PROBLEM.** The sidebar logo was literally AIESEC's stock wordmark
  image butted against plain "Sodio" text in a different face — two typefaces
  mashed together, no lockup, no mark of its own. The favicon and PWA icons
  were the LC's lighthouse. One font (Lato) carried headings, KPI numbers and
  body copy identically. The palette was AIESEC's `#037EF3` and `#0A2540` used
  directly. A well-built product wearing someone else's clothes.
  ② **"BLUE ANCHORS, PURPLE ACTS."** AIESEC blue `#037EF3` stays the anchor —
  brand, links, charts. **Sodio purple `#7552CC`** is the signature: it marks
  the thing you should TOUCH and the moment worth CELEBRATING. The rule that
  makes it work is a negative one — **purple never labels a product** — which
  is why it can sit on the same row as the frozen GV coral, GT cyan and GTe
  amber without ever fighting them. Neutrals stay AIESEC's (`#52565E` and one
  tint of it), so the identity is a SHIFT, not a repaint.
  ③ **THE MARK.** One geometric S, drawn as two arcs on a circle grid, with a
  single purple node at the tail — the point where a lead becomes a deal. It is
  ONE geometry with two homes: inline SVG in `SodioMark` and rasterised by
  `scripts/gen-brand-assets.mjs` into the favicon, the three PWA icons, the
  Apple icon, the OG card and the email lockup. **Change one and you must
  re-run the other.** The identity's scaling rules are implemented, not
  decorative: the stroke GROWS as the tile shrinks (10.5 at 64px, 13 at 32px,
  15 at 16px) and the **purple node drops below 32px**, where it turns to mud —
  so `SodioMark` takes the size it will actually render at. `icon.png` carries
  the favicon geometry (heavier stroke, no node) even at 512, because a browser
  tab is only ever seen at 16–32px.
  ④ **THREE FACES, EACH WITH A JOB.** Familjen Grotesk for voice, **Karla** for
  work, IBM Plex Mono for facts. Lato retires — Karla keeps the same warmth at
  tighter widths, which is what lets a nine-column accounts table stay readable
  on a laptop without dropping below 14px. **Column heads and table numerals
  are mono**, applied once in `@layer base` rather than in 70 table components
  so a new table cannot forget, and `.kpi-value` gets tabular figures so the
  count-up animation can no longer make a row jitter.
  ⑤ **THE CONTRAST WAS COMPUTED, NOT EYEBALLED**, and it found real defects.
  `--success` `#16a34a` is 3.02:1 on the page and the app renders
  `text-success` as TEXT, so light mode uses `#15803d`. Dark `--primary-foreground`
  had to become ink `#241c42` — white on `#a78bea` is 2.3:1. And the badges:
  the app's `bg-X/15 text-X` pattern renders text on a 15% tint of ITSELF,
  where raw AIESEC blue lands at **3.3:1** — so the pipeline got its own
  `--stage-*` tokens, deliberately deeper than the chart hues, every one
  clearing 4.5:1 on its own tint. **Two exceptions are the identity's own
  choices and were left alone**: the purple active pill on the navy sidebar
  (2.84:1 as a shape, but its white 700 label is 5.48:1) and the `#dde5ee`
  border on the `#f5f5f5` page, which is what shipped before.
  ⑥ **PURPLE STOPPED LABELLING STATUSES.** The stage badges had purple on
  *Contacted* and *Visit Done* — the action colour used as a status. Purple now
  appears exactly once on that scale, on **Deal Done**, because a deal is the
  win.
  ⑦ **THE MASCOT: RENAMED, RETINTED, AND NO LONGER CLIPPED.** The assistant is
  **The Violet Man** now (was The Blue Man) — 116 mentions across 31 files, the
  two component files renamed with them. ⚠️ The localStorage key stays
  `sodio-blueman-chats:` on purpose: renaming it would orphan every saved
  conversation on every member's device, the same call v32.1 made when the
  Elevate rename kept the `sodio-*` keys.
  On the artwork: `walk.png` is a 356×200 APNG whose figure occupies only the
  middle fifth of the canvas, so the chat header — which asked for a 28px
  IMAGE — drew a person about 19px tall and **6px wide**. New `WalkingMan`
  crops the canvas so `height` means the height of the PERSON.
  **AND THE BOUNDS HAD TO BE THE UNION ACROSS ALL 16 FRAMES.** The constants
  this file has carried since v33.57 (`top: 0.17`) were measured from ONE
  frame; measured per-frame with PIL, the figure actually spans y 31–167 while
  frame 0 spans 34–167, because he rises and falls through the stride. Cropping
  to one frame's box cut his HEAD on frames 5, 6, 13 and 14 and shaved the feet
  on rounding — exactly what the floor reported. `WALK_ART` is now that union
  plus a margin, exported from ONE place and imported by the Road to Activate
  walker, which had its own stale copy. Colour is an SVG `feColorMatrix`
  (exact, alpha-preserving so the walk cycle survives) rather than the old
  brightness/invert/hue-rotate chain, which had been solved for AIESEC blue.
  The identity's sheet tints him blue on light; **the LC asked for violet.**
  ⑧ **THE EMAILS ARE SPLIT BY WHO IS TALKING.** All ~40 templates funnel through
  one `shell`/`emailHeader`/`button`, so rebranding those carried the identity
  everywhere at once: the Sodio lockup on a navy→purple header, a blue→purple
  accent bar and a **purple primary button**. But an email to an IR abroad is
  AIESEC in Alexandria talking to a stranger who has never heard of Sodio, so
  `externalEmailLayout` keeps the LC's lighthouse — as do the member-written
  letters in `compose.ts` and the proposals. `scripts/preview-emails.ts`
  renders a representative set to HTML for review without sending anything.
  ⑨ **AND THE BRAND STOPPED BEING HARDCODED.** `--brand-blue`, `--brand-purple`
  and `--brand-glow` are new tokens, so the login aurora (one blue blob, one
  purple — the identity calls this the ONE place the two are allowed to bleed),
  the KPI hover glow, the card-hover shadow and the active-tab halo all read
  from one place instead of four copies of `rgb(3 126 243 / …)`.
  ⑨½ **THE THREE THINGS THE FLOOR CAUGHT AFTER THE FIRST PASS:**
  · **The loading boxes looked like an error.** `Skeleton` was `bg-accent`, and
  `--accent` is now the identity's PURPLE SURFACE — meant for accent chips, not
  for a page full of pulsing purple blocks. It is `bg-muted`, the neutral
  surface, which is what it always meant.
  · **The Road to Activate was a muddy seam.** Running AIESEC blue straight
  into Sodio purple down 800px of sky reads as two flat bands meeting, not as
  one surface. It is a NIGHT SKY now: the identity's navy as the base, with the
  two brand colours arriving as GLOWS at the ends of the journey — blue behind
  the start where the wordmark sits, purple behind the finish gate, because
  purple is the colour that marks the win. The travelled stretch of road and a
  passed month-post carry that same purple instead of the old yellow.
  · **The emails were violet with blue leaking through.** The internal shell had
  gone purple but the callout rules, the password box, the section headings and
  the "Open the CRM" link were still AIESEC blue, and two callouts were GT
  cyan. All violet now; the ONLY blue left in an internal email is the
  blue→purple accent bar under the header, which is the deliberate bleed.
  The **social/WhatsApp preview** was blue-dominant and is now violet-led, the
  same night treatment as the road.
  ⑩ **VERIFIED**: 244 tests pass, `tsc --noEmit` clean, production build green,
  lint unchanged from baseline. Checked in a real browser in light AND dark at
  1280px and 375px, plus the rendered emails.

- **2026-08-19 · v33.59** — **THE CORRECTIONS ON v33.58, AND THE HOSTING BILL
  MEASURED PROPERLY** (no migration).
  ① **THE AWARDS LINE SAYS LESS AND MEANS MORE.** v33.58's brief listed the
  aspects by name — "raising and partnerships, the OGX programmes, talent,
  marketing, the whole board" — which is a list that can be wrong, dates
  badly, and buries the only two facts a member needs: **every function has
  its own award**, and it doesn't stop at the functions (the LC as a whole, and
  others besides). Same point in a third of the words, and nothing in it can go
  stale. Same wording in the Help centre article, which had inherited the list.
  ② **THE TWO SELECTS ON THE REPORT FORM WERE LYING ON TOP OF EACH OTHER**
  (reported with a screenshot; v33.38 had already "fixed" this once). Two
  mechanisms, and the old fix addressed neither:
  **`sm:grid-cols-2` asks the VIEWPORT**, but this form also renders inside a
  512px dialog — so on a laptop two 223px tracks were handed a trigger whose
  label ("✨ Enhancement — make it better") needs 254px. And **a grid item's
  automatic minimum size is its own min-content width, which overrides
  `width: 100%`** — so `min-w-0` on the wrapper never reached the trigger and
  it grew to fit its text whatever the track said. Now: `@container` + `@md:`
  so the split follows the CONTAINER, `min-w-0` on the triggers themselves, and
  a SHORT label on the closed Type trigger (the descriptions are there to help
  someone CHOOSE, which happens in the open list). **Measured in a browser
  before and after**, at the dialog's real width: the old markup put a 254px
  trigger in a 223px track **overlapping the next one by 15px** — the
  screenshot, reproduced exactly — and the fix gives 223 + 223 with the 16px
  gap intact. At 375px it is one column, zero overflowing elements,
  `scrollWidth` 375; at the /feedback page's 672px card it is 303 + 303.
  ③ **The WhatsApp number is confirmed as 01099019374** (`ADMIN_WHATSAPP` =
  `201099019374`, one constant read by the report form and the profile's
  "wrong info?" link). Worth writing down because the request carried a
  13-digit variant — an Egyptian mobile is 10 digits after the country code,
  so a 13-digit `+20…` cannot dial. The verified number stands.
  ④ **THE VERCEL AUDIT, WITH THE REAL NUMBERS.** From the dashboard: **Fluid
  Active CPU 7h45m / 4h — the one resource actually EXCEEDED** (194%) ·
  Function Invocations 761K / 1M (76%) · Edge Requests 502K / 1M · everything
  else under 25% (Fast Origin Transfer 3.33/10 GB, Provisioned Memory
  76.5/360 GB-hrs, Edge CPU 1m57s/1h, ISR reads 23K/1M, image optimisation
  effectively unused). ⚠️ The usage API is **Pro-only** (`/v1/usage` returns
  `plan_upgrade_required`), and Hobby retains about an hour of runtime logs, so
  there is no per-route invocation series to read — the dashboard figures are
  the record, and the mechanisms below are established from the code and from
  what the retained logs do show.
  **THE CAUSE IS THE ONE v33.58 FOUND, AND THE COUNTER IS A LAGGING
  INDICATOR.** `<Link>` prefetching fired a dozen RSC requests per page view,
  each a full server render — which is why CPU and invocations moved together.
  That fix went live on 18 Aug (`v33.58.1`), so **17 of the 19 days in that
  761K accrued before it**. The retained logs agree: the distribution is now
  human-shaped (/accounts 32, /login 19, /consideration 9 in the window)
  rather than the flat one v33.58 measured, and source counts are middleware
  51 : function 72, where they were 234 : 232.
  **THREE READS EVERY PAGE VIEW PAID FOR, NOW GONE:**
  · **the function-settings map** — the most-read thing in the system (every
  request builds a Viewer, and it decides what a Member may see) sat in
  `unstable_cache`, which `refresh()` drops on **every write in the LC**
  (`revalidatePath("/", "layout")` is Next's documented "revalidate ALL data").
  With ~94 write paths and forty members working it was evicted continuously:
  the cache existed and never hit. Moved to module memory, out of
  `revalidatePath`'s reach — the same fix v33.46 applied to the dashboard, in a
  much hotter path. A failed read is never cached (it resolves to defaults, and
  holding that for a minute would close every opened function to its members
  over one blip);
  · **the Google-grant check** — "one cheap read" is true of one read and false
  of one read on every page view of every member for a month, and it asked for
  a column the Viewer already carries (`getViewerByEmail` selects `*` from the
  same row in the same request). Same value, no round trip;
  · **the two plan-count queries** — the layout asks `needsMmPlan` AND
  `needsTlPlan` before rendering any page, so every MM paid two counts per page
  view to be told what they were told yesterday. Only the "has filed" answer is
  remembered, never "still needs to", so the day-one redirect is untouched and
  cannot be skipped by a stale cache; a 30-minute TTL keeps it honest for
  `pruneStalePlans`, which can delete plan rows.
  **AND THE FIX IS PINNED**: `tests/link-prefetch.test.ts` fails if any
  `<Link>` loses `prefetch={false}` — 30 one-word props across 20 files is
  exactly the kind of thing that comes back one careless link at a time. It
  strips comments before scanning (app-shell's own note about prefetching
  contains the words `<Link>`) and reads whole opening tags, because the prop
  usually sits three lines below the `<Link`, where a line-by-line grep misses
  it — my first version of this check produced a false positive for that reason.
  **MEASURED AND DISMISSED**, so nobody re-hunts them: the crons (only **6
  daily** jobs still on Vercel — the imports and visit reminders are on GitHub
  Actions since v33.46; confirmed against `cron.job`) · client polling (none —
  `AutoRefresh` is focus-driven with a 10-minute floor, and every `setInterval`
  in the app is a local clock tick) · uploaded avatars in the Viewer's
  `select("*")` (5 members, largest 33KB, 124KB in total) · the help centre's
  237KB of articles (already a client-bundle import, never in the RSC payload).
  **WHAT CANNOT BE MOVED, said plainly**: the unused allowances are unused
  because **nothing here is cacheable at the CDN** — every page is per-member
  and auth-gated, so ISR reads and image optimisation have nothing to absorb.
  ⚠️ **And the arithmetic is worth facing**: 4 CPU-hours a month is ~14,400
  CPU-seconds; seventy people each opening a few dozen dynamic, database-backed
  pages a day will spend that whether or not a single line is wasteful. The
  cuts above are real and they buy headroom — the next lever, deliberately NOT
  pulled here, is the **111 client `router.refresh()` calls that follow server
  actions which already called `revalidatePath`**: each one is a second full
  render of the same page. Removing them is a ~111-site change that trades a
  metered bill for staleness bugs on the floor, and it wants its own release
  with its own verification, not the tail of this one.

- **2026-08-18 · v33.58** — **ACTIVATE OPENS, A CALL CHANGES HANDS, AND THE
  HOSTING BILL GETS ITS ROOT CAUSE** (no migration).
  ① **THE BANNER ANSWERS THE QUESTION IT WAS ASKING.** The Road to Activate
  has counted down since v33.52 to a conference half the floor has never been
  to — for them "3 December" was a date on a blue bar, which is the opposite
  of the point. The whole strip is a button now, and it opens the brief:
  Activate is **AIESEC in Egypt's national conference**, every LC sends
  delegates, and it closes with the awards — handed out **per aspect**, so
  raising, the OGX programmes and talent each have their own and nobody is a
  spectator in somebody else's. And the honest line between that and the work:
  the awards go to what an LC actually DELIVERED over the peak, which is
  exactly what this system counts every day. It links the conference's own
  Instagram (@__activate25 · @activate__24 · @22_activate) and the shared
  Drive folder, because a member should be able to look rather than be told.
  ② **AND HE WALKS BY DAYS, VISIBLY.** His x has always been the elapsed
  fraction — a genuine day-by-day advance that at ~5px a day nobody could
  see, which reads as a picture that never moves. So the road SAYS it:
  "day 18 of 124" beside the countdown, and the four arbitrary verge posts
  became the real **months** of the run-up (SEP · OCT · NOV), derived from the
  two dates and lighting up as they are passed. Walking past SEP is a step you
  notice; walking past 0.4 is not.
  ③ **🤝 AN IR CALL CAN BE HANDED TO SOMEBODY ELSE** (MMs and above). A call
  the host can't make had two exits and both cost the LC something: cancel it
  on the IR, or ask a partner entity abroad to redo their booking because of
  our rota. The third exit is usually the right one — **same time, new host**.
  `reassignIrCall` moves all of it, not just the row: the owner (so it counts
  for the new host on every board), a fresh calendar event on THEIR calendar
  — or the IM mailbox when they have no Google grant, the v33.19 tier-2 path —
  with the IR invited, then the old event withdrawn (new first, delete second:
  the other order leaves the IR holding nothing if the rebuild fails). The IR
  is emailed in **their own clock** with the new Meet link, their manage token
  unchanged — so rescheduling from it now reads the new host's availability,
  which is right. Both members get a bell and a mail: one gains a commitment,
  the other is released from one. **What deliberately does NOT move:** the
  GV/GT tag — that is the conversation's subject, snapshotted at booking
  (v33.23), and rewriting it would silently move history between two floors.
  Refusals that matter: a target who already has an overlapping call is named
  (real intervals, not just the exact-slot unique index), and an IR address
  already flagged as bounced is **not** written into — the caller is told the
  IR has not heard, the v33.48 rule.
  ④ **SIGN-UPS OPEN ON THE NEWEST HAND-OUT.** Every assigned view sorted by
  `signed_up_at` — the day the person filled the form, which for OGT is often
  months before anybody was given them (their newest tracker row is dated
  10 May). So a sign-up handed to you this morning landed wherever its form
  date put it, frequently pages deep: the one row you came for was the hardest
  to find. Mine · My team · All · Referrals now open on **`assigned_at`,
  newest first**; the pool and the CIC queue keep the sign-up date, because
  nothing in them has been assigned and the column would rank nothing. The
  Assigned column became sortable and the header arrow follows the effective
  sort, so it can't claim nothing is sorted while something plainly is.
  ⑤ **THE FIRST PASSWORD PROVES ITSELF.** Onboarding is the one moment a
  member invents a password — and they were then carried into the app on the
  Google session they arrived with, so the first time they were ever asked to
  type it was days later, cold. Setting it now **ends the session** and lands
  them on /login with a line saying why; they sign in with what they just
  chose. It is the standard confirm-by-use pattern: it cements the password,
  and it surfaces a wrong assumption in ten seconds rather than next week.
  (A password CHANGE from the profile deliberately doesn't do this — they just
  proved they knew the current one.)
  ⑥ **REPORTING A PROBLEM CAN BE A CONVERSATION.** The system-feedback form
  gained **"Or WhatsApp me directly"** beside Send feedback, carrying the page
  the reporter was on. The form stays the right door when it can wait and the
  detail matters — it keeps the type, the category and the screenshots, and it
  can't get lost in a chat. WhatsApp is for being blocked right now. The
  number lives in ONE place at last (`ADMIN_WHATSAPP` in types.ts); the
  profile's "wrong info?" link reads the same constant.
  ⑦ **THE VERCEL INVOCATIONS, ROOT-CAUSED AND MEASURED.** The project sat past
  75% of the Hobby function-invocation allowance, and the crons were not it —
  only six daily jobs are still scheduled (the v33.46 pg_cron twins are gone,
  and both GitHub Actions workflows run green). The cause was **`<Link>`
  prefetching**: Next prefetches every link that ENTERS THE VIEWPORT in
  production, and the sidebar puts a dozen on screen on every page. So one
  page view quietly fired a dozen RSC requests for routes nobody asked for.
  Two independent confirmations: the production logs group by path into a
  **flat distribution** — /planning, /lc-feedback and /emails each hit about
  as often as /dashboard, which is not how anybody uses this app — and they
  group by source into **middleware 234 : function 232**, i.e. every request
  costs a proxy invocation on top of itself. Then it was measured directly: a
  throwaway page in a REAL production build, 12 links with the default and 12
  with `prefetch={false}`, one load — **12 requests versus 0** (24 RSC
  requests in total, because each prefetch was redirected and followed).
  Fixed: `prefetch={false}` on **all 30** `<Link>`s in the app, and the two
  metadata routes (`icon.png`, `apple-icon.png`) excluded from the proxy
  matcher, which was waking an auth check to decide whether a stranger may see
  a favicon. **And it costs nothing in UX**: every route here is dynamic and
  auth-gated, so "auto" prefetch only ever fetched the shell down to the
  nearest `loading.tsx` — a skeleton the member sees on click regardless. We
  were paying a full server round-trip per link to pre-render a spinner.
  ⚠️ The exact usage numbers could not be read programmatically — Vercel's
  `/v1/usage` API is Pro-only — so the percentages on the dashboard are the
  user's to watch; what is measured here is the mechanism and its size.

- **2026-08-17 · v33.57** — **THE ROAD IS A ROAD, AND HE IS ON IT** (no
  migration). Reported as "he walks BESIDE the road and the road is a wall" —
  both true, and both had a real cause.
  ① **THE WALL.** v33.55 drew one-point perspective: a wedge narrowing to a
  vanishing point. In a banner nine times wider than it is tall that reads as
  a surface seen edge-on — a wall — not one you look along. A **side view** is
  the honest projection for a long, low band: tarmac across the whole width,
  a dashed centre line, kerbs, verge posts that light up as they are passed,
  and a chequered finish gate standing ON the road at the end.
  ② **WHY HE FLOATED, AND IT WAS THE ASSET.** `walk.png` is a 356×200 APNG
  whose figure occupies only the **middle fifth** of the canvas — x 39.3%–
  59.6%, y 17.0%–83.5% — the rest being transparent room for the walk cycle.
  Placing the IMAGE put that canvas where the person should be, so he sat high
  and left of his own feet with the empty half of the frame overlapping the
  road. The bounding box was measured out of the file's alpha channel and is
  now three named constants; a `walker(cx, feetY, figH)` helper converts
  "figure this tall, feet here" into the canvas box, so every placement is in
  terms of the PERSON. Measured in the browser afterwards: tarmac 66→104,
  **his feet at 99** — on the road, five units clear of the near kerb, with
  his head rising above the far one exactly as a person standing on a road
  seen side-on should.
  ③ **AND IT FILLS THE BANNER.** With `meet`, a viewBox narrower in aspect
  than its box gets letterboxed — the blue gutters either side of the road.
  The height cap was what created that mismatch, so it is gone: the ratio
  (800:112) now IS the banner's height, ~98px under a 700px slot, which is
  enough road for the walker to have presence on.

- **2026-08-17 · v33.56** — **THE PLAN CARDS FOLLOW THE FILTER BAR** (no
  migration). Every "planned vs achieved" on the dashboard is **MONTHLY** —
  the period an LC actually steers by — and switches to the sprint **only
  while the "This sprint" chip is on**.
  ① **THE LANE CARD LOST ITS OWN TOGGLE.** `PlanCard` carried a private
  sprint/month switch three inches under a filter bar that has the same two
  chips, so the card could contradict the page it sits on. `LanePlan` now
  returns ONE window plus the `mode` it is in, and the card prints that mode
  as a label instead of offering a second opinion.
  ② **A VP SEES SPRINT CELLS; AN MM SEES HALF THEIR MONTH.** With the chip on,
  the function's numbers come from the planning sheet's own `scope='sprint'`
  cells — real filed targets. Nobody files a sprint plan at MM level, so a
  Team Leader's `tl_plans` month and an OGX MM's `mm_plans` month are HALVED
  (rounded up: a target you can't quite reach is worse than one you can just
  about beat), and both cards say out loud that it is half the month rather
  than presenting a derived number as a commitment.
  ③ **ACHIEVED FOLLOWS THE SAME WINDOW** — team opens are read over the
  sprint's own dates, and OGX's achieved counts the sign-ups worked in it.
  ④ **THE CHIP IS DETECTED ON THE RAW FILTER**, not the clamped one. The
  window is clamped to today (no work exists in the future), so mid-sprint the
  chip's own end date would never have matched itself — and the ICX lane
  silently stayed monthly while OGX switched. Verified in prod on 17 Aug:
  IGV goes 15 planned / 6 raised (August) → **8 / 2** (Sprint 2), OGV goes
  17·9·8 planned → **7·4·3**, both labelled "August · Sprint 2 (16–31)".

- **2026-08-17 · v33.55** — **THE CORRECTIONS ON v33.52–54** (no migration; two
  prod data operations).
  ① **THE OGT REPORT SAID ZERO, AND OF COURSE IT ISN'T.** v33.54's OGX report
  keyed its window on `signed_up_at` alone — the truth about the wrong
  question: OGT's tracker holds 2,079 people whose newest form is dated
  **10 May**, and the crew has been working that backlog all peak. The OGX
  DASHBOARD has used `assigned_at ?? signed_up_at` since v33.47 for exactly
  this reason. The report uses the same rule now and OGT's August reads
  **501 sign-ups · 354 contacted · 107 interested · 1 applied** — the numbers
  on the lane, to the row. OGV August: 1,289 · 646 · 159 · 31 · 19 · **13
  approved**. The KPI is named "Sign-ups **worked** in this period" so nobody
  reads it as arrivals.
  ② **AN IGV ACCOUNT MOVED TO B2B KEPT ITS PROJECT.** The app clears
  function-specific fields on every hand-over (`fnSpecificReset`); the v33.52
  hand-out SCRIPT wrote `responsible_id` + `function` straight to the table and
  bypassed it, so six accounts landed in B2B still carrying "Global Classroom"
  or "Skill Up!" — fields B2B does not have. The script now clears
  project/product/sub_product like the real path, and `--repair` found and
  cleared the six.
  ③ **"50 EACH, NOT 50 FOR ALL."** The first hand-out dealt 50 across the
  seven of them. `--each=50` tops each person up to fifty FROM THIS POOL —
  counted off the script's own audit rows, so their pre-existing accounts
  aren't counted against them and re-running can never double anybody.
  **300 more went out**: Akmal +42, everyone else +43. All 350 carry a phone,
  all are marked B2B, none carry a stray field, everyone got a bell and the
  three with an address got the list by mail.
  ④ **THE OGX GOAL IS A COMPARISON NOW** — planned **vs achieved**, per
  metric, with a bar: the function's planning-sheet numbers for the month
  against what it has actually done, and (for anyone who filed one) their OWN
  plan against their own sign-ups. Achieved counts the sign-ups worked this
  month, the same rule as ① so the card and the report can't disagree. A plan
  card that only printed the target was the complaint, and it was right.
  ⑤ **THE ATTENDANCE FUNNELS SAY THEY ARE WORKING.** The pending shimmer sat
  on the filter BAR while the funnels live in the table HEADER, so clicking
  "Member" looked like nothing happened. The whole view shimmers and the title
  carries a spinner.
  ⑥ **"24 registered" IS GONE** — that was every retired registry row. The
  card names what is actually set: `EB: IRIS · LB: شماريخ`.
  ⑦ **ONE STREAK CARD.** The dashboard carried a thinner copy — no "your
  best", no side chips, and the LC board as a single wrapped line of same-size
  names, which tells nobody who is first. Both places render
  `streak-card.tsx` now; on the dashboard the side chips switch the lane.
  ⑧ **THE ROAD IS A ROAD.** Two parallel lines became one inline SVG in
  perspective: tarmac narrowing to a vanishing point, a centre line whose
  dashes crowd towards the horizon, milestone posts that light up as they're
  passed, a chequered finish gate, and the Blue Man walking it — **smaller the
  further along he is**, which is what makes it read as distance rather than a
  progress bar with a picture on it. One coordinate space, so nothing floats.
  Width-driven, since fixing the height letterboxed a 6:1 drawing inside a
  12:1 banner.

- **2026-08-16 · v33.54** — **THE PERIOD REPORTS GROW UP, AND THE ROAD TO
  ACTIVATE BECOMES A ROAD** (no migration).
  ① **OGX HAD NO PERIOD REPORT AT ALL.** `buildFunctionReport` counts
  accounts, contacts, visits and opens — an OGX crew has none of those, so
  every sprint and month closed with IGV, IGT and B2B getting a report and the
  two biggest crews in the LC getting nothing. New **`buildOgxReport`**: same
  email, same shape (KPIs · team waterfall · filed MM plans), the sign-up
  funnel instead — Sign-ups → Contacted → Interested → Applied → Accepted →
  **Approved 🏆**. It says out loud what a window MEANS there: a sign-up
  carries one usable date (`signed_up_at`) and no status carries any, so the
  period is the sign-ups that ARRIVED in it and the funnel is where those
  people stand today. Anything else would be a guess dressed as a fact.
  ② **QUARTERS ARE GONE.** Nobody steers a peak in three-month jumps, and the
  quarterly mail landed on the same morning as the month's saying much the
  same thing. Sprint and month only.
  ③ **EVERY NUMBER CARRIES THE LAST ONE.** Each KPI prints a small line under
  it — "▲ 110 vs last sprint (35)", "same as last sprint" — from the identical
  read over the previous window of the same length. Sprint 1 compares against
  the previous month's sprint 2, sprint 2 against sprint 1, a month against
  the month before. A comparison that would reach back before the peak is
  dropped rather than invented (`previous: null`), and the recursion is one
  step deep by construction.
  ④ **THE WATERFALL'S TEAM ROWS FOLLOW v33.53** — "Hana Wael's team", not the
  retired sheet name.
  ⑤ **VERIFIED AGAINST PROD, not just typechecked.** Every one of the five
  reports was built for Aug sprint 1 with July's sprint 2 as the comparison:
  IGV 145 MR / 75 contacts / 26 visits / 14 done / 2 deals / 4 opens · IGT
  96 / 188 / 8 / 3 · B2B&BD 331 / 163 / 2 · OGV 24 sign-ups → 9 approved ·
  **OGT 0, which is real**: their tracker's most recent sign-up is 10 May, so
  an August window is genuinely empty. OGV's 24 matches the row count in the
  database exactly.
  ⚠️ **Known and deliberate:** the report attributes work by the PERSON (an
  account's responsible), while the dashboard attributes by the ACCOUNT's
  function. A dual-function member's work therefore appears in both of their
  crews' reports. That is the v21 design — "what did this crew do" — and it is
  written down here rather than silently changed.
  ⑥ **🏆 THE ACTIVATE STRIP IS A ROAD** (by request: road style, bigger, no
  close button). AIESEC-blue verges, asphalt with kerbs, a yellow centre line
  that travels, the Blue Man walking it at the LC's real position (the peak's
  first day is the start line, 3 December the finish), a chequered finish and
  the trophy. The dismiss button is gone — this is the LC's horizon, not a
  notification — and it still removes ITSELF the day after the conference.

- **2026-08-16 · v33.53** — **A TEAM IS ITS MANAGER** (no migration; one prod
  data cleanup). The LC deleted the **Teams tab** and the **Team Name column**
  from the Membership sheet — the structure is now Name · Email · Phone ·
  Role · Function · Sub Function · **Manager** · Active — and Sodio follows.
  ① **THE IMPORT WOULD HAVE PUT THE TAB BACK.** `importTeams` and
  `writeTeamsTab` called `ensureTab`, which CREATES a missing tab and seeds
  it, and the membership import runs every 30 minutes: the LC's own edit
  would have been undone within half an hour, twice an hour, forever. Both
  now use a new `findTab`, which never creates anything and returns null —
  the import becomes a no-op. Verified against the live sheet: `importTeams()`
  → 0, the tab list is still `Membership` alone, and the 81-row membership
  import read the 8-column layout perfectly (it has resolved columns BY
  HEADER NAME since v33.15, which is why deleting a column shifted nothing).
  ② **ONE RULE FOR EVERY TEAM LABEL** — `teamLabel(name)` = "<name>'s team",
  in types.ts. It replaces four private copies of "look up a registered team
  name in the member's comma-list, else fall back": `teamLabelOf` (the
  dashboard MM drill), `ownTeamName` (touch points), `listTeamFilterOptions`
  (the dashboard team filter) and the OGX team drill. `registeredTeamNames`
  and `functionTeamName` are deleted — nothing reads the registry for a label
  any more. A team touch point with no name is announced as its leader's
  ("Hana Wael's team"), never "the team".
  ③ **THE MEMBERSHIP EDITOR LOSES ITS TEAM FIELD** — the picker, the "➕ New
  team…" flow, the team chip under each name and the team in the search line
  all go with the column. The **Manager** field, which was always the real
  answer, stays; v33.52's Manager funnel is how you now ask "show me X's
  people". The registry card keeps **EB and LB only** — the two named bodies.
  ④ **NOTHING BROKE IN THE AUDIENCE RULES**, because the touch-point audience
  has resolved a team by the MANAGER LINK since v33.5 (`m.stakeholder_id ===
  tp.owner_id`) — the name match was already the dead branch. The profile's
  "my teams" card is derived the same way: EB / LB from role, the function
  from the Function column, and "My team" from the manager.
  ⑤ **THE STALE NAMES ARE GONE FROM THE DB.** 30 of 81 active members still
  carried a `team_name` string the sheet no longer has ("تملي معاك, شماريخ",
  "IRIS, شماريخ, M^3"…) — all of them retired structural names, and the last
  way one could still pull somebody into an invited-team audience by string
  match. Cleared in prod; the column stays for history and reads null.
  Errors and warnings are exactly the pre-change baseline (56/34), 242 tests.

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
  `sendProposalEmail` writes `proposal_sent` only; the only ownership
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
