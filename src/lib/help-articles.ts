import type { HelpArticle } from "./help-content";

/** THE KNOWLEDGE BASE (v33.36) — every help article, as plain data.
 *
 *  Generated from the system's own documentation (AI_CONTEXT.md) and
 *  fact-checked against it; edit freely — it is source, not build output.
 *  ⚠️ Update with every release (same commit), like the Playbook before it.
 */
export const HELP_ARTICLES: HelpArticle[] = [
 {
  "id": "activate-26-bid",
  "title": "The Activate 26' bid page",
  "emoji": "🎪",
  "category": "getting-started",
  "audience": "MMs and above (the public link: everyone)",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "activate",
   "activation",
   "bid",
   "mapping",
   "hr plan",
   "bulk edit",
   "fill down",
   "add section",
   "week",
   "hosting",
   "conference",
   "timeline",
   "checkpoints",
   "oc",
   "organizing committee",
   "public link",
   "circus",
   "استضافة",
   "مؤتمر"
  ],
  "summary": "Our bid to host Activate 26' — the timeline, checkpoints, OC structure, Mapping and HR plan — on one page MMs and above edit like a sheet, with a public link that anyone can view.",
  "blocks": [
   {
    "t": "p",
    "md": "Open **Activate 26' Bid** in the sidebar ([here](/activation)) — it's there for **MMs and above** (Coordinators, Team Leaders, Directors, VPs, the LCP). Members see the same plan on the public link. It merges the two bid sheets into five acts: **the road to the show** (the timeline), **nine checkpoints**, **the ringmasters** (OC structure and job descriptions), **the casting call** (the **Mapping** of who wants which role, and how the OC is selected) and the **HR Plan** (Day 0 – Day 3, who does what and who backs them up)."
   },
   {
    "t": "p",
    "md": "The road opens on **Week by week**: one row per week, one column per team, every item written out with its date — no clicking slot by slot. ↳ marks something still running from an earlier week; checkpoints sit in the week's label. **Timeline** is the draggable Gantt, **Agenda** the phone view."
   },
   {
    "t": "steps",
    "items": [
     "Press **Edit** in the bar at the bottom. Every table opens as a sheet: click a cell and type, **Enter**/**Tab** to move on, **Delete** to clear.",
     "**Edit many cells at once, like Sheets**: drag across cells (or Shift+click / Shift+arrows, or click a column name to take the whole column). Then **Delete** clears them, **⌘/Ctrl+D** fills down, **⌘/Ctrl+R** fills right, **⌘/Ctrl+C** copies the block, and pasting ONE value fills every selected cell. The bar above the sheet does the same with buttons, plus **Set all to…**.",
     "Tick rows on the left to **delete many at once** — with Undo.",
     "**Paste straight from Google Sheets** — select a cell and paste; extra lines become new rows.",
     "The ⚙ beside a column name renames it, changes its type, hides it or deletes it; **+ Column** adds one.",
     "**+ Section** in the bottom bar (or the big button at the end of the acts) adds a new act; the page scrolls you to it.",
     "On the road, **drag a bar** to move it, drag its edges to change how long it runs, click it to edit. Drag a 🚩 to move a checkpoint. **Teams & dates** renames teams and recolours them.",
     "Changes save as you make them, and anyone else editing sees them within seconds. Press **View** to see exactly what the public sees."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "Nothing on the page is a to-do — there are no \"done\" ticks. The checkpoints are the plan's stops; the page simply opens on the next one coming up. The name list's heading (**Mapping**) is yours to rename: Edit → the **List title** box on that act."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**The public link** (\"Public link\" in the bottom bar, or /activate26) is read-only and needs no account. Each act has an **On the public page** switch, and the casting list shows its numbers publicly but **no names** unless you turn on **Show names publicly**."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "The dates were fitted from the sheet to **25 Sep → 5 Dec**: everything up to the 1st OC meeting kept its exact date, the rest kept its order and was spaced to finish by 1 December, so the nine checkpoints fall five days apart and Day 0 – Day 3 are 2 – 5 December. In edit mode, clicking a bar shows the date it had in the sheet."
   }
  ]
 },
 {
  "id": "no-peace-war",
  "title": "No Peace — the war points board",
  "emoji": "⚔️",
  "category": "getting-started",
  "audience": "Everyone (logging: the F&L VP)",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "no peace",
   "war",
   "war points",
   "points",
   "war room",
   "rewards",
   "activate",
   "leaderboard",
   "ranking",
   "core",
   "national",
   "35",
   "bonus",
   "attendance",
   "engagement",
   "حرب",
   "نقاط"
  ],
  "summary": "The LC's No Peace campaign (25 Oct → 25 Nov): the F&L VP logs war points in the War Room, and the public page /no-peace shows the standings live — with the rewards, the rules and where Alexandria stands nationally.",
  "blocks": [
   {
    "t": "p",
    "md": "**/no-peace** is the war board everyone can open — no account needed, made for phones. The **leaderboard** is the page: the top three, then everyone else, with search, a function filter and a **35+ only** switch — tap a name to see what they scored. Switch it to **Functions** to see the **function race**: each function's total war points, every person counted for their main function only (B2B and BD race separately; CXP, TM, IM and F&L don't take part). Beside it (under it on a phone) sit the **live feed** of who just scored, the **rewards** (tap one for who holds it right now) and **Alexandria's national rank from CORE**. The bar at the top counts down to **Activate 26'** and jumps to any section; the header counts down to the **end of the war**. When a point is logged it lands on every open copy within a second — no refresh."
   },
   {
    "t": "table",
    "headers": [
     "Achievement",
     "War points"
    ],
    "rows": [
     [
      "OGV APD",
      "7"
     ],
     [
      "OGT APD",
      "12"
     ],
     [
      "10 SUs",
      "2"
     ],
     [
      "IGV APD",
      "6"
     ],
     [
      "IGT APD",
      "10"
     ],
     [
      "IGV OPEN",
      "10"
     ],
     [
      "IGT OPEN",
      "15"
     ],
     [
      "PARTNER",
      "20"
     ],
     [
      "PR DEAL",
      "12"
     ],
     [
      "Bonus (attendance, engagement…)",
      "whatever the F&L VP sets"
     ]
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "You need **at least 35 war points** to compete for a reward. Points belong to the person who earned them — a member's achievement is **not** also counted for their MM. Ties share a rank. Only **active** members, Coordinators and Team Leaders compete (TM Coordinators are out); the F&L VP can change who competes in the War Room's settings."
   },
   {
    "t": "steps",
    "items": [
     "Open **War Room** in the sidebar ([here](/war-room)) — it's the F&L VP's (the LCP and admins too; anyone else can be given it in Settings → Tabs).",
     "**Log points**: tick who scored (search, or add a whole function at once), pick what they did, set how many, and press **Log it**. A toast offers **Undo**.",
     "**Bonus / penalty** is for checkpoint points like attendance and engagement: type the number (− for a penalty) and a comment — the comment stays inside Sodio, the page just says \"Bonus\".",
     "**Entries** lists everything logged, with search and filters (person, achievement, who logged it, dates). Edit or delete any entry; deleted ones wait under **Deleted** and can be restored.",
     "**Settings** edits the point values (changing one re-scores everything already logged), the rewards, the rules, the dates, who competes and what the public page shows."
    ]
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why does Alexandria show \"10+\" for a program?",
      "a": "CORE only publishes the top 10 LCs per program. Outside it, it doesn't say where we are — and neither do we."
     },
     {
      "q": "Can the page be taken down after the war?",
      "a": "Yes — the LCP or an admin: Settings → Tabs → War Room → turn off the public page, or retire the tab and take the page down with it."
     }
    ]
   }
  ]
 },
  {
  "id": "tab-manager",
  "title": "Managing tabs — who sees what",
  "emoji": "🗂️",
  "category": "leaders",
  "audience": "The LCP & admins",
  "audienceKeys": [
   "eb",
   "admin"
  ],
  "keywords": [
   "tabs",
   "sidebar",
   "hide tab",
   "show tab",
   "retire",
   "delete tab",
   "remove",
   "visibility",
   "access",
   "rename",
   "order",
   "public page",
   "settings"
  ],
  "summary": "Settings → Tabs lets the LCP and admins show or hide any sidebar tab for everyone, for roles, functions or named people — rename it, order it, open and remove it on dates, retire it, and take its public page down.",
  "blocks": [
   {
    "t": "p",
    "md": "Open **Settings → Tabs** ([here](/profile/settings?tab=tabs)). Every tab follows its rule in the code until you set one. **Edit** opens the rule: a new name, who sees it to start with (**as the code says**, **everyone** or **nobody**), then **also show it to** and **hide it from** — roles, functions or named people. A person you name always wins over their role or function; on the same level, hiding wins."
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "A hidden tab is gone from the sidebar **and** its page sends that person home. A tab you open to someone the code wouldn't opens the page for them, but the data inside still follows their role — a data module can look empty to them."
   },
   {
    "t": "steps",
    "items": [
     "**Show from / Remove on** — the tab appears and disappears by itself at those moments (the Activate bid tab after the bid, for example).",
     "**Retire** (the bin) hides it from everyone right away; nothing is deleted, and **Restore** brings it back.",
     "Tabs with a public page (Activate 26' → /activate26, War Room → /no-peace) have switches to take that page down, now or together with the tab.",
     "The arrows set the LC's default order — a member's own arrangement still wins on their device."
    ]
   }
  ]
 },
 {
  "id": "rule-manager",
  "title": "Changing a rule without a deploy",
  "emoji": "\u2696\ufe0f",
  "category": "leaders",
  "audience": "The LCP & admins",
  "audienceKeys": [
   "eb",
   "admin"
  ],
  "keywords": [
   "rules",
   "permissions",
   "who can",
   "allowed",
   "archive",
   "revive",
   "delete account",
   "cancel deal",
   "hand over",
   "privileges",
   "settings",
   "access"
  ],
  "summary": "Settings \u2192 Rules lets the LCP and admins change what people may DO \u2014 revive an archived account, delete one, hand over an IR call, split a deal's opens \u2014 for everyone, for roles, functions or named people.",
  "blocks": [
   {
    "t": "p",
    "md": "Settings \u2192 **Tabs** decides which **pages** someone can open. Settings \u2192 **Rules** ([here](/profile/settings?tab=rules)) decides what they may **do** once they are there. Every rule follows the code until you change it, and each one prints, before you save, exactly what saying yes hands over."
   },
   {
    "t": "steps",
    "items": [
     "**Change** opens the rule: who may, to start with (**as the code says**, **everyone**, **nobody**), then **also allow** and **never allow** \u2014 roles, functions or named people.",
     "A person you name always wins over their role or function; on the same level, **never allow** wins.",
     "The commonest one: *Bring an account back from the archive* starts at Team Leaders and Coordinators. Set it to **Everyone** and any member can revive a name they found again.",
     "**Back to the code's rule** on one rule, or **Put everything back** at the top, undoes it all."
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "A rule widens one **decision**, never what a person can **see**. A Member you let revive accounts still reaches only the archive the whole LC already reads, and one you let hand accounts on can still only pass on their own. Nothing here hands anyone another team's rows."
   }
  ]
 },
 {
  "id": "walk-in-on-an-existing-account",
  "title": "A walk-in to a company you already have",
  "emoji": "\U0001f6b6",
  "category": "raising",
  "audience": "Everyone who works accounts",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "direct visit",
   "walk in",
   "already exists",
   "duplicate",
   "name taken",
   "convert",
   "existing account"
  ],
  "summary": "If the company is already an account of yours, Direct visit offers to log the walk-in ON it instead of refusing you \u2014 same owner, same function, plus today's contact and visit.",
  "blocks": [
   {
    "t": "p",
    "md": "You researched them last week and today you walked in. **Direct visit** used to stop at *that name already exists* and the whole visit was lost. Now, when the account is one you can work \u2014 yours, your team's or your function's \u2014 the name check offers a switch: **log this walk-in on that account**."
   },
   {
    "t": "steps",
    "items": [
     "The account keeps its owner, its function and everything already on it.",
     "It gains today's contact attempt, the visit, the \U0001f6b6 direct-visit mark and whatever you collected at the door.",
     "The fields that describe a NEW account disappear \u2014 that one already has them.",
     "If nobody owned it, it becomes yours: you are the one who went."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "If the account belongs to somebody else, Sodio says whose it is \u2014 ask them, or your Team Leader, to log it."
   }
  ]
 },
 {
  "id": "mm-on-team-ir-calls",
  "title": "Your team's IR calls",
  "emoji": "\U0001f91d",
  "category": "leaders",
  "audience": "Team Leaders & Coordinators in consideration",
  "audienceKeys": [
   "mm"
  ],
  "keywords": [
   "IR call",
   "team",
   "mark done",
   "call notes",
   "reschedule",
   "cancel",
   "team leader",
   "consideration"
  ],
  "summary": "A Team Leader or Coordinator can now fill the notes, chase a new time, fix a bounced IR email and cancel a call hosted by someone they manage \u2014 everything except deleting its log.",
  "blocks": [
   {
    "t": "p",
    "md": "On **Consideration \u2192 IR calls**, a call hosted by one of your people now carries the same buttons their own screen does: **Fill call notes** (which marks it done), **Reschedule**, **Hand over**, **Cancel**, and fixing a bounced IR address."
   },
   {
    "t": "steps",
    "items": [
     "**Deleting a log** is not included \u2014 it leaves no history, no email and no calendar event, so it stays with the host and the VPs.",
     "**Reschedule asked \u00b7 waiting on the IR** on a row means the mail has gone and the IR is choosing. When they pick, the chip goes and the date on the row IS the new one.",
     "You get a bell when an IR moves one of your people's calls, with the old time and the new one.",
     "A request for a time your person never opened shows up for you too \u2014 but only they (or a VP) can say yes, because it books their calendar."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "Who counts as \u201cyour people\u201d is your MM access (Settings \u2192 My function), the same reach you have everywhere else \u2014 and the LCP can change the rule itself in Settings \u2192 Rules."
   }
  ]
 },
 {
  "id": "edits-save-themselves",
  "title": "Your account edits save themselves",
  "emoji": "✅",
  "category": "faq",
  "audience": "Everyone who works accounts",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "save",
   "not saved",
   "lost",
   "edit",
   "next step",
   "details",
   "contact info",
   "autosave",
   "nothing happened",
   "حفظ",
   "اتمسح"
  ],
  "summary": "Next step, Details, Contact info and the Podio cadence on an account save automatically — the line under each card tells you when it's done, or why it can't be yet.",
  "blocks": [
   {
    "t": "p",
    "md": "On an account page you no longer press a Save button. Type, pick, or tap **Next week** — Sodio saves as soon as you pause, when you leave the field, when you switch to WhatsApp or Call, and when you go back to the list."
   },
   {
    "t": "steps",
    "items": [
     "**Saves automatically when you pause…** — you are still typing; it goes out in a second.",
     "**Saving…** then **✓ Saved** — it is in Sodio, for everyone.",
     "**Not saved yet — …** — something has to be fixed first, and it says what (for example, a next step needs a date).",
     "**Not saved — … · Retry** — the connection or the server refused it. Nothing is thrown away: press Retry, or it is sent again when you leave the page."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Moving an account to another function is still a button** (\"Move to IGV\"), on purpose — it re-files the account and its numbers under another lane, so it should never happen by accident."
   }
  ]
 },
 {
  "id": "walkthrough-once",
  "title": "The walkthrough shows once — replay it any time",
  "emoji": "🧭",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "walkthrough",
   "tour",
   "onboarding",
   "keeps showing",
   "every time",
   "replay",
   "guide",
   "جولة"
  ],
  "summary": "Sodio shows you the guided walkthrough the first time you enter, and never again unless you ask for it from Help.",
  "blocks": [
   {
    "t": "p",
    "md": "The walkthrough used to be remembered by your **browser**, and only when you finished it or pressed ✕ — so closing the app halfway, clearing your browser, or opening Sodio on your phone started it again from the beginning. It is remembered on **your account** now, from the moment it first opens."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "Want it again? Open [Help](/help) and press **↻ Replay the walkthrough** at the top."
   }
  ]
 },
 {
  "id": "pdp-and-o2o",
  "title": "Your PDP and your one-on-one",
  "emoji": "📋",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "pdp",
   "o2o",
   "one on one",
   "one-on-one",
   "development plan",
   "personal development",
   "goal",
   "weekly steps",
   "review",
   "tm",
   "خطة",
   "تطوير",
   "اجتماع"
  ],
  "summary": "The monthly conversation with your leader — a skill to build, a target to hit, last month's numbers, and four weekly steps you tick off yourself.",
  "blocks": [
   {
    "t": "p",
    "md": "Every month your leader sits down with you, looks at last month's numbers **with** you, and you agree what to work on. It used to live in a Google Sheet in their Drive — which meant that if you wanted to remember what you agreed, you had to ask them. It is in Sodio now, under **PDP & O2O**."
   },
   {
    "t": "steps",
    "items": [
     "**The conversation (O2O)** — a few short questions your leader asks. TM writes them, and can change them without a release.",
     "**🌱 The skill** — one soft skill you want to build this month. Not a KPI: the thing you'd like to be better at.",
     "**🎯 The month's target** — your number, whatever your function counts: opens, approvals, partnerships.",
     "**🔎 The gap** — Sodio reads last month's funnel and points at the thinnest step. It is a suggestion; you two were in the room and it wasn't.",
     "**Four weekly steps** under each of those, because a goal with no steps is a wish."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**You tick your own steps off.** The plan is your leader's to write; the doing is yours, and a plan you can't mark progress on is a document. Your leader can tick one too — a step is often confirmed in the next one-on-one rather than alone."
   },
   {
    "t": "p",
    "md": "**Last month's numbers are read for you, not typed.** They come from the same place the dashboard reads, and they are FROZEN into the plan when it is filed — so the gap it names keeps matching the steps you agreed against it, instead of quietly moving underneath you."
   },
   {
    "t": "table",
    "headers": [
     "Who",
     "What they see"
    ],
    "rows": [
     [
      "You",
      "Your own plan, your weekly steps, and every plan filed for you before"
     ],
     [
      "Your leader",
      "Yours, plus everyone who reports to them — and how many each of THEM then owes"
     ],
     [
      "Their leader",
      "The same, one level up: a VP coaches their MMs on the coaching they are doing"
     ],
     [
      "TM & the LCP",
      "Who has filed and who has not — names and states, never the contents"
     ]
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**A PDP says out loud what somebody is not good at yet, so who can read one is deliberately narrow** — narrower than the rest of the TM module. The LC-wide list TM sees is names and states only; opening any individual plan still goes through the same gate."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The deadline passed and Sodio is nagging me",
      "a": "Three days of a bell and an email, then a dialog when you next open Sodio — and **you can skip it**. A development conversation nagged into existence is not one worth having. Skip twice and it stops for good; the people waiting for theirs are still waiting, which is the honest thing for it to say."
     },
     {
      "q": "I'm a Coordinator with nobody under me",
      "a": "Then you owe nobody a PDP, and one is still filed FOR you. A Coordinator is an MM with no team — you carry your own numbers, so your plan is about your own numbers."
     },
     {
      "q": "My leader hasn't filed mine",
      "a": "It is theirs to start — it is a conversation, not a form you get sent. If the month is nearly gone, ask them; TM can see who is outstanding and can file it if your leader has gone quiet."
     }
    ]
   }
  ]
 },
 {
  "id": "delete-an-account",
  "title": "Delete an account (and cancel a deal)",
  "emoji": "🗑️",
  "category": "raising",
  "audience": "Everyone",
  "audienceKeys": [
   "raising",
   "mm",
   "eb"
  ],
  "keywords": [
   "delete",
   "remove account",
   "typo",
   "cancel deal",
   "undo deal",
   "wrong account",
   "mistake",
   "حذف",
   "مسح",
   "الغاء"
  ],
  "summary": "A typo is not a decision — an account with nothing on it can be deleted outright, and a deal recorded by mistake can be taken back.",
  "blocks": [
   {
    "t": "p",
    "md": "**Archiving and deleting are not the same thing.** Archiving is a decision about a real business, and it doubles as the blacklist — it stops that name ever being added again. That is right for *Not interested*, and completely wrong for a name you simply spelled incorrectly: archiving a typo blocks the CORRECT spelling from ever being entered."
   },
   {
    "t": "steps",
    "items": [
     "**An account with nothing on it** — no contacts, no visits, no deals, no comments — can be deleted by anyone who may edit it. There is nothing to destroy.",
     "**An account that carries history** takes a VP, Director or the LCP, and you have to type the name out in full to confirm.",
     "The dialog asks the server what is actually on the account first, so it tells you *\"nothing has been logged on it\"* or *\"this destroys 6 contacts and 2 deals\"* — never a generic warning."
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**Deleting is permanent and it cascades** — contacts, visits, comments, deals and their opens splits all go with it. It is refused inside a test view and during an LC test session, because a cascade cannot be rolled back."
   },
   {
    "t": "p",
    "md": "**Cancelling a deal** is the smaller cousin. A deal recorded on the wrong account, or one that fell through after signing, used to sit in the funnel forever inflating the account, the lane and somebody's personal opens. Open the deal in the account's History and cancel it."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "A cancelled deal is **deleted**, not flagged — deals are read in seventeen places, and a \"cancelled\" flag that one of them forgot to filter is a number that stays quietly wrong forever. What survives is the part a human reads: a comment on the account naming the opens, the amount and the reason, plus the audit row. The counters recompute, so an account dropping to zero deals also drops back out of *Deal Done*."
   }
  ]
 },
 {
  "id": "cross-function-opens",
  "title": "An open raised for the other programme",
  "emoji": "🔀",
  "category": "raising",
  "audience": "IGV & IGT raisers",
  "audienceKeys": [
   "raising",
   "mm"
  ],
  "keywords": [
   "cross function",
   "igv igt",
   "raised for",
   "wrong function",
   "move account",
   "swap product",
   "opens",
   "نقل"
  ],
  "summary": "Approached them as IGT, got an IGV open instead? Record it as what it is — the account follows the latest open, and you keep it.",
  "blocks": [
   {
    "t": "p",
    "md": "It happens on the floor all the time: you approach an enabler as **IGT**, they say no, you offer **IGV** instead and they sign. The open is genuinely an IGV one, raised by an IGT member, on an account labelled IGT."
   },
   {
    "t": "steps",
    "items": [
     "On any IGV or IGT account, the Record-deal popup asks **\"These opens were raised for\"** first.",
     "Pick the sibling programme and three things happen at once: the opens are recorded as **that** programme's, the **account moves** to that function, and a comment saying so is written on the account so both VPs can read it.",
     "You can also move it BEFORE the deal, from **Details → Function**."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**You keep the account and you keep the opens.** Nothing is taken from you — editing rights follow the responsible, which is still you. The rule is simply *the account follows the latest open*. You still cannot CREATE an account in a function you don't work; you can only move one you already own."
   }
  ]
 },
 {
  "id": "say-something-to-the-lc",
  "title": "Say something to the whole LC",
  "emoji": "📣",
  "category": "leaders",
  "audience": "IM admin",
  "audienceKeys": [
   "admin",
   "eb"
  ],
  "keywords": [
   "prompt",
   "announcement",
   "ask the lc",
   "survey",
   "rating",
   "im prompt",
   "broadcast",
   "اعلان",
   "استبيان",
   "answers",
   "results",
   "who answered",
   "close it"
  ],
  "summary": "A message the floor meets the next time they open Sodio — and, if you want, an answer back from each of them.",
  "blocks": [
   {
    "t": "p",
    "md": "An email nobody reads is not an announcement. A card on [/admin](/admin) composes a **prompt**: a dialog the floor meets the next time they open Sodio."
   },
   {
    "t": "steps",
    "items": [
     "**Who sees it** — everyone, particular functions, particular roles, or named people.",
     "**What comes back** — nothing at all, an acknowledgement, a **1–5 rating**, or **a sentence**, with your own question above the control.",
     "**Whether it can be waved away** at all.",
     "**Preview it first.** The preview renders exactly what a member will meet, using the same rating widget they will use. Skip and Send are inert in it — a real click would have to answer a prompt that was never filed."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**A skip is recorded too.** You should be able to see who never engaged, rather than a silent gap. Skipping once says the feedback matters and returns tomorrow; skipping twice retires it for good — and because the count lives on the row, that survives a new phone and a cleared browser."
   },
   {
    "t": "p",
    "md": "**Read the answers (v37.3).** Under the composer on [/admin](/admin), **What the LC answered** lists every prompt you sent: how many it reached, how many answered, skipped or are still waiting, the rating average and spread, every answer with the name and time, and who hasn't answered. **Close it** takes a prompt off the screens still waiting for it — the answers you already have stay. The answers also come out in **Settings → My data** (Prompts + Answers sheets)."
   }
  ]
 },
 {
  "id": "api-keys",
  "title": "Letting another tool read Sodio",
  "emoji": "🔌",
  "category": "leaders",
  "audience": "IM admin",
  "audienceKeys": [
   "admin"
  ],
  "keywords": [
   "api",
   "api key",
   "integration",
   "export",
   "developer",
   "docs",
   "scope",
   "بيانات"
  ],
  "summary": "A read-only key, issued for something specific — which functions, how much of each account, and how often.",
  "blocks": [
   {
    "t": "p",
    "md": "Another tool (a market-research bot, a dashboard, a script) can read Sodio through a key you issue on [/admin](/admin). A key is issued **for something specific** and can never be talked into more."
   },
   {
    "t": "table",
    "headers": [
     "You choose",
     "Options"
    ],
    "rows": [
     [
      "Functions it may read",
      "IGV · IGT · B2B · BD · B2C"
     ],
     [
      "How much of each account",
      "**names** (name only — enough to dedupe) · **pipeline** (+ function, product, owner, dates) · **contacts** (+ phones, emails, links)"
     ],
     [
      "Whether the archive and blacklist are included",
      "yes / no"
     ],
     [
      "An expiry, and an hourly ceiling",
      "optional"
     ]
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**Scope belongs to the KEY, never to the request.** There is no query parameter that widens it, so a names-only research bot cannot be persuaded to return a lead list."
   },
   {
    "t": "p",
    "md": "`GET /api/v1/docs` returns the whole thing as one Markdown file, written to be handed to an AI that will write the client for you — and it states **that key's own scope**, so \"why am I not getting phone numbers\" answers itself."
   }
  ]
 },
 {
  "id": "ir-slot-requests",
  "title": "\"None of these times work\"",
  "emoji": "⏰",
  "category": "consideration",
  "audience": "Consideration",
  "audienceKeys": [
   "consideration",
   "mm"
  ],
  "keywords": [
   "slot request",
   "booking",
   "no times",
   "reschedule",
   "ir call",
   "availability",
   "other time",
   "مواعيد"
  ],
  "summary": "An IR eight time zones away can ask for a time you never opened — and you accept or decline it without losing the conversation.",
  "blocks": [
   {
    "t": "p",
    "md": "Your booking page can only ever offer what you opened. An IR with none of your hours free — or none that suit them eight zones away — used to be a dead end, and the LC lost the conversation to whatever they did next."
   },
   {
    "t": "steps",
    "items": [
     "Under the slot grid they now see **\"None of these times work?\"**, which swaps the grid for a date and time **in their own zone**.",
     "That files a **request**. It books nothing: your calendar stays yours. It arrives as a bell and an email, and sits at the top of your IR-calls tab.",
     "**Accept** and it becomes a real call through the same machinery as any booking — the row, the calendar event, the Meet link, and the identical confirmation the public page would have sent.",
     "**Decline** and the IR is emailed whatever you typed, word for word, and pointed back at the times that ARE open."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "A lead sees the whole floor's requests, so somebody who is away can still be answered for. The same person asking twice for the same slot is told so, rather than filling your queue."
   }
  ]
 },
 {
  "id": "phone-notifications",
  "title": "Sodio on your phone — the app, and notifications",
  "emoji": "📱",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "app",
   "android",
   "play store",
   "install",
   "phone",
   "mobile",
   "notification",
   "notifications",
   "push",
   "alerts",
   "بالتليفون",
   "تطبيق",
   "اشعارات",
   "تنبيهات",
   "اندرويد"
  ],
  "summary": "Sodio's bell can reach your phone even when Sodio isn't open — and the Android app is the same Sodio in an app icon.",
  "blocks": [
   {
    "t": "p",
    "md": "Sodio's bell has always rung **inside a tab you already had open**, which is why anything urgent had to travel by email. It doesn't any more: turn notifications on and everything that lands on the bell — an account handed to you, a visit booked, a CIC call passed your way, a prompt waiting — arrives on your phone or laptop like any other notification."
   },
   {
    "t": "steps",
    "title": "Turn it on (30 seconds)",
    "items": [
     "Open **Profile → ⚙ Settings**.",
     "Search **notifications** — or scroll to the 🔔 section.",
     "Flip **“Notifications on this phone or laptop”**. Your browser asks for permission; say yes.",
     "Press **Test it**. One should arrive within a second or two. If it does, the whole thing works."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**It's per DEVICE, not per account.** Turning it on on your phone does nothing to your laptop, and vice versa — turn it on wherever you actually want to be reached. Turning it off is the same switch, and it deletes the device straight away."
   },
   {
    "t": "p",
    "md": "**The Android app is the same thing wearing an app icon.** It isn't a separate copy of Sodio and it can never be out of date: it shows sodio.vercel.app full-screen, so every release reaches it the moment it goes live — there is nothing to update from a store. Its notifications are these notifications, in the phone's own tray."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Nothing arrives, but I turned it on.",
      "a": "Check the phone's own settings for Sodio (or Chrome) — a system-level \"block notifications\" beats anything in-app. Then come back to Settings and press Test it: it tells you which half is failing. If the row says \"Blocked in this browser\", the permission was denied and it has to be re-allowed in the browser's site settings first."
     },
     {
      "q": "I'm on an iPhone.",
      "a": "Safari only delivers notifications to a site that has been **added to the Home Screen**. Open Sodio in Safari, Share → Add to Home Screen, open it from there, and the switch will work. There is no iPhone app in the App Store."
     },
     {
      "q": "It's too many notifications.",
      "a": "The crew-wide \"a visit was booked\" heads-up is the loudest thing Sodio sends, and it is already optional: Settings → search **visit** → turn off the BELL one, and it stops reaching your phone too. Everything else on the bell is something that is actually yours to do."
     },
     {
      "q": "Will it wake me up at 3 AM?",
      "a": "It can — a notification goes out when the thing happens, and some of Sodio's jobs run overnight. If that becomes a problem, use your phone's own Do Not Disturb, and tell the IM team: quiet hours can be built."
     },
     {
      "q": "Can the LC see whether I turned it on?",
      "a": "The admin health page shows how MANY devices are registered, as a count. Turning it off is not reported to anyone."
     },
     {
      "q": "Do I still get the emails?",
      "a": "Yes — the phone and the inbox are separate. In Profile → Settings every kind of message has its own Email switch and App switch (App is the bell and this phone together), so you can keep one, the other, both or neither."
     }
    ]
   }
  ]
 },
 {
  "id": "my-settings",
  "title": "Settings — everything that's yours to change",
  "emoji": "⚙️",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "settings",
   "preferences",
   "too many emails",
   "unsubscribe",
   "stop emails",
   "notifications",
   "mute",
   "quiet",
   "email volume",
   "opt out",
   "dark mode",
   "theme",
   "الاعدادات",
   "اشعارات",
   "ايميلات كتير",
   "اوقف الايميلات"
  ],
  "summary": "Profile → Settings, a page of its own: for every kind of message, choose your inbox, the app, both or neither — plus phone alerts, how Sodio looks, and shortcuts to everything else about you.",
  "blocks": [
   {
    "t": "callout",
    "tone": "info",
    "md": "**Since v37.2 Settings is one page in sections, shaped to you** — open it from your [profile](/profile) → Settings. Everyone has **Notifications & account**, **My defaults** (your home page, the dashboard lane you open on, rows per page, the Sign-ups view you land on — saved to your account, the same on every device) and **My data** (download what you can see). A Team Leader also has **My team** (mark members active or inactive), a VP or Director **My function** (the rules your function starts from) and the **Handover** the previous EB left, and the LCP and admins **LC & new term**."
   },
   {
    "t": "p",
    "md": "Everything you can change about *your own* Sodio lives on one page: **Profile → Settings**. It has a search box at the top that searches the descriptions as well as the titles — so type the problem, not the feature name: *\"too many emails\"*, *\"next step\"*, *\"password\"*, *\"dark\"*, *\"اشعارات\"*. Switches save the moment you flip them; there is no Save button."
   },
   {
    "t": "steps",
    "title": "Choose how each message reaches you",
    "items": [
     "Open **Profile** and tap the **Settings** card.",
     "Under **Emails & notifications**, every kind of message has two switches: **Email** (your inbox) and **App** (the bell — and your phone, if you turned phone notifications on).",
     "Keep one, the other, both or neither. A dash instead of a switch means Sodio never sends that one that way.",
     "Want quiet? **All off** at the top turns every email (or every app notification) off in one tap — and **All on** brings them back."
    ]
   },
   {
    "t": "table",
    "headers": [
     "Group",
     "What's in it"
    ],
    "rows": [
     [
      "Accounts & visits",
      "Accounts handed to you · your own visits (the email carries the calendar invite) · the crew's “a visit was booked” · report-your-visit reminders · visit results from your team · **next-step reminders** · Podio updates due"
     ],
     [
      "Sign-ups",
      "Sign-ups and referrals handed to you · CIC & B2C calls to make · the 🔥 streak reminder"
     ],
     [
      "IR calls & partnerships",
      "Calls booked, moved, cancelled or handed to you, times IRs asked for, bounced IR emails · partnership targets and partnerships that count for you"
     ],
     [
      "Touch points & your team",
      "Touch-point invites and ratings · attendance · PDPs & O2Os · things added to your calendar · CXP reminders"
     ],
     [
      "Feedback · Reports",
      "Shout-outs · feedback and concerns · sprint & month reports · announcements from leaders"
     ]
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**Only two things can't be switched off:** a password reset you asked for, and the one welcome when you first sign in — they're how you get into Sodio. Everything else is yours to choose, including the follow-up, attendance and Podio reminders, so if you turn those off, you're the one keeping track."
   },
   {
    "t": "p",
    "md": "**Next-step reminders** come from Sodio itself: on the day of an account's next step you get one — an hour before it if it has a time, at 9:00 if it only has a date. Before, only people who connected Google got a reminder (as a calendar event); now everybody does, and the calendar event still happens for those who have it."
   },
   {
    "t": "p",
    "md": "The page also holds **your phone, backup Gmail, password and profile picture** — those rows don't duplicate the controls, they take you to the card on your profile that owns them. **Theme** and **how the accounts list looks on a phone** are marked *this browser*: they're remembered on the device you set them on, not on your account."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I turned an email off and still got one.",
      "a": "Check it was the same kind — they're separate rows. The crew's \"a visit was booked\" and your OWN visit are two different switches, and so are \"report your visit\" and \"visit results from my team\". Only a password reset and the welcome can't be turned off."
     },
     {
      "q": "I turned the App switch off but my phone still buzzed.",
      "a": "The App switch covers the bell and the phone together, per kind of message. If something else buzzed, it was a different kind — search the settings for it. To silence the phone entirely on one device, use \"Notifications on this phone or laptop\"."
     },
     {
      "q": "Can I change my name, role, function or team here?",
      "a": "No — those come from the Membership sheet, which is the source of truth for the whole LC. The Settings rows for them tell you that and point at the WhatsApp link to get it fixed at the source."
     },
     {
      "q": "Why did my theme not follow me to my phone?",
      "a": "Theme and the mobile list style are saved in the browser, not on your account — the page labels them \"this browser\". Set them once per device."
     }
    ]
   }
  ]
 },
 {
  "id": "import-accounts",
  "title": "Import a list of accounts",
  "emoji": "📥",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "import",
   "bulk",
   "upload",
   "csv",
   "xlsx",
   "excel",
   "market research",
   "template",
   "columns",
   "sheet",
   "استيراد",
   "رفع ملف",
   "اكسيل"
  ],
  "summary": "Upload a .csv or .xlsx of market research. The columns you're asked for are YOUR function's, each with a worked example — and there's a template to start from.",
  "blocks": [
   {
    "t": "p",
    "md": "**Raising → Import** takes a `.csv` or `.xlsx` with a header row and turns it into accounts. Every row passes exactly the same checks as a hand-added account, so duplicates and archived names are blocked automatically — and you review everything on screen *before* anything enters the system."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Start from the template.** The **Download template** button gives you a file with exactly your columns and one filled-in example row. Fill it in, upload it back, done — no guessing at the layout."
   },
   {
    "t": "steps",
    "title": "Import a file",
    "items": [
     "**Raising → Import** → **Download template** (or use your own file — the headings are matched loosely).",
     "Fill it in. Only **Name** is always required; the rest depends on your function, and the guide on the page shows a real example for every column.",
     "**Choose file**. Anything that needs fixing is flagged on its row — a bad phone, a bad email, a missing required field — and the Import button waits until it's clean.",
     "**Import**. Each row reports back: imported, or the exact reason it was blocked."
    ]
   },
   {
    "t": "p",
    "md": "**The columns follow YOUR access.** You are only asked for what your own function actually uses, and a column your function doesn't carry is ignored even if the file has one — so an Industry column on a B2C import is simply dropped rather than written onto the account."
   },
   {
    "t": "table",
    "headers": [
     "If you work…",
     "You're asked for",
     "Required"
    ],
    "rows": [
     [
      "IGV",
      "Project, Type, Industry",
      "Name + **Project**"
     ],
     [
      "IGT",
      "Product (GTa/GTe), Sub product",
      "Name + **Product**"
     ],
     [
      "B2B / BD",
      "Type, Industry",
      "Name"
     ],
     [
      "B2C",
      "Type only — Courses / Events / Student activities",
      "Name + **Type**"
     ],
     [
      "Two functions",
      "The union of both, plus a **Function** column to say which row is which",
      "Whatever each row's function needs"
     ]
    ]
   },
   {
    "t": "p",
    "md": "Everyone also gets Name, Phone, Email, Website, Social link and Comment, and leaders get a **Responsible** column. Values are matched forgivingly: *courses* finds **Courses**, *teacher* finds **GTe**, *skill up* finds **Skill Up!**, and Egyptian phone numbers are normalised for you. Headings are matched loosely too — *Account Name*, *company*, *PHONE NUMBER*, *E-mail*, *Notes*, *Owner* all land where they should."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "How many rows can I import at once?",
      "a": "500. Split a bigger file — and remember every row runs the full duplicate and archive check, so a big import takes a moment."
     },
     {
      "q": "My file has extra columns Sodio doesn't know.",
      "a": "They're ignored. Nothing breaks, nothing is stored."
     },
     {
      "q": "Can I assign rows to other people?",
      "a": "Only if you're a Team Leader or above. Put their full name in a Responsible column, or set it per row on screen. Anyone else's rows land with them."
     },
     {
      "q": "A row was blocked after upload — why?",
      "a": "The reason is printed on the row: usually the name already exists, or it's in the archive (the archive IS the blacklist, so those names never come back). Fix the name or drop the row and import the rest."
     }
    ]
   }
  ]
 },
 {
  "id": "prank-mode",
  "title": "🃏 Prank mode (someone got you)",
  "emoji": "🃏",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "prank",
   "prank mode",
   "joke",
   "button not working",
   "button needs 3 clicks",
   "wrong page",
   "wrong tab",
   "screen shaking",
   "violet man walking",
   "is it broken",
   "مقلب",
   "الزرار مش شغال"
  ],
  "summary": "A button that needs three clicks, a tab that sends you the scenic route, a little violet man strolling past — nothing is broken, the EB just put you in a mood.",
  "blocks": [
   {
    "t": "p",
    "md": "If Sodio has started behaving like it's in a mood — a button that ignores the first click and gets **bigger** each time, a tab that opens the wrong page and then apologises, a one-second shiver, the Violet Man walking across the bottom of your screen — **nothing is broken and nothing is lost.** Somebody in the EB switched **🃏 prank mode** on for you. The first time it happens, Sodio tells you so and names them. 💛"
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**It cannot touch your work.** Prank mode lives entirely in your browser. It never changes an account, a contact, a visit, a deal, a number, a sign-up or an email, and it is never written anywhere. It is pixels, and only your pixels."
   },
   {
    "t": "table",
    "headers": [
     "What you'll see",
     "What's actually happening"
    ],
    "rows": [
     [
      "A button ignores you and grows",
      "It goes through on the **third** click — and it gets bigger each time, so it's easier to hit than when you started."
     ],
     [
      "A tab opens the wrong page",
      "The apology message carries a **real link** to the page you asked for. One extra tap, and that link is never pranked."
     ],
     [
      "The screen shivers for a second",
      "A CSS animation that ends exactly where it started. Nothing moved."
     ],
     [
      "A violet man strolls past",
      "It's the Violet Man. He's having a walk. You can't click him and he leaves on his own."
     ]
    ]
   },
   {
    "t": "steps",
    "title": "When you actually need to focus",
    "items": [
     "Tap **😤 I'm working** on any of its messages — ten minutes of complete silence.",
     "Use it as often as you like. There's no limit and nobody is told.",
     "Prank mode also **expires by itself** — the EB sets it for a day, a week or the peak."
    ]
   },
   {
    "t": "p",
    "md": "It also stays away from the places where a joke would be a problem: the login and onboarding screens, [Feedback](/feedback), this [Help centre](/help), the admin pages, anything inside a dialog or a form, and every Save / Send / Record / Delete / Archive button in the system. At most one joke every 90 seconds, whatever you click."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can I turn it off myself?",
      "a": "No — that's rather the point. Ask whoever set it (the first message names them) or any EB member, and they switch it off in the membership editor. Meanwhile \"😤 I'm working\" buys you ten minutes of quiet whenever you need it."
     },
     {
      "q": "Did it break something? Should I report it?",
      "a": "No, and no need — everything it does undoes itself in seconds. If something genuinely looks wrong (a number, an account, a missing row), that is NOT prank mode: report it on Feedback as usual."
     },
     {
      "q": "Who can switch it on?",
      "a": "Only the EB (LCP/LCVPs) and admins, from the membership editor — and it's recorded in the audit log with their name, so it is never anonymous."
     },
     {
      "q": "Does it slow the system down or cost anything?",
      "a": "No. It's a few lines of animation in your own browser: no emails, no jobs, no database writes, nothing sent anywhere."
     }
    ]
   }
  ]
 },
 {
  "id": "forgot-password",
  "title": "Forgot your password?",
  "emoji": "📬",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "forgot password",
   "reset password",
   "new password",
   "locked out",
   "can't remember",
   "email me a password",
   "نسيت الباسورد",
   "كلمة السر",
   "استرجاع"
  ],
  "summary": "Tap Forgot password and Sodio emails you a fresh one — your old password keeps working until you actually change it, so nobody gets locked out.",
  "blocks": [
   {
    "t": "p",
    "md": "No drama here. Sodio doesn't do reset links or lockouts — it just **emails you a brand-new password** you can sign in with immediately. And because someone might hit the button by accident (or someone else might, on your behalf), **your old password keeps working too** until you change it. Nothing is invalidated by the request itself."
   },
   {
    "t": "steps",
    "items": [
     "On the login page, tap **Forgot password** (or on [your Profile](/profile), tap **📬 Email me a new password**).",
     "Check your inbox — the email carries the fresh password.",
     "Sign in with it (or with your old one, if it suddenly comes back to you).",
     "Optionally change it to something memorable from [Profile](/profile) → **Change password**."
    ],
    "title": "Get a fresh password"
   },
   {
    "t": "callout",
    "md": "The email goes to your AIESEC address — or to your **Personal Gmail backup** if your @aiesec.net hasn't landed yet and you've saved a backup on your [Profile](/profile). If neither exists, message the IM team.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I requested a new password but my old one still works — is that a bug?",
      "a": "It's the feature. Both work until you change your password yourself. That way a stray request can never lock you out."
     },
     {
      "q": "The email never arrived.",
      "a": "Check spam, then confirm which address is on your membership (see your [Profile](/profile)). If you're a phone-only member with no backup Gmail saved, there's nowhere to send it — add a backup Gmail on your Profile or contact the IM team."
     },
     {
      "q": "Can I just always sign in with Google instead?",
      "a": "Yes — Google sign-in works forever, password or no password."
     },
     {
      "q": "I asked again and no second email came.",
      "a": "Sodio sends at most one fresh password every 10 minutes (and a few an hour), so nobody can flood your inbox or keep replacing the password you're about to type. The one already in your inbox works — use that."
     },
     {
      "q": "It says \"too many sign-in attempts\".",
      "a": "After about ten wrong passwords in an hour for one account (or a lot from one network), Sodio pauses password sign-in for that hour so nobody can guess their way in. Wait it out, sign in with Google, or message the IM team on WhatsApp."
     }
    ]
   }
  ]
 },
 {
  "id": "make-sodio-yours",
  "title": "Making Sodio yours",
  "emoji": "🎨",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "dark mode",
   "theme",
   "arrange tabs",
   "sidebar",
   "reorder",
   "columns",
   "table settings",
   "mobile",
   "pwa",
   "install app",
   "home screen",
   "الوضع الليلي",
   "الموبايل",
   "تثبيت التطبيق"
  ],
  "summary": "Dark mode, a reorderable sidebar, table columns you control, three mobile views and a home-screen install — Sodio bends to how you work.",
  "blocks": [
   {
    "t": "p",
    "md": "Sodio ships with sensible defaults, but almost everything about how it *looks* is yours to change — and every choice is remembered per browser, so set it once and forget it."
   },
   {
    "t": "steps",
    "items": [
     "**Dark mode** — the appearance toggle sits in the sidebar footer (desktop) or the top bar (mobile). Default follows your system; the switch does a smooth circular reveal because we're fancy like that.",
     "**Arrange tabs** — at the bottom of the sidebar nav, tap **↕ Arrange tabs**: drag rows by the grip handle or use the ↑/↓ buttons, and **Reset** brings the default order back. Your order is saved just for you.",
     "**Collapse the sidebar** — the **Collapse** row at the foot of the nav shrinks it to an icon rail when you want the screen for the table.",
     "**Install Sodio on your phone** — it's a PWA: open sodio.vercel.app in your browser and use *Add to Home Screen* (Safari share menu, or Chrome's install prompt). It opens like a real app, lighthouse icon and all."
    ],
    "title": "The quick wins"
   },
   {
    "t": "p",
    "md": "**Tables are yours too.** Every big table (Raising, Sign-ups, members directory, attendance, the IR-call log…) carries a **⚙ Columns** control: drag columns to reorder, show or hide them, and **Reset** to defaults — dozens of optional columns ship hidden so your table starts clean. Click any header to **sort** (leaderboards even glide into their new order); the little **funnel** button on a column header filters by that column, Google-Sheets style; and the rows-per-page picker (30/50/100/200) lives by the pager. On the Raising table that now covers **every** column — Industry, Type, Proposal (sent / not sent), Deals (has / none) and Podio (requested / not / Checking / Approved / Rejected) each carry their funnel; show the column from ⚙ and filter from its header. On a phone, where cards replace tables, the same filters appear as labelled chips above the list — Raising, Sign-ups and the CV pool all carry them."
   },
   {
    "t": "callout",
    "md": "On a phone, tables become **cards** — and the Raising list has a Cards / Compact / Table switcher if you prefer density over comfort. Hints (the little tooltips on buttons) open on **tap** on touch screens.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Will my column setup survive a new release?",
      "a": "Yes — layouts self-heal: new columns appear at their intended spot, your order and hidden set stay put."
     },
     {
      "q": "My table looks weird / missing columns — how do I start over?",
      "a": "Open **⚙ Columns** on that table and hit **Reset**."
     },
     {
      "q": "Does the PWA work offline?",
      "a": "It installs and launches like an app, but Sodio is a live CRM — you need a connection for the data."
     },
     {
      "q": "Are these settings synced between my laptop and phone?",
      "a": "No — they're stored per browser. Two devices, two setups (which is usually what you want anyway)."
     }
    ]
   }
  ]
 },
 {
  "id": "notifications-bell",
  "title": "Notifications & the bell",
  "emoji": "🔔",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "notifications",
   "bell",
   "unread",
   "broadcast",
   "announcement",
   "alerts",
   "in-app",
   "الاشعارات",
   "الجرس",
   "التنبيهات"
  ],
  "summary": "The bell collects everything Sodio wants you to know — visits, follow-ups, Podio reminders, broadcasts — and most of them open the exact thing they're about.",
  "blocks": [
   {
    "t": "p",
    "md": "The 🔔 bell lives in the sidebar footer on desktop and in the top bar on your phone, with an unread badge. It's Sodio's in-app inbox: quieter than email, but it carries the same news — and the useful part is that **notifications are actionable**: a visit announcement, a follow-up nudge or a Podio reminder opens the exact account it's about with one tap. No hunting."
   },
   {
    "t": "table",
    "headers": [
     "You'll get one when…",
     "Example"
    ],
    "rows": [
     [
      "A visit is booked in your function",
      "\"📢 New visit booked\" — an FYI to the whole product crew"
     ],
     [
      "A visit of yours needs its report",
      "The +2h follow-up nudge, tap to open the account"
     ],
     [
      "A Podio update is due",
      "B2C/enabled accounts on their update cycle"
     ],
     [
      "Someone appreciated you",
      "A 🎉 shout-out from LC feedback"
     ],
     [
      "Leadership has news",
      "A broadcast to everyone, a function, a role, or hand-picked people"
     ],
     [
      "You joined Sodio / got a reset",
      "Welcome & password emails get a bell twin"
     ]
    ]
   },
   {
    "t": "p",
    "md": "**Broadcasts** are the megaphone: EB members and the admin can send one from the bell panel — to the whole LC, a function, a role, or a hand-picked list, optionally with an email copy on BCC. Everyone else just receives them (lucky you)."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Do notifications also come by email?",
      "a": "The important ones do — visit reminders, follow-ups and Podio nudges have email twins. The bell is the fast lane; email is the paper trail."
     },
     {
      "q": "Can I send a broadcast?",
      "a": "Only EB members and the admin see the broadcast button. If you need the whole function to hear something, ask your VP."
     },
     {
      "q": "Why did I get a visit announcement for a visit that isn't mine?",
      "a": "By design — booking a visit tells the whole product's raising crew as an FYI, so nobody double-books the same partner. Only the responsible gets the calendar invite and reminders."
     }
    ]
   },
   {
    "t": "p",
    "md": "**Quieter and easier to read (v33.43):** Sodio never bells you about your own click any more (booking a visit or a touch point used to notify the booker), visit announcements reach only the people who answer for the visit, and each row now shows the icon, the headline, a two-line summary and a short \"2h ago\" — tap it to open the thing itself."
   }
  ]
 },
 {
  "id": "signing-in",
  "title": "Signing in",
  "emoji": "🔑",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "login",
   "sign in",
   "google",
   "password",
   "phone login",
   "first time",
   "can't log in",
   "inactive",
   "onboarding",
   "تسجيل دخول",
   "مش عارف ادخل",
   "الباسورد"
  ],
  "summary": "Type your email or phone, press Continue, and Sodio shows you the one way to sign in that actually works for you — you don't have to know which it is.",
  "blocks": [
   {
    "t": "callout",
    "tone": "info",
    "md": "**After you set your password, Sodio signs you out on purpose.** That is not a glitch and you have not been locked out — you land back on the sign-in page and use the password you just chose. Typing it once, straight away, is what makes it stick; it also means a password you mistyped in your head is caught in the first ten seconds rather than next week."
   },
   {
    "t": "p",
    "md": "**You no longer have to know which door is yours.** The sign-in page asks one thing — your AIESEC email, or your phone number — and when you press **Continue** it works out who you are and shows only the way in that will actually work. It greets you by name, so a mistyped address is caught before you have typed a password. Got the wrong person? **Not you?** takes you straight back."
   },
   {
    "t": "table",
    "headers": [
     "What Sodio says",
     "What it means",
     "What you do"
    ],
    "rows": [
     [
      "\"This is your first sign-in\"",
      "You have an @aiesec.net address and have never signed in",
      "Use Google, once. It also grants the calendar and Gmail access behind visit reminders and proposal emails. You pick a password straight after"
     ],
     [
      "\"Welcome back, <name>\" + a password box",
      "You already have a password",
      "Type it. Google still works as a second option underneath"
     ],
     [
      "\"You don't have an AIESEC email on the list yet\"",
      "Your @aiesec.net hasn't been added yet — about a fifth of the LC",
      "Your phone number is your password too. It is already filled in — just press Sign in"
     ],
     [
      "\"We can't find that\"",
      "Nothing on the membership sheet matches what you typed",
      "Sodio tells you WHICH kind of mistake it looks like — a personal Gmail, a typo, or a number that isn't listed — and gives you the IM team's WhatsApp"
     ]
    ]
   },
   {
    "t": "steps",
    "items": [
     "Open Sodio and tap **Sign in with Google**.",
     "Pick your **@aiesec.net** account (not your personal Gmail) and accept the permissions.",
     "Walk through onboarding — confirm your info and **set a password**.",
     "Done. From now on, sign in with your email or phone + that password, or Google."
    ],
    "title": "Your first sign-in"
   },
   {
    "t": "callout",
    "md": "**No AIESEC email yet?** You can still get in: type your **phone number in BOTH fields** (as the identifier AND as the password). That door stays open until you set a real password. Once your @aiesec.net address lands on the Membership sheet, the phone-door closes — sign in with **Google once**, then use your password.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "The identifier field takes your email or your phone in any reasonable format — Arabic-keyboard digits (٠١٢…) work too, Sodio translates them. If you land on the **/inactive** page, your membership is marked inactive on the sheet — that's a membership question, not a password question; talk to your leader or the IM team."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I set a password but forgot it — now what?",
      "a": "Use **Forgot password** on the login page. Sodio emails you a fresh one, and your old one keeps working until you change it. Full story in [Forgot password](/help?a=forgot-password)."
     },
     {
      "q": "It says my number isn't on the membership.",
      "a": "Your phone must match what the Membership sheet has for you. If you recently changed numbers, ask your leader or the EB to update the sheet — the app syncs from it every 30 minutes."
     },
     {
      "q": "Why does Google ask for calendar and Gmail permissions?",
      "a": "Calendar puts your visits and next steps on your own Google Calendar (Sodio also reminds you of next steps by app notification and email, Google or not); the Gmail permission lets Sodio drop proposal drafts into YOUR Gmail so emails go out from your address. Sodio never sends without you."
     },
     {
      "q": "I used to sign in with my phone in both fields and it stopped working.",
      "a": "Either you set a password (use it!) or your AIESEC email arrived — in that case sign in with Google once, then your password works."
     }
    ]
   }
  ]
 },
 {
  "id": "road-to-activate",
  "title": "🏆 What is Activate? (the blue bar at the top)",
  "emoji": "🏆",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "activate",
   "conference",
   "national conference",
   "awards",
   "road to activate",
   "countdown",
   "blue bar",
   "banner",
   "violet man",
   "3 december",
   "المؤتمر",
   "الجوايز",
   "اكتيفيت"
  ],
  "summary": "The blue road across the top of every page is the countdown to Activate — AIESEC in Egypt's national conference, where the awards are handed out. Tap it for the whole story.",
  "blocks": [
   {
    "t": "p",
    "md": "That blue band at the top of every page — with the road, the walking Violet Man and a number of days — is **the road to Activate**. **Tap it.** It opens a short brief on what Activate is and links to the conference's own Instagram accounts and the shared folder, so you can see it rather than take our word for it."
   },
   {
    "t": "p",
    "md": "**Activate is AIESEC in Egypt's national conference.** Every LC in the country sends delegates to the same hall for a few days, and it closes with the awards — handed out **per aspect**: every function has its own award, and it doesn't stop at the functions, since there are awards for the LC as a whole and others besides. Whatever you work on, there is something there to win."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**The awards are won before the conference, not at it.** What gets read out on stage is what an LC actually delivered over the peak — and that is precisely what Sodio counts every day: the contact you log, the visit you report, the deal you record, the sign-up you move to **Approved 🏆**."
   },
   {
    "t": "table",
    "headers": [
     "What you see on the bar",
     "What it means"
    ],
    "rows": [
     [
      "The number on the right",
      "Days left until the conference — **3 December 2026**."
     ],
     [
      "\"day N of M\"",
      "How far into the run-up the LC is. The Violet Man stands at exactly that point and moves one day's worth of road every morning."
     ],
     [
      "The lit posts along the verge",
      "The months of the run-up. A post lights up once the LC has walked past it."
     ],
     [
      "The chequered gate",
      "The conference itself, at the end of the road."
     ]
    ]
   },
   {
    "t": "p",
    "md": "The bar removes itself the day after the conference — nobody has to clean it up."
   }
  ]
 },
 {
  "id": "violet-man",
  "title": "The Violet Man — your AI sidekick",
  "emoji": "🚶",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "violet man",
   "ai",
   "assistant",
   "chatbot",
   "ask",
   "help",
   "chat",
   "core",
   "national ranking",
   "الراجل الازرق",
   "المساعد",
   "اسال",
   "ذكاء اصطناعي"
  ],
  "summary": "The walking violet human is Sodio's AI assistant — he knows your data (only yours), live CORE numbers and the AIESEC web, answers in Arabic or English, and hands you tappable links.",
  "blocks": [
   {
    "t": "p",
    "md": "See the walking violet human in the corner? Tap him. **The Violet Man** is Sodio's built-in assistant (powered by Gemini with Google Search grounding), and he's genuinely wired into the system: he can search your accounts and open their details, he reads the same playbook rules this help center does, and he carries a live digest from **CORE** — national rankings per product and Alexandria's own funnel — plus the official AIESEC sites. Ask him \"which of my accounts had a visit but no deal?\" or \"where does Alexandria rank nationally on iGV?\" and he'll actually know."
   },
   {
    "t": "p",
    "md": "**He only sees what YOU see.** His data context is scoped by the same permissions as the rest of Sodio — a member's Violet Man knows that member's accounts, a VP's knows the function, and and he can look up **anything you can open**: accounts by any field (industry, type, stage, who holds it, a phone number, a link…), sign-ups, partner LCs, IR calls, members and — for consideration viewers — the CV pool (\"CVs with C# in skills\"). He can't leak what you couldn't open yourself."
   },
   {
    "t": "steps",
    "items": [
     "**Fresh chat?** He offers suggested-question chips tailored to your role and module — tap one to start.",
     "**He answers in your language** — write Arabic, get Arabic (fluent Egyptian, not textbook); write English, get English.",
     "**Tap his links** — when he mentions an account, he attaches an action chip that opens it directly, sometimes straight onto the right dialog (log a contact, record a deal).",
     "**Your chats are saved** — the history button keeps your 8 most recent conversations in this browser; **＋ New chat** starts clean, 🗑 deletes one.",
     "**Move him** — on desktop, drag the panel by its grip handle if it's covering something."
    ],
    "title": "Getting the most out of him"
   },
   {
    "t": "callout",
    "md": "You'll also spot **\"Ask The Violet Man\"** callouts around the app (accounts header, dashboard) — they open the chat pre-filled with a question about what you're looking at.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can he change my data?",
      "a": "No — he reads and links, you click. Every action still goes through the normal forms and the normal permission checks."
     },
     {
      "q": "Are my chats visible to anyone else?",
      "a": "No. History lives in your own browser's storage, keyed to your account — not on a server, not visible to leaders."
     },
     {
      "q": "How fresh are the CORE numbers?",
      "a": "The national digest refreshes about every 15 minutes from core.aiesec.org.eg."
     },
     {
      "q": "He said he can't see an account I know exists.",
      "a": "Then it's outside your scope — he sees exactly what you see. Ask your TL or VP, who see more."
     }
    ]
   }
  ]
 },
 {
  "id": "what-is-sodio",
  "title": "What is Sodio?",
  "emoji": "💜",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "sodio",
   "what is sodio",
   "crm",
   "intro",
   "overview",
   "start",
   "violet man",
   "aiesec alexandria",
   "ايه هو سوديو",
   "البرنامج ده ايه",
   "شرح النظام"
  ],
  "summary": "Sodio is AIESEC in Alexandria's free CRM — accounts, sign-ups, calls, visits, dashboards and one blue AI assistant, all in one place.",
  "blocks": [
   {
    "t": "p",
    "md": "Sodio is the LC's own CRM, built for us and 100% free. It's where the work lives: raising crews log accounts, contacts, visits and deals on [Raising](/accounts); OGX works the sign-up trackers on [Sign-ups](/signups); the consideration crew books and records IR calls on [Consideration](/consideration); and leaders steer with the [Dashboard](/dashboard), goals-from-planning and leaderboards. If you did it and it's not in Sodio, it didn't happen (as far as the funnel is concerned)."
   },
   {
    "t": "p",
    "md": "Everything you see is scoped to your role — a member sees their own accounts, a Team Leader their team, a VP their function, the LCP everything. That's not a display trick: the server re-checks who you are on every read and every button press, so guessing a URL outside your scope just gets you a 404."
   },
   {
    "t": "table",
    "headers": [
     "You do…",
     "Where"
    ],
    "rows": [
     [
      "Raise partners (IGV · IGT · B2B/BD · B2C)",
      "[Raising](/accounts)"
     ],
     [
      "Work OGX sign-ups (OGT & OGV)",
      "[Sign-ups](/signups)"
     ],
     [
      "IR calls & the CV pool",
      "[Consideration](/consideration)"
     ],
     [
      "See visits, touch points & calls in one month view",
      "[Calendar](/calendar)"
     ],
     [
      "Track KPIs, plans & leaderboards",
      "[Dashboard](/dashboard)"
     ],
     [
      "Attendance & touch points",
      "[Attendance](/attendance)"
     ],
     [
      "Your info, avatar, plan & password",
      "[Profile](/profile)"
     ]
    ]
   },
   {
    "t": "p",
    "md": "And you're never alone in here: **The Violet Man** — the walking violet human in the corner — is Sodio's built-in AI assistant. He knows your data (only what YOU are allowed to see), the LC's playbook, and live national numbers from CORE. Stuck at 11pm? Ask him before you ask your TL. More in [The Violet Man article](/help?a=violet-man)."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does Sodio cost anything?",
      "a": "No. It runs entirely on free tiers — built by the LC, for the LC."
     },
     {
      "q": "Why can't I see a tab my friend has?",
      "a": "Tabs follow your function and role on the Membership sheet. An OGX member won't see Raising, a raising member won't see Sign-ups. If your function's module isn't built yet, you'll see a \"Soon\" workspace — your [Profile](/profile) and Feedback still work."
     },
     {
      "q": "Is my data safe?",
      "a": "Every read and write is permission-checked server-side, and the whole database is backed up nightly to three separate places."
     }
    ]
   }
  ]
 },
 {
  "id": "your-profile",
  "title": "Your profile",
  "emoji": "🪪",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "profile",
   "avatar",
   "change password",
   "phone",
   "backup gmail",
   "personal email",
   "my plan",
   "my people",
   "my team",
   "البروفايل",
   "الصورة",
   "غير الباسورد",
   "google grant",
   "sign in with google",
   "calendar powers"
  ],
  "summary": "Your Profile holds your info, phone, backup Gmail, avatar (pick one or build your own), password, your plan cards and the people around you.",
  "blocks": [
   {
    "t": "p",
    "md": "[Your Profile](/profile) is your corner of Sodio. It shows what the LC knows about you — name, AIESEC Mail, phone, role, function, team — and lets you fix what's yours to fix. Spot something wrong you can't edit? The **Wrong info?** link opens WhatsApp straight to the admin."
   },
   {
    "t": "table",
    "headers": [
     "Card",
     "What it does"
    ],
    "rows": [
     [
      "My info",
      "Your phone (auto-normalized to the +20… format on blur) and your **Personal Gmail — backup only**."
     ],
     [
      "Avatar",
      "Pick a fun character, use your Google photo, upload your own, or **🎨 Create your own** — style, seed, dice-roll, flip, gradient background. Yes, The Violet Man himself is pickable."
     ],
     [
      "Change password",
      "Current + new + confirm. Forgot the current one? The **📬 Email me a new password** button is right there."
     ],
     [
      "My plan",
      "Raising MMs (Team Leaders & Coordinators) see their opens-per-month plan vs actuals; OGX & consideration MMs see their applicants/accepted/approvals plan card. Editable any time."
     ],
     [
      "My people",
      "Who's around you, with email / call / WhatsApp buttons: members & coordinators see their team, a TL their direct team, a VP/Director their whole function, the LCP the EB."
     ],
     [
      "Feedback",
      "The system-feedback form lives here — bugs, ideas, anything about Sodio itself."
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**The backup Gmail is exactly that — a backup.** It receives password resets and IR-call invites until your @aiesec.net arrives. It is **never a sign-in identity** and is **never written to the Membership sheet**. Don't put your AIESEC address in it — Sodio will refuse a backup that matches your main email.",
    "tone": "warn"
   },
   {
    "t": "steps",
    "items": [
     "Open [Profile](/profile) and find the **Change password** card.",
     "Enter your current password, the new one, and the confirmation (the 👁 eye toggle is your friend).",
     "Tap **Update password**. Done — the new one works immediately."
    ],
    "title": "Change your password"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't I edit my name, role or team?",
      "a": "The Membership Google Sheet is the source of truth for those — the EB edits it (or the in-app membership editor) and Sodio syncs every 30 minutes. Your phone and backup Gmail are the fields that are yours."
     },
     {
      "q": "What are the two email fields?",
      "a": "**AIESEC Mail** is your identity — sign-in, and what the Membership sheet carries. **Personal Gmail** is a backup inbox for resets and invites until the AIESEC one lands. Two fields, two jobs."
     },
     {
      "q": "I don't see a plan card.",
      "a": "Plan cards appear only for MMs who file plans — raising TLs/Coordinators (opens) and OGX/consideration MMs (funnel plan). Plain members don't file one."
     },
     {
      "q": "Can I use any image as my avatar?",
      "a": "Pick from the built-in characters, your Google photo, an upload (auto-shrunk), or build one with 🎨 Create your own."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Got your @aiesec.net after joining?** A banner appears at the top of every page asking you to **sign in with Google once** — that's what unlocks calendar reminders for your visits, Gmail drafts and invites from your own name. Dismissing it snoozes it for a day; it stays until the grant exists (v33.40)."
   }
  ]
 },
 {
  "id": "unreported-visits-banner",
  "title": "\"N visits need a report\" — the amber banner",
  "emoji": "⏰",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "unreported visit",
   "visits need a report",
   "banner",
   "amber banner",
   "overdue visit",
   "report visit",
   "clear banner",
   "زيارة متسجلتش",
   "تقرير الزيارة"
  ],
  "summary": "The banner on Raising counts visits whose day has passed with nobody saying what happened — you see exactly the ones you answer for, and it disappears when you report them.",
  "blocks": [
   {
    "t": "p",
    "md": "A booked visit whose time has passed while nobody reported the result leaves the account frozen at \"Visit Scheduled\" — the funnel counts a visit nobody can prove happened. The banner on [Raising](/accounts) makes those visible in the app, not just in email: **\"N visits need a report\"**. Tap it to expand: each row shows the account, when the visit was, how many days ago, and whose it is — each linking straight to the account."
   },
   {
    "t": "table",
    "headers": [
     "You are…",
     "The banner counts…"
    ],
    "rows": [
     [
      "Member / Coordinator",
      "your own overdue visits"
     ],
     [
      "Team Leader",
      "your team's"
     ],
     [
      "VP / Director",
      "your whole function's"
     ],
     [
      "LCP / admin",
      "the LC's"
     ]
    ]
   },
   {
    "t": "p",
    "md": "A clean slate shows **nothing at all** — no banner, no zero. And it only reaches back **two months**: a visit nobody reported in the spring is history, not a to-do."
   },
   {
    "t": "steps",
    "items": [
     "Tap the row to open the account.",
     "Report the visit from its History entry (or from the pending-visit prompt) — say whether it happened and how it went.",
     "If the partner turned out to be not interested, mark the account **Out of Process** with a reason instead — that clears it too, honestly."
    ],
    "title": "Clear it"
   },
   {
    "t": "callout",
    "md": "The +2h report email and the one-week reminder still run — the banner is the same fact shown where the work happens, for the day someone stops reading email.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why do I see a teammate's visit in my banner?",
      "a": "You don't, unless you're their Team Leader or leader — the banner follows the hierarchy. As a TL you answer for your team's visits, so they show for you (and for the member who owns them)."
     },
     {
      "q": "The visit genuinely didn't happen — what do I report?",
      "a": "Report it anyway with what actually happened (cancelled, no-show). If the account is dead, mark it Out of Process — that removes it from the banner and from the pipeline."
     }
    ]
   }
  ]
 },
 {
  "id": "add-an-account",
  "title": "Add an account",
  "emoji": "➕",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "add account",
   "new account",
   "duplicate",
   "archived name",
   "blacklist",
   "podio check",
   "name worlds",
   "project",
   "product",
   "b2c type",
   "ازاي اضيف اكونت",
   "اكونت جديد",
   "بوديو",
   "rename",
   "edit name",
   "تعديل الاسم"
  ],
  "summary": "The add form checks the name against duplicates, the archive and Podio while you type — here's what each verdict means and what each function must fill.",
  "blocks": [
   {
    "t": "p",
    "md": "Open [Raising](/accounts) → `Add account`. Start typing the name and Sodio runs its checks **live, before you fill anything else** — so you never build a whole form for a name that was burned two peaks ago."
   },
   {
    "t": "steps",
    "items": [
     "**Duplicate check** — if the name is already an active account in your world, you're blocked and shown whose it is.",
     "**Archive / blacklist check** — if the name was moved Out of Process (or manually blacklisted), it's blocked too: the archive IS the blacklist. A TL+ can revive it instead of re-adding.",
     "**Podio check** — Sodio asks the national Podio form's own search. ⚠️ **Already on Podio** means don't submit a duplicate — add it here and ask your MM about the request state (it can be ours!). 🔎 **Not on Podio** means submit it via the linked national form — or flip **`I already submitted it`** right inside that result if you did. If Podio is unreachable you simply get no verdict, plus the manual link. Quotes, dashes and accents don't matter: **Momo's** and **Momo’s** are the same name."
    ],
    "title": "What happens as you type the name"
   },
   {
    "t": "p",
    "md": "**Name worlds, simply:** account names live in three separate worlds — **ICX** (IGV · IGT · B2B), **BD**, and **B2C** — and each world keeps its own archive. A name only has to be unique *within its world*. If the same business is already **active in another world**, you get an amber heads-up (\"already active on IGV — responsible: X\") and you can proceed: different function, different relationship, both real."
   },
   {
    "t": "table",
    "headers": [
     "Function",
     "What the form requires"
    ],
    "rows": [
     [
      "IGV",
      "A **Project** (Skill Up!, Rooted, …) — always required"
     ],
     [
      "IGT",
      "The **product** — GTa or GTe (+ sub product)"
     ],
     [
      "B2B / BD",
      "Pick which **label** the account carries — both behave the same, BD's MOS is money"
     ],
     [
      "B2C",
      "One **Type**: Courses, Events or Student activities — no industry, no product"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "Only work one function? The Function picker hides itself — no point showing you a dropdown with one option. And bulk imports (`Raising → Import`, CSV/XLSX, ≤500 rows) run every row through the exact same checks.",
    "tone": "info"
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**\"Already exists — nobody owns it\"?** Take it right there (v33.37): the verdict carries a **Take it — it's mine now** button that claims the account on the spot, Members included. No need to open a page first."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The name is blocked as archived but it's a genuinely different business.",
      "a": "If it's in a *different world* (say, archived on IGV and you're adding B2C), it's only a heads-up — proceed. Same world? Ask a TL+ to check the archive: they can revive it, or a VP+ can remove a manual blacklist entry."
     },
     {
      "q": "Podio says the partner exists — is it another LC's?",
      "a": "Not necessarily — it can be ours. Add the account in Sodio and ask your MM about the request state; just don't submit a duplicate on Podio."
     },
     {
      "q": "I submitted on Podio before adding the account here.",
      "a": "Type the name, and inside the 🔎 not-on-Podio result flip **`I already submitted it`**."
     },
     {
      "q": "I misspelled the account's name — am I stuck with it?",
      "a": "No — anyone who can edit the account can rename it: the ✏️ beside the title on the account page. The new name goes through the same duplicate/archive/blacklist checks as adding, and the account's link changes with the name (old links keep working, and the rename is logged as a comment). Since v33.40 the rename also travels to the calendar: a pending visit's event and the next-step reminder get the new name."
     }
    ]
   }
  ]
 },
 {
  "id": "visits-booking-and-reminders",
  "title": "Book, move and report a visit",
  "emoji": "📅",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "visit",
   "schedule visit",
   "book a visit",
   "move visit",
   "reschedule",
   "calendar invite",
   "reminder",
   "visit report",
   "follow-up email",
   "زيارة",
   "ازاي احجز زيارة",
   "معاد الزيارة"
  ],
  "summary": "Visits are booked from the contact log with the Visit Scheduled result — Sodio puts them on your Google Calendar, tells your leaders and the crew, and chases you for the report.",
  "blocks": [
   {
    "t": "p",
    "md": "A visit is always the outcome of reaching someone, so it's booked **from the contact log**, not from a separate button. Log the contact, pick the result **Visit Scheduled**, give it a date and time — done. Sodio creates the calendar event, invites your leaders, announces it to your function's crew, and starts the report-chasing clock."
   },
   {
    "t": "diagram",
    "diagramId": "visit-flow",
    "caption": "Contact → Visit Scheduled → the visit → report it"
   },
   {
    "t": "steps",
    "items": [
     "Open the account on [Raising](/accounts) and log the contact (or tap a WhatsApp/Call/Email quick action — it opens the same form).",
     "Pick the result **Visit Scheduled** and set the date + time.",
     "Save. The visit lands on your **Google Calendar** with reminders **24 hours** and **1 hour** before, plus a calendar invite your leaders ride as attendees (no Meet link — visits happen in person)."
    ],
    "title": "Book a visit"
   },
   {
    "t": "p",
    "md": "**Who else hears about it?** Two different things happen. First, the **calendar invite**: a Member's visit invites their Team Leader + the function VP(s) as attendees; a Team Leader's or Coordinator's invites the VP(s). Where a **Director** leads the function (B2B & BD, B2C), the Director rides the invite for their own function's visits. Second, the **announcement** (v33.42, narrowed): a **new booking** reaches the function's **Members** plus the responsible's own Team Leader — not the other MMs, since another team's TL has no call to make about it; a **move** reaches only the responsible's Team Leader, and nobody at all when an MM moves their own visit. LCVPs/Directors join those emails only if their function's defaults say so (they always ride the calendar invite). You can see everyone's visits on the [Calendar](/calendar)."
   },
   {
    "t": "steps",
    "items": [
     "Open the account — the top bar shows **Reschedule visit** while a visit is pending (the History entry has a **Move it** button too).",
     "Pick the new date + time and save. Same visit, same calendar event — the invite updates and the new time reaches everyone on it.",
     "A correction made within 15 minutes stays quiet; a genuine move later announces \"🗓️ Visit moved\" so the crew isn't left with a stale time."
    ],
    "title": "Move a booked visit"
   },
   {
    "t": "p",
    "md": "**After the visit**, a follow-up email arrives about **2 hours later** asking how it went — report the result from the account. If you're a Member or Coordinator, your Team Leader gets that email too. A visit still unreported **one week later** triggers one firmer reminder: report it, or mark the account Out of Process if they're not interested. **Your report** goes to your manager and the function's head — the VP, or the Director for B2B & BD and B2C (B2B and BD count as one function here)."
   },
   {
    "t": "callout",
    "md": "If saving says the calendar reminder couldn't be created, your Google grant is probably dead — **sign in with Google once more** and future visits will link properly. The visit itself is always saved either way.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Where did the Schedule visit button go?",
      "a": "It's gone on purpose — a visit is the result of a contact, so you book it from the contact log with the **Visit Scheduled** result. Only **moving** an already-booked visit is still a button, because there's no new contact to log when just the time changes."
     },
     {
      "q": "Does booking a visit spam other functions?",
      "a": "No. The announcement goes to the account's **own** function crew only (B2B and BD count as one crew). Your TL/VP additionally ride the calendar invite for oversight."
     },
     {
      "q": "I booked the same slot twice by accident — did everyone get two emails?",
      "a": "No. Re-submitting the same slot announces nothing, and a correction within 15 minutes stays quiet too."
     },
     {
      "q": "Why didn't my VP get the visit announcement email?",
      "a": "By design since v33.38 — leaders already receive the calendar invite for every visit, so the function-wide announcement email skips LCVPs and Directors by default. A leader who wants both can flip \"Visit announcements reach me too\" on their Function defaults card."
     },
     {
      "q": "I moved my visit — who was told?",
      "a": "Your Team Leader (and your VP if their function switched announcements on). Nobody else: a time change is not news to the function, and if you're an MM moving your own visit, nobody is notified at all. The calendar invite updates for everyone on it, as always."
     }
    ]
   }
  ]
 },
 {
  "id": "contacts-and-phone-numbers",
  "title": "Contacts, tags & phone numbers",
  "emoji": "📇",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "phone number",
   "whatsapp number",
   "tags",
   "contacts",
   "landline",
   "hotline",
   "+20",
   "international number",
   "paste phone",
   "invalid phone",
   "رقم تليفون",
   "واتساب",
   "رقم مش شغال"
  ],
  "summary": "Every phone, email and link on an account carries a tag, numbers auto-normalize to +20 format, and pasted numbers get cleaned of the invisible characters that used to break them.",
  "blocks": [
   {
    "t": "callout",
    "tone": "warn",
    "md": "**One company, one account (v36.4).** A phone number, email or link that is already on another account — in any function — is refused: you're warned while you type it, and Save stays off until it's gone. Sodio shows you that account (its name, function, who holds it, active or archived), because it is almost always the same company under another name (*abc kindergarten* and *abc pre school*). Work that account instead, or revive it if it is archived. Numbers are compared as digits, so 01012345678 and +20 101 234 5678 are one number; links ignore https://, www. and tracking bits."
   },
   {
    "t": "p",
    "md": "**Search by number.** The Raising search box finds an account by its name *or* by any phone, email or link on it — type part of a number (\"0101234\") or paste a link. **Map links** (Google Maps, including the maps.app.goo.gl links its Share button makes, Apple Maps and Waze) tag themselves **Location** and show the Maps pin."
   },
   {
    "t": "p",
    "md": "An account holds as many contacts as you want, each with a **tag** so everyone knows who they're calling. The tag also powers the quick actions — the WhatsApp button dials the number tagged `Whatsapp` first."
   },
   {
    "t": "table",
    "headers": [
     "Contact kind",
     "Tags available"
    ],
    "rows": [
     [
      "Phones",
      "Contact · Whatsapp · Manager · HR · CEO · Owner · Other"
     ],
     [
      "Emails",
      "Same list, minus Whatsapp (emails don't WhatsApp)"
     ],
     [
      "Links",
      "Website · LinkedIn · Instagram · Facebook · Other"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**Smart auto-tagging:** paste an instagram.com link and it tags itself Instagram; type `ceo@company.com` and it tags itself CEO — same for hr@, manager@, LinkedIn, Facebook and WhatsApp links. Always overridable if the guess is wrong.",
    "tone": "tip"
   },
   {
    "t": "steps",
    "items": [
     "**Egyptian mobiles** normalize themselves to the canonical `+201[0/1/2/5]XXXXXXXX` — type `010...`, `20 10...`, whatever; on blur the field rewrites to what Sodio stored.",
     "**Landlines**: Alexandria numbers become `+203...`, Cairo `+202...`. Landlines are valid contacts — they're just never tagged Whatsapp (no WhatsApp on a desk phone).",
     "**Hotlines** (5-digit short codes like `16123`) are valid too — stored exactly as dialled, never WhatsApp-tagged.",
     "**Anything else** must be a full international number: `+` followed by 7–15 digits."
    ],
    "title": "Phone rules (what the field accepts)"
   },
   {
    "t": "p",
    "md": "**Pasted a number that looks perfect but keeps failing?** That used to happen when numbers copied from Arabic chats carried invisible characters (bidi marks, zero-width spaces). Sodio now strips everything but the `+` and the digits, and the field rewrites itself on blur to exactly what the system sees — so if something's still wrong, you can finally *see* what."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why won't my number save?",
      "a": "Check the rewritten value after you leave the field — that's what Sodio actually received. Egyptian mobiles need a valid prefix (010/011/012/015); foreign numbers need the full `+` international form with 7–15 digits."
     },
     {
      "q": "Which number does the WhatsApp button use?",
      "a": "The one tagged `Whatsapp`, or the first phone if none is tagged. Tag the right one and the whole team taps the right number."
     },
     {
      "q": "Arabic keyboard digits (٠١٢) don't work?",
      "a": "They do — Sodio translates Arabic-Indic digits to ASCII everywhere, including login."
     }
    ]
   }
  ]
 },
 {
  "id": "direct-visits",
  "title": "Direct visits — walked in, log it in one form",
  "emoji": "🚶",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "direct visit",
   "walk in",
   "door to door",
   "street",
   "log past visit",
   "one form",
   "زيارة مباشرة",
   "نزلت شارع",
   "زيارة من غير معاد"
  ],
  "summary": "Knocked on a door with no appointment? The Direct visit form logs the account, the contact and the visit in one go — the outcome you pick decides what happens next.",
  "blocks": [
   {
    "t": "p",
    "md": "Not every partner comes from a research sheet — sometimes you walk a street, find a business, and pitch at the door. Logging that used to mean four screens for something that already happened, so it went unlogged. The **Direct visit** button on [Raising](/accounts) writes all three rows — market research + contact + visit — through the real funnel, so it lands in the pipeline, the leaderboard and the dashboard with no double entry. Nothing is announced: the visit is already over."
   },
   {
    "t": "p",
    "md": "The form is the real door, not a shortcut: the account name runs the same three live checks as **Add account** (duplicates, the archive/blacklist, the Podio look-up with \"I already submitted it\"), and phones/emails go through the real contacts editor with tags. B2C picks from its own three types."
   },
   {
    "t": "table",
    "headers": [
     "Outcome",
     "What Sodio records"
    ],
    "rows": [
     [
      "Turned away at the door",
      "Visit logged as **not done**. Offers Out of Process with a reason — **off by default**, because a refusal at reception is not a verdict on the business."
     ],
     [
      "Come back another time",
      "Books the **return visit** there and then (asks for the date)."
     ],
     [
      "Send the info instead",
      "Sets the account's **next step** to send it."
     ],
     [
      "Got to present",
      "Visit counts as **done**; you can set a follow-up date."
     ],
     [
      "Closed a deal on the spot",
      "Visit done — and the account opens **straight onto the deal form** so you record it while it's warm. 🏆"
     ]
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**v33.37, three upgrades**: ① An **archived** name no longer blocks the log — you were at their door, so the account comes back to you; if they *turned you away*, it stays archived and your attempt is written on it. ② **Come back another time** needs no date: leave it open, or set a date (and optionally a time) and the return visit is booked with a calendar event like any other. ③ **Turned away at the door counts NO visit** — reception blocked it, so nothing lands in visit KPIs; the attempt lives on as the contact."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does a direct visit email the whole crew like a booked visit?",
      "a": "No. Announcements exist so people know what's coming — this visit already happened, so nothing is sent."
     },
     {
      "q": "They refused at the door — is the account archived?",
      "a": "Only if you tick Out of Process yourself. \"Turned away\" alone just logs an undone visit; the account stays workable."
     },
     {
      "q": "The name check says it's archived — can I still log the visit?",
      "a": "An archived name is blocked exactly like in Add account — it's on the blacklist for a reason. Ask a TL+ to revive it first if the situation genuinely changed."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**\"Come back another time\" (v33.39):** the date AND the time are both optional. Leave both empty for a general \"pass by again\"; a **date alone** becomes a next step for that day; **date + time** actually BOOKS the return visit — calendar invite and reminders, like any visit."
   }
  ]
 },
 {
  "id": "log-a-contact",
  "title": "Log a contact (and book visits from it)",
  "emoji": "📞",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "log contact",
   "contact result",
   "no response",
   "waiting for response",
   "not interested",
   "visit scheduled",
   "book visit",
   "edit contact",
   "history",
   "ازاي اسجل مكالمة",
   "حجز فيزيت",
   "مش مهتمين",
   "unassigned",
   "auto assign",
   "take it"
  ],
  "summary": "Every call, WhatsApp and email gets logged with a result — Visit Scheduled books the real visit, Not Interested archives, and honest mistakes are editable from History.",
  "blocks": [
   {
    "t": "p",
    "md": "Open the account → `Contact` (or tap a quick action on the list — it opens the same dialog with the method pre-picked). Choose the method — **Call, WhatsApp or Email** — and the result. That's it: the log entry, the pipeline stage, and any side effects all follow from the result you pick."
   },
   {
    "t": "table",
    "headers": [
     "Result",
     "What it means / does"
    ],
    "rows": [
     [
      "No Response",
      "Nobody picked up. Counts toward the 3-attempt rule."
     ],
     [
      "Waiting for response",
      "You sent a message and the ball's in their court. The **default for WhatsApp & Email** (hidden on Call — a call either connects or it doesn't). Also counts as unanswered."
     ],
     [
      "Responded",
      "They answered, no clear signal yet."
     ],
     [
      "Interested",
      "They want to hear more. Set that next step!"
     ],
     [
      "Not Interested",
      "**Archives the account** (Out of Process) — behind a confirmation, because this is a one-way door for the name."
     ],
     [
      "Wrong Contact",
      "The number/email doesn't reach the business."
     ],
     [
      "Visit Scheduled",
      "Asks for a **date + time** and **books the actual visit** — calendar event on your Google Calendar with 24h + 1h reminders, invite shared with your leaders, and the function crew gets an FYI."
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**There is no separate \"Schedule visit\" button** — a visit is always the outcome of reaching someone, so the contact log is where it's booked. Moving an already-booked visit is different: find the pending visit in History and hit **`Move it`** (same row, same calendar event, new time — no new contact to log).",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "**Made a typo?** Contact attempts are editable from the account's **History** — method, result, note. The two exceptions are `Visit Scheduled` and `Not Interested`: editing those would mean silently un-booking a visit or un-archiving an account, so they stay locked. Move the visit or revive the account through their own doors instead."
   },
   {
    "t": "diagram",
    "diagramId": "visit-flow",
    "caption": "Contact → Visit Scheduled → the visit happens → report it (the +2h email will ask if you forget)"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't I pick \"Waiting for response\" on a call?",
      "a": "Because it means \"I sent a message and I'm waiting\" — a call either connects or it's No Response. It's offered on WhatsApp and Email only."
     },
     {
      "q": "I marked Not Interested by accident!",
      "a": "The account is archived, not deleted. Ask a TL+ — the Archived tab has a revive (Back to active)."
     },
     {
      "q": "Does booking a visit notify people?",
      "a": "Yes: your calendar gets the event with reminders, your TL/VP ride the invite, and your function's raising crew gets an email + bell FYI. Re-saving the same slot or correcting it within 15 minutes announces nothing — no spam."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Working an unowned account takes it (v33.39).** Logging a contact on an unassigned market-research account automatically makes you its Responsible — no more contacts landing on rows that stay nobody's. A toast says so with an **Undo** button; undo hands it back to the pool (the contact itself stays, because it happened)."
   }
  ]
 },
 {
  "id": "next-steps",
  "title": "Next steps & the reminders that follow",
  "emoji": "🗓️",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "next step",
   "follow up",
   "reminder",
   "next week",
   "next working hours",
   "calendar reminder",
   "date",
   "المتابعة",
   "الخطوة الجاية",
   "تذكير"
  ],
  "summary": "Every in-process account needs a dated next step — set it in one tap, and Sodio puts a follow-up event on your Google Calendar so you never have to remember it yourself.",
  "blocks": [
   {
    "t": "p",
    "md": "The golden rule says every in-process account carries a **next step with a date** or a pending visit. The next step lives on the account card and in the Log-contact dialog — write what's next (*\"send the proposal\"*, *\"call the HR back\"*) and give it a date."
   },
   {
    "t": "steps",
    "items": [
     "**`Next week`** — +7 days from today. The most common follow-up window, now one button.",
     "**`Next working hours`** — finds your next booked working-hours session and sets the step to it. \"Call them again during working hours\" is the most common next step there is; now the account resurfaces exactly when you sit down to work.",
     "Or just pick any date (and optionally a time) by hand."
    ],
    "title": "Setting the date in one tap"
   },
   {
    "t": "callout",
    "md": "**The calendar does the remembering.** Whenever a next step gets a date, Sodio upserts a follow-up event on your Google Calendar — at the step's time, or at **11:00** when you set only a date. Change the step and the event moves; clear it (or archive the account — by the button, a *Not Interested* result or a Podio *Rejected*) and the event disappears, along with a pending visit's invite. One step, one event, always in sync.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "The next step also shows as a column on the [Raising](/accounts) list, so a leader scanning the table sees instantly which accounts have a plan and which are drifting. An empty next step with no pending visit is the first thing a VP will ask you about."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I set a next step but got no calendar event.",
      "a": "The event lands on your own Google Calendar via your Google grant — if you removed Sodio's access, sign in with Google once more. Steps without a date create no event: the date is the reminder."
     },
     {
      "q": "What time does a date-only step remind me?",
      "a": "11:00 that day. Give the step a time if you want it elsewhere."
     },
     {
      "q": "Does a pending visit need a next step too?",
      "a": "No — a pending visit satisfies the golden rule by itself. The next step takes over after the visit is reported."
     }
    ]
   }
  ]
 },
 {
  "id": "quick-actions",
  "title": "Quick actions: WhatsApp, call & email in one tap",
  "emoji": "⚡",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "quick actions",
   "whatsapp button",
   "call button",
   "email button",
   "whatsapp opener",
   "ready message",
   "one tap",
   "واتساب",
   "اتصال سريع",
   "رسالة جاهزة"
  ],
  "summary": "The buttons on every account row open WhatsApp, the dialer or email instantly — WhatsApp comes with a ready-to-send opener, and each tap also opens the contact log so nothing goes unrecorded.",
  "blocks": [
   {
    "t": "p",
    "md": "Every row on the [Raising](/accounts) list ends with quick actions built from the account's tagged contacts. One tap opens the channel — no copying numbers around."
   },
   {
    "t": "table",
    "headers": [
     "Button",
     "What it opens"
    ],
    "rows": [
     [
      "WhatsApp",
      "The number tagged `Whatsapp` — or the first phone if none is tagged"
     ],
     [
      "Call",
      "The first non-WhatsApp phone"
     ],
     [
      "Email",
      "The first email on the account"
     ],
     [
      "Link icons",
      "One icon per saved link (Website, LinkedIn, Instagram, Facebook)"
     ],
     [
      "…",
      "Everything that didn't fit collapses into the overflow menu"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**The WhatsApp opener is pre-written.** The chat opens with: *\"Hello! This is {your name} from AIESEC, the world's largest youth-led organization. I'm reaching out about a collaboration with {account}.\"* — edit it or just hit send. No more staring at an empty chat wondering how to start.",
    "tone": "tip"
   },
   {
    "t": "p",
    "md": "**Tapping a quick action also opens the real contact dialog** with the method pre-selected — WhatsApp tap, WhatsApp pre-picked, all results available (including the branching ones like `Visit Scheduled` and `Not Interested`). Send the message, then log what happened while it's fresh. An unlogged contact is a contact that never happened as far as your funnel knows."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The WhatsApp button opens the wrong number.",
      "a": "Tag the right number `Whatsapp` on the account's contacts — the button always prefers the tagged one."
     },
     {
      "q": "Some rows have no Call/WhatsApp button at all.",
      "a": "The account has no usable phone — the buttons only render for real numbers. Add one from the account page."
     },
     {
      "q": "Do I have to log the contact after tapping?",
      "a": "The dialog opens to make it one tap, and yes you should — the golden rule, the pipeline stage and your leaderboard numbers all read from the log, not from your WhatsApp history."
     }
    ]
   }
  ]
 },
 {
  "id": "record-a-deal",
  "title": "Record a deal (and split the opens)",
  "emoji": "🏆",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "deal",
   "record deal",
   "opens",
   "slots",
   "split opens",
   "BD money",
   "EGP",
   "amount",
   "benefits",
   "B2C deal",
   "edit deal",
   "ديل",
   "ازاي اسجل ديل",
   "اوبنز"
  ],
  "summary": "Accounts can close many deals over time — each one records its opens per product, can be raised for IGV or IGT whichever you personally work, can split credit across members, and BD deals carry money instead.",
  "blocks": [
   {
    "t": "p",
    "md": "**Deals are many-per-account.** 3 slots today and 6 next month = 2 deals, 9 slots — the account stays fully workable after each one (more contacts, more visits, more deals). Every deal belongs to the account's **Responsible**, whoever clicked the button. And yes, there's confetti. 🎉"
   },
   {
    "t": "steps",
    "items": [
     "Open the account and hit **Deal signed** (or **New deal** if it's not the first).",
     "On an IGV or IGT account, answer **\"These opens were raised for\"** first — IGV or IGT. It starts on the account's own, and you only change it when the enabler bought the *other* programme (see below).",
     "Enter the opens **per product**: an IGV open is an IGV open, an IGT one splits GTa + GTe, and a **B2B/BD account can mix all three** — those per-product opens feed the IGV/IGTa/IGTe dashboard lanes.",
     "Optionally flip **Split the opens between members** to share the credit — on an ICX account you can pick from **both** the IGV and the IGT crew, and give each their share (the splits must sum exactly; the server checks). Default is 100% to the Responsible.",
     "Attach the contract now or later, save, enjoy the confetti."
    ],
    "title": "Record it"
   },
   {
    "t": "table",
    "headers": [
     "Function",
     "What a deal needs"
    ],
    "rows": [
     [
      "IGV / IGT",
      "Which of the two the opens were **raised for**, then the opens per product; splits optional."
     ],
     [
      "B2B",
      "Opens across IGV / IGTa / IGTe — the mix is the point."
     ],
     [
      "BD",
      "**Amount in EGP (required)** + optional benefits — money is BD's MOS. Opens are optional, behind a switch that starts off."
     ],
     [
      "B2C",
      "No details at all: the popup links the contract Google Form and offers one **Deal signed** button. No opens, no splits, no amount."
     ]
    ]
   },
   {
    "t": "p",
    "md": "**They bought the other programme? Say so.** IGV and IGT knock on the same doors, and the enabler decides. You walk in as IGT, they say no to a teacher and yes to a volunteer — that is an **IGV open**, raised by you. Set *These opens were raised for* to **IGV** and three things happen at once: the opens count as IGV (they feed the IGV lane and the IGV VP's numbers), **the account moves to IGV** so it stops sitting in the wrong VP's pipeline, and a line saying exactly that is written onto the account's history. **You keep the account and you keep the opens** — whichever function you personally work. It works the other way round too, and it works on the Details card *before* the deal: switch **Function** there mid-conversation and the proposal email, the product badge and the pipeline all follow."
   },
   {
    "t": "p",
    "md": "**Made a mistake?** Every deal's History entry has an edit button — note, amount & benefits, and its opens (the account's counters recompute). Split numbers show in the history as \"Opens split: A (3) · B (3)\" when custom."
   },
   {
    "t": "callout",
    "md": "Splits drive every per-member number — leaderboards, the members directory, period reports, \"My numbers\" — while lane totals come from the deal's per-product columns. So splitting fairly is how everyone's work shows up.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who gets the credit if my TL clicks the button?",
      "a": "The account's **Responsible** — never the person clicking. Use the split switch if several people genuinely raised those opens."
     },
     {
      "q": "Why won't it let me record a deal on an unassigned account?",
      "a": "An unassigned account has nobody to credit — ask a leader to assign it first (or record with an explicit split)."
     },
     {
      "q": "Does a deal close the account?",
      "a": "No. Accounts keep working after a deal — many partners sign again next month."
     },
     {
      "q": "I'm IGT and my enabler took an IGV open. Do I lose it?",
      "a": "No. Pick **IGV** under *These opens were raised for* — the open counts for IGV, the account moves to IGV, and both stay yours. You do not have to be in a function to hold its opens."
     },
     {
      "q": "The account left my VP's dashboard after I recorded the deal. Is that a bug?",
      "a": "No — that's the move doing its job. An account whose opens are IGV belongs in IGV's pipeline; the account's own history says when it moved and who moved it. Switch **Function** back on the Details card if it was picked by mistake."
     }
    ]
   }
  ]
 },
 {
  "id": "proposal-emails",
  "title": "Send a proposal email",
  "emoji": "✉️",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD)",
  "audienceKeys": [
   "raising",
   "b2b"
  ],
  "keywords": [
   "proposal",
   "proposal email",
   "gmail draft",
   "pdf attach",
   "partner email",
   "pitch email",
   "بروبوزال",
   "ميل للشركة",
   "عرض شراكة"
  ],
  "summary": "The Proposal email button builds a branded, product-aware pitch and sends it from YOUR own Gmail — with a See-it-first preview of the exact letter, inside Sodio.",
  "blocks": [
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Edit the letter itself.** In **See it first**, click anywhere in the letter — or in the subject — and type. What you change there is exactly what gets sent. **Keep editing** takes you back to the fields without losing those changes; change a field and the letter is rebuilt from it. Under the recipient there are **CC** and **BCC** fields — separate several addresses with commas."
   },
   {
    "t": "p",
    "md": "Every raising account has a **Proposal email** button. Fill the popup — recipient, sector, an optional custom note — and Sodio **sends it straight from your own Gmail**. It leaves *your* address, so the reply comes back to you and the email sits in your Sent folder; Sodio is the stationery, not the sender. Want to read it before it goes? **See it first** renders the exact letter the company will receive, right there in Sodio, with **Send** underneath it — no trip to Gmail, no drafts folder to forget about. The account is marked `proposal_sent` and nothing else moves — a proposal never changes ownership or stage."
   },
   {
    "t": "steps",
    "items": [
     "Open the account → **Proposal email**. The product (iGV / iGTa / iGTe / B2B) is auto-detected and the company prefilled.",
     "Check the **proposals to attach**. The deck follows the email you're writing — a B2B email carries the **B2B proposal**, an iGV email the iGV deck — and you can tick any of the four on top. The popup shows the total MB, because an email can only carry about 17 MB of attachments.",
     "Not sure about the wording? Hit **See it first** — the same code that sends builds the preview, so what you read is exactly what lands in their inbox. Then **Send it now** from the preview, or *Keep editing*."
    ],
    "title": "Send one"
   },
   {
    "t": "table",
    "headers": [
     "Account",
     "The email you get"
    ],
    "rows": [
     [
      "IGV / IGTa / IGTe",
      "That product's pitch, in the LC's colours, signed as Global Volunteer / Talent / Teacher Manager."
     ],
     [
      "B2B",
      "A **general all-programs** variant linking to aiesec.org/partners by default, with the **B2B proposal PDF attached** — you can still pick a specific product's body, and the deck follows it. Signed Business Development Manager."
     ],
     [
      "BD",
      "The **Talent Solutions** pitch — and nothing attaches, because there is no BD deck. You can still tick one of the four by hand."
     ],
     [
      "B2C",
      "None. B2C runs on the contract form, not proposals — the button is hidden and the server refuses it."
     ]
    ]
   },
   {
    "t": "callout",
    "md": "If sending fails with a permissions error, your Google grant predates the `gmail.compose` scope — **sign in with Google once** and try again.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why is there no \"Dear …\" line?",
      "a": "By request — the email opens straight into the pitch, so there's no name to get wrong."
     },
     {
      "q": "Does the recipient see it came from Sodio?",
      "a": "No. It's a normal email from your own Gmail, sitting in your Sent folder, with replies coming back to you."
     },
     {
      "q": "Can I see the email before it goes?",
      "a": "Yes — **See it first**. It shows the exact letter, subject and attachment list, without leaving Sodio; **Send it now** is right under the preview."
     },
     {
      "q": "Where did \"leave it in my Gmail drafts\" go?",
      "a": "Gone in v34.10. It existed so you could re-read the letter first — but it did that by sending you out to Gmail, and the proposal usually stayed there unsent. **See it first** does the reading; the send is one click away in the same popup."
     },
     {
      "q": "Can I change the wording itself?",
      "a": "The pitch body is the LC's standard one, per product. What's yours is the **custom note** — it drops into the email above the meeting request. For a letter written from scratch, use the [Emails](/emails) tab instead."
     }
    ]
   }
  ]
 },
 {
  "id": "archive-and-blacklist",
  "title": "The archive IS the blacklist",
  "emoji": "🗄️",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "archive",
   "blacklist",
   "out of process",
   "OOP",
   "revive",
   "back to active",
   "delete account",
   "import archived",
   "bulk archive",
   "bulk reassign",
   "ارشيف",
   "بلاك ليست",
   "خارج العملية"
  ],
  "summary": "Out-of-Process accounts are hidden and un-re-addable — the whole LC can read the archive, TL+ can revive, and burned names from before the CRM can be blacklisted by hand.",
  "blocks": [
   {
    "t": "p",
    "md": "There is no separate blacklist: an account marked **Out of Process** disappears from the working lists and its name can't be re-added — that *is* the blacklist. Reasons come from a fixed pick-list (Not responding, Financial issues, Not Interested, Backed out, Blacklisted, …) plus **Other** with free text. Two things archive automatically, each behind a warning: the contact result **Not Interested**, and the Podio request state **Rejected**."
   },
   {
    "t": "p",
    "md": "**Everyone can read it.** The Archived tab on [Raising](/accounts) is LC-wide: any member can browse every archived name and open any archived account **read-only** — so nobody wastes a week on a partner the LC burned last term. Editing stays scoped as usual. Names live in **three worlds** — ICX raising (IGV/IGT/B2B), BD, and B2C — each with its own archive, so an IGV namesake never blocks a B2C account."
   },
   {
    "t": "steps",
    "items": [
     "Open the Archived tab and find the account (search works).",
     "Hit **Back to active** — with the confirm, it returns to the raising process, next-step reminders included.",
     "Select several rows to revive in bulk; VPs/Directors/LCP can instead **Delete** selected archived accounts permanently, which frees the name for good."
    ],
    "title": "Bring one back (TL and above)"
   },
   {
    "t": "steps",
    "items": [
     "**Add archived** blacklists a single name — the reason is optional.",
     "**Import archived** takes a CSV/XLSX with Name + optional Reason, shows an editable preview, and imports up to **1000 rows** — free-form reasons are kept as-is.",
     "Either way the name now blocks re-adding exactly like an OOP account. A VP+ can remove an entry later."
    ],
    "title": "Blacklist names from before the CRM (TL and above)"
   },
   {
    "t": "p",
    "md": "**Bulk operations on the active list**: hit **Select**, tick rows (desktop shows the checkboxes always), and the action bar offers **Archive**, **Assign to…** or **✏️ Edit**. **Edit** moves the selected accounts to another function you work and/or adds the same comment to each one, under your name — up to 50 at a time; anything you can't change on an account is skipped and you're told why. Reassigning has an **\"Email them about it 📬\"** toggle — on by default — that sends the new responsible the account list; it stays quiet when you assign to yourself. Every row still passes the normal permission checks individually."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't I add an account — it says archived?",
      "a": "That name is on the blacklist (OOP or manually added). If the situation truly changed, ask a TL+ to revive it from the Archived tab rather than creating a duplicate."
     },
     {
      "q": "Who can permanently delete an archived account?",
      "a": "VP/Director/LCP, from the Archived tab's bulk Delete — it removes the account and all its history and frees the name. There is no undo, which is why revive is the default answer."
     },
     {
      "q": "Does archiving delete the account's data?",
      "a": "No — everything stays and is readable by the whole LC. Only permanent delete removes data."
     },
     {
      "q": "I archived by mistake from a bulk action — now what?",
      "a": "Open the Archived tab, find it, **Back to active**. Ownership and history are untouched."
     }
    ]
   }
  ]
 },
 {
  "id": "raising-cycle-overview",
  "title": "The raising cycle, start to finish",
  "emoji": "🔄",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "pipeline",
   "funnel",
   "lead",
   "stages",
   "raising cycle",
   "golden rule",
   "out of process",
   "oop",
   "deal",
   "visit",
   "next step",
   "الفانل",
   "ازاي اشتغل",
   "مراحل الاكونت"
  ],
  "summary": "How an account moves from Lead to Deal Done, and the one golden rule that keeps your pipeline honest.",
  "blocks": [
   {
    "t": "p",
    "md": "Every account lives in a pipeline, and its stage is **derived from what you actually did** — you never set it by hand. Add the account, log contacts, book a visit, report it, record the deal. The stage follows."
   },
   {
    "t": "diagram",
    "diagramId": "pipeline",
    "caption": "Lead → Contacted → Visit Scheduled → Visit Done → Deal Done (exit lane: Out of Process)"
   },
   {
    "t": "table",
    "headers": [
     "Stage",
     "What puts an account there"
    ],
    "rows": [
     [
      "Lead",
      "The account exists — market research, nothing logged yet"
     ],
     [
      "Contacted",
      "You logged at least one contact attempt"
     ],
     [
      "Visit Scheduled",
      "A visit is booked (via the contact result `Visit Scheduled`)"
     ],
     [
      "Visit Done",
      "You reported the visit as completed"
     ],
     [
      "Deal Done",
      "You recorded a deal — and the account stays workable for more"
     ],
     [
      "Out of Process",
      "Archived: Not Interested, Podio Rejected, or a manual OOP with a reason"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**The golden rule:** every in-process account carries a **next step with a date** or a **pending visit**. An account with neither is an account nobody is working. And after **3 unanswered contact attempts**, Sodio prompts you to move it Out of Process — no wasted resources.",
    "tone": "warn"
   },
   {
    "t": "p",
    "md": "Deals are **many per account**: 3 slots today and 6 next month is two deals, nine slots. Recording a deal never closes the account — keep contacting, visiting, and dealing. The archive is also the blacklist: an Out-of-Process name can't be re-added, but any member can browse the whole LC's archive read-only, and a TL+ can revive one."
   },
   {
    "t": "callout",
    "md": "Walked into a business and pitched at the door? Use **Direct visit** on [Raising](/accounts) — one form writes the account, the contact and the visit in one go, so work that already happened still lands in your funnel. And if you have visits nobody reported, Raising shows a **\"N visits need a report\"** banner — clear it before it clears your credibility.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can I move an account's stage manually?",
      "a": "No — the stage is computed from your logged work. Want it at Visit Scheduled? Log a contact with result `Visit Scheduled`. Want Deal Done? Record the deal."
     },
     {
      "q": "Does a deal end the account?",
      "a": "Never. The account stays fully workable — more contacts, more visits, more deals. Partners renew."
     },
     {
      "q": "What counts as an \"unanswered\" attempt?",
      "a": "`No Response` and `Waiting for response` both count. Three of those with nothing in between and Sodio suggests Out of Process."
     }
    ]
   }
  ]
 },
 {
  "id": "deal-contracts",
  "title": "Upload and view deal contracts",
  "emoji": "📎",
  "category": "raising",
  "audience": "Raising crews (IGV · IGT · B2B/BD · B2C)",
  "audienceKeys": [
   "raising",
   "b2b",
   "b2c"
  ],
  "keywords": [
   "contract",
   "upload contract",
   "deal file",
   "attachment",
   "pdf",
   "signed link",
   "contracts button",
   "عقد",
   "ارفع العقد",
   "كونتراكت"
  ],
  "summary": "Attach the signed contract to a deal — any file format, at record time or later — and open it from the Contracts button whenever you can view the account.",
  "blocks": [
   {
    "t": "p",
    "md": "A deal can carry its paperwork: **any file format**, up to **10 files per deal, 25 MB each**. Files go straight from your browser to private storage — they never sit on a public link."
   },
   {
    "t": "steps",
    "items": [
     "While recording the deal, drop the files into the upload zone — or come back any time and add them from the deal's **History entry**.",
     "Wait for the upload to finish (big scans over 25 MB need compressing first).",
     "Done — the account now shows a **Contracts** button; anyone who can view the account can preview or download through a short-lived signed link."
    ],
    "title": "Attach a contract"
   },
   {
    "t": "callout",
    "md": "Executable and active-content files (like `.html` or `.exe`) are rejected for safety — a scan, photo, PDF or document is what belongs here.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I forgot to upload at record time — is it too late?",
      "a": "Never. Open the account's History, find the deal, and add the files from there."
     },
     {
      "q": "Who can see the contract?",
      "a": "Anyone who can view the account — same visibility rules as everything else on it. View links are signed and expire after 10 minutes, so a copied URL goes stale fast."
     },
     {
      "q": "My file is 30 MB and won't upload.",
      "a": "The cap is 25 MB per file. Compress the scan (lower the resolution or export a smaller PDF) and try again."
     }
    ]
   }
  ]
 },
 {
  "id": "cic-second-calls",
  "title": "CIC — the second call (and B2C's selling call)",
  "emoji": "📲",
  "category": "ogx",
  "audience": "OGX crews & B2C",
  "audienceKeys": [
   "ogx",
   "b2c"
  ],
  "keywords": [
   "CIC",
   "second call",
   "customer interview call",
   "second caller",
   "b2c cic",
   "selling call",
   "assign 2nd caller",
   "take the call back",
   "المكالمة التانية",
   "سيك",
   "b2c caller",
   "b2c outcome",
   "rang them again"
  ],
  "summary": "CIC hands a contacted-but-status-less sign-up to a second caller to verify and follow up — the first assignee keeps the row and their KPIs, and B2C runs its own selling calls on the same pool.",
  "blocks": [
   {
    "t": "p",
    "md": "**CIC = Customer Interview Calls.** A sign-up held by a real member whose **Contacted was answered — Yes *or* No** — but that never got a status shows up in the **📞 CIC** tab on [Sign-ups](/signups). (A \"No\" is a call that happened and didn't land — exactly what a second call re-tries. A row still in the unassigned pool is waiting for its *first* call and never appears here.)"
   },
   {
    "t": "callout",
    "md": "**It is not a hand-over.** The sign-up stays with its first assignee and keeps counting for them — the second call lives in its own columns. On credit: both callers carry the sign-up and the *contact*; the *outcome* (Applied → Approved) counts for whoever took it there.",
    "tone": "info"
   },
   {
    "t": "steps",
    "items": [
     "Open **📞 CIC** and pick rows — one at a time via the inline caller select, or select several → **Assign 2nd caller…** for a whole batch.",
     "The caller pool is the whole function; the second caller gets a bell and can open the sign-up read-only, plus its full history.",
     "Recording the call's answers closes it. Handed to the wrong person? **Take the call back** returns it to the queue — the first assignee and their numbers are untouched either way.",
     "The 🙋 Mine chip in the CIC tab shows exactly the second calls handed to *you*."
    ],
    "title": "Handing out second calls (MMs and above)"
   },
   {
    "t": "p",
    "md": "**🛍️ B2C rides the same pool — to sell, never to verify.** The B2C crew opens Sign-ups → 📞 CIC across *both* OGX sides (the **Both** chip is their default; OGT/OGV only narrow) and pitches courses, events and student activities to people the first OGX call already reached. A B2C TL hands calls to themself or their team, a Coordinator takes them themself, the LCVP/Director hands to anyone in B2C. One sign-up can carry an open OGX second call *and* an open B2C call at once."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**The B2C caller and the outcome stay put (v37.4).** The B2C columns always show the sign-up's *latest* B2C call: recording an outcome no longer clears the caller, and picking the same caller again doesn't start a new call or wipe the outcome. A recorded outcome stays editable in the cell. Pick a *different* caller after an outcome and they get a **new** call — the earlier one stays in the history under whoever made it, and the cell shows it underneath (\"before: Busy · Salma\"). Ringing the same person again yourself? Use **+ Rang them again** on the sign-up, or just tap Call/WhatsApp — the prompt opens a new call when the last one is already recorded."
   },
   {
    "t": "callout",
    "md": "**The history always says which side rang.** Every hand-out and every answer lands in the sign-up's History side-tagged — OGX rows and B2C rows never blur, and the OGX funnel is never moved by a B2C call. The B2C dashboard lane has its own CIC card: handed out · called · interested · per caller.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why isn't a sign-up I expected showing in the CIC tab?",
      "a": "Three gates: it must be held by a real member (not the pool), Contacted must be answered (Yes or No), and it must have no status yet. If it already reached Applied, the second call has nothing left to verify. Your VP can also switch the CIC queue off entirely for the function."
     },
     {
      "q": "Does the second caller take over my sign-up?",
      "a": "Never — the row, the contact credit and the KPIs stay yours. Only the outcome (moving it to Applied → Approved) credits whoever actually took it there."
     },
     {
      "q": "I'm B2C — why do I only see the CIC view on Sign-ups?",
      "a": "By design: your job there is the selling call, not the OGX funnel. You see both sides' queues, open sign-ups read-only, and record on your own side-tagged rows."
     }
    ]
   }
  ]
 },
 {
  "id": "signup-referrals",
  "title": "Referrals — sign-ups that never met the tracker",
  "emoji": "🤝",
  "category": "ogx",
  "audience": "OGV & OGT crews",
  "audienceKeys": [
   "ogx"
  ],
  "keywords": [
   "referral",
   "referrals",
   "add referral",
   "organic",
   "walk-in",
   "friend",
   "ريفرال",
   "حد جالنا من برا",
   "اضيف حد مش في الشيت",
   "edit referral",
   "fix country"
  ],
  "summary": "Add referral logs someone who came to us directly as a real sign-up — with the first funnel steps filled up front — that counts everywhere but never goes near the tracker sheet.",
  "blocks": [
   {
    "t": "p",
    "md": "A friend, a walk-in, an EP another member sent our way — someone we can approve who never came through the sign-up form used to live in WhatsApp and count nowhere. **Add referral** on [Sign-ups](/signups) makes them a real sign-up from birth: assigned, on the dashboard, on the leaderboard."
   },
   {
    "t": "steps",
    "items": [
     "Hit **Add referral** (pick OGT or OGV if you work both). Their **name** is required; a **phone or an email** — one is enough, but without either nobody can reach them.",
     "Optionally add **date of birth**, **country** (resolved against the real country list, like a booking), **Sub product** (OGT: GTa/GTe) and **who referred them**.",
     "Because you've usually already spoken to them, the first funnel steps are right there: **Contacted · Interested · Status** — no re-opening the row to say what you already know. Contacted = Yes stamps the contact date.",
     "Leaders can pick **who works it**; everyone else works it themselves. Drop a first note and save."
    ],
    "title": "Add one"
   },
   {
    "t": "callout",
    "md": "**Referrals never touch the tracker.** There is no sheet row behind them, so the sync can't import, overwrite or write them back — ever. The list shows **🤝 Referral** where the EP id would be, and the **🤝 Referrals** tab keeps them together: yours if you're a member, your team's if you're a TL, the function's if you lead it.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "From that moment it's a sign-up like any other — comments, CIC, the potential flow, and every number on the OGX dashboard counts it (the dashboard even says how many of the sign-ups are referrals). **Parents Approval still needs a VP**, exactly like everywhere else."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't I see the Add referral button?",
      "a": "Your VP decides who may log one from their function settings: the whole crew, or MMs and above (TLs, Coordinators and up). If it's the latter, send yours to your TL and they'll log it."
     },
     {
      "q": "Will the referral appear on the tracker sheet?",
      "a": "Never — it has no sheet row and the sync is built to skip it in both directions. It lives, and counts, only in Sodio."
     },
     {
      "q": "The date of birth wouldn't save.",
      "a": "It's validated as a real date on purpose — a half-typed year must not be stored as fact. It's optional; skip it if you're not sure."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**A referral's details are yours to fix (v33.41).** Everything on a referral was typed by whoever logged it, so whoever works the row can correct it — name, phone, email, date of birth, country and (OGT) sub product — from **Edit details** at the top of the sign-up. The old VP gate stays where it belongs: on tracker sign-ups, whose columns the sheet owns."
   }
  ]
 },
 {
  "id": "signup-potential-flow",
  "title": "The potential flow — Applied → Accepted → Approved",
  "emoji": "🎯",
  "category": "ogx",
  "audience": "OGV & OGT crews",
  "audienceKeys": [
   "ogx"
  ],
  "keywords": [
   "applied",
   "accepted",
   "approved",
   "approval",
   "MOS",
   "potential",
   "status",
   "parents approval",
   "ابروفال",
   "ستاتس",
   "approved ازاي"
  ],
  "summary": "Whoever owns a sign-up moves it Applied → Accepted → Approved right from the details — Approved is the MOS, Parents Approval stays VP-only, and none of it ever touches the sheet.",
  "blocks": [
   {
    "t": "p",
    "md": "**No waiting on a VP.** The sign-up's **owner** moves it through **Applied → Accepted → Approved** straight from the details dialog (a TL, VP or the LCP can too). **Approved is the MOS** 🏆 — accepted by the host entity, paid, contract signed, ready to start the travel process. Your real Approvals count shows on the [members directory](/members) and drives the Approvals leaderboard on [/dashboard](/dashboard)."
   },
   {
    "t": "callout",
    "md": "**These statuses live only in Sodio.** The tracker sheet's Status cell only ever carries *Out of Process* or nothing — Applied/Accepted/Approved are never written back. So the sheet can't overwrite your pipeline, and the pipeline can't confuse the sheet.",
    "tone": "info"
   },
   {
    "t": "table",
    "headers": [
     "Status",
     "Who sets it"
    ],
    "rows": [
     [
      "Parents Approval",
      "VP/Director only — it lives in the VP fields"
     ],
     [
      "Applied",
      "The sign-up's owner (or TL/VP/LCP)"
     ],
     [
      "Accepted",
      "The sign-up's owner (or TL/VP/LCP)"
     ],
     [
      "Approved ★",
      "The sign-up's owner (or TL/VP/LCP) — this is the MOS"
     ]
    ]
   },
   {
    "t": "p",
    "md": "The **🎯 Potential** filter finds every sign-up sitting at a given stage in one tap — your end-of-sprint chase list, ready-made."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't I set Parents Approval?",
      "a": "It's deliberately VP-only — it's a judgment call the function's leader signs off on. Everything from Applied onward is yours as the owner."
     },
     {
      "q": "I moved someone to Approved by mistake.",
      "a": "Open the details and set the status back — the owner (or a leader) can move it in either direction."
     },
     {
      "q": "Does Approved show up on the sheet?",
      "a": "No. The sheet only ever sees Out of Process in its Status cell; Approved lives in Sodio and counts on the dashboard, the leaderboard and the members directory."
     }
    ]
   }
  ]
 },
 {
  "id": "signups-module",
  "title": "The sign-ups module — how it all fits",
  "emoji": "✈️",
  "category": "ogx",
  "audience": "OGV & OGT crews",
  "audienceKeys": [
   "ogx"
  ],
  "keywords": [
   "sign-ups",
   "signups",
   "tracker",
   "sheet sync",
   "unassigned",
   "pool",
   "EP",
   "OGV",
   "OGT",
   "views",
   "tabs",
   "mine",
   "السيناب",
   "التراكر",
   "وين الساينب بتاعي"
  ],
  "summary": "Sign-ups is your OGX workspace: the tracker sheet imports every 15 minutes, your edits write straight back, and the tabs split the pool into what needs you.",
  "blocks": [
   {
    "t": "p",
    "md": "**[Sign-ups](/signups) and the tracker sheet are the same data behind two doors.** Every 15 minutes the tracker tabs import into Sodio (OGT's New/Old SUs; OGV's **New** 26.2 sheet, **Old** 26.1 Main and **Older** 26.1 Old — filter them with the **Batch** funnel), and every edit you make in Sodio — Contacted, Interested, a comment — is written straight back to the sheet's own cells. You never have to choose where to work; the sheet just follows."
   },
   {
    "t": "callout",
    "md": "**The ownership rule (`sodio_touched`):** a sign-up's intake data (name, phone, program, batch…) always belongs to the sheet. But the moment anyone touches a row in Sodio, its **workflow fields** — assignee, Contacted, Interested, comments — belong to Sodio, and the importer stops overwriting them. So a stale cell on the sheet can never undo your work.",
    "tone": "info"
   },
   {
    "t": "diagram",
    "diagramId": "signup-funnel",
    "caption": "Every sign-up walks the same road: Sign-up → Contacted → Interested → Applied → Accepted → Approved."
   },
   {
    "t": "table",
    "headers": [
     "View",
     "What's in it"
    ],
    "rows": [
     [
      "🆕 Unassigned",
      "The pool — sign-ups nobody holds yet. Contact one and it's yours (unless your VP closed self-claiming)."
     ],
     [
      "My sign-ups",
      "What you answer for. The 🙋 Mine chip gets you here in one tap from anywhere."
     ],
     [
      "My team",
      "Team Leaders only — the whole team's rows."
     ],
     [
      "📞 CIC",
      "Second calls — sign-ups that were contacted but never got a status, handed to a second caller."
     ],
     [
      "🤝 Referrals",
      "People who came to us directly, never through the tracker."
     ],
     [
      "All",
      "Every sign-up in the function (VPs/Directors — or roles your VP opened the floor to)."
     ],
     [
      "🗄️ Archived",
      "Out of Process — browsable, revivable by a VP."
     ]
    ]
   },
   {
    "t": "p",
    "md": "Members see their own rows plus the pool, Team Leaders their team, leaders the whole function. If you filed an MM plan, a card above the list shows this month's **plan vs your live pipeline** — the Approvals bar is your MOS race. Your function's full dashboard (funnel, conversions, Approvals leaderboard) lives on [/dashboard](/dashboard)."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I edited a cell on the sheet — why didn't it change in Sodio?",
      "a": "If the row was ever touched in Sodio, its workflow fields (assignee, Contacted, Interested, status) belong to Sodio and the import leaves them alone. Intake data (phone, program…) still syncs from the sheet. Make workflow edits in Sodio — they land on the sheet within seconds."
     },
     {
      "q": "How fresh is the list?",
      "a": "The tracker imports every 15 minutes (and pauses overnight). Leaders also have a manual Sync now button when they can't wait."
     },
     {
      "q": "Why don't I see the All tab?",
      "a": "All is for VPs/Directors — unless your VP has opened whole-function visibility to your role from their function settings. Ask them if your work genuinely needs it."
     }
    ]
   }
  ]
 },
 {
  "id": "ogx-streak",
  "title": "The 🔥 streak — one contact a day keeps it alive",
  "emoji": "🔥",
  "category": "ogx",
  "audience": "OGV & OGT crews",
  "audienceKeys": [
   "ogx"
  ],
  "keywords": [
   "streak",
   "fire",
   "daily",
   "contact streak",
   "nag",
   "reminder",
   "top streaks",
   "board",
   "ستريك",
   "النار",
   "ايميل الستريك",
   "abuse",
   "referral streak"
  ],
  "summary": "Mark at least one of your sign-ups Contacted every day to keep your streak; the board ranks the LC's hottest, and a funny evening email warns you before midnight kills it.",
  "blocks": [
   {
    "t": "p",
    "md": "**The rule is one line:** a day counts when at least one sign-up you hold gets marked **Contacted — Yes** that day. Do that daily and your streak grows; miss a day and midnight resets it. The 🔥 card lives on [Sign-ups](/signups) and on your [dashboard](/dashboard) lane — greyed-out flame means today isn't saved yet."
   },
   {
    "t": "p",
    "md": "**The board is a real ranking:** numbered rows, medals for the top three, the day count front and center, and — on the joint OGX board — each person's side in its own colour (OGV red, OGT teal), with **OGX / OGT / OGV** chips to narrow it. Under your own number you'll see **Your best**, or \"No streak yet — today can be day 1\" if you haven't started."
   },
   {
    "t": "callout",
    "md": "**The evening guardian:** sitting on a 3+ day streak with nothing logged by ~7 PM Cairo? A (deliberately funny) email + bell lands warning you the streak dies at midnight — once per day, never more. One contact saves it.",
    "tone": "tip"
   },
   {
    "t": "callout",
    "md": "The streak is derived from your **live** sign-ups — if a contact gets undone, that day quietly stops counting. And the nag email is your VP's call: they can switch it off for the whole function from their settings (the streak and the board stay either way).",
    "tone": "info"
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**What saves it, exactly** (v33.37): a sign-up marked **Contacted** that day — that's the one action that counts (comments and claims don't). The board shows only ALIVE streaks; a row with **⏳ not saved today** is on its grace day and dies at midnight unless its owner contacts someone."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Do comments or claims save the streak?",
      "a": "No — the streak reads contacted sign-ups: at least one of your rows marked Contacted = Yes that day. The contact is the work the streak celebrates."
     },
     {
      "q": "I'm OGT — is the streak OGV-only?",
      "a": "Not any more. It started as an OGV game and now covers all of OGX; the joint board tags each person's side so the race stays readable."
     },
     {
      "q": "I stopped getting the evening reminder — is something broken?",
      "a": "Two innocent reasons: it only fires when your streak is 3+ days and today is unsaved, and your VP may have switched the nag off for the function. Your streak itself still counts either way."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**The flame can't be gifted (v33.39).** A referral logged by someone ELSE with Contacted=Yes pre-filled never saves the assignee's streak — the streak counts contacts YOU flipped, on sign-ups assigned to you. And undoing all of today's contacts un-saves the day: the streak reads the live data, not a stamp."
   }
  ]
 },
 {
  "id": "working-a-signup",
  "title": "Working a sign-up — claim, contact, comment",
  "emoji": "📞",
  "category": "ogx",
  "audience": "OGV & OGT crews",
  "audienceKeys": [
   "ogx"
  ],
  "keywords": [
   "claim",
   "contact",
   "contacted",
   "interested",
   "comment",
   "whatsapp",
   "call",
   "phone filter",
   "inline edit",
   "sign-up",
   "ازاي اكلم ساين اب",
   "اخد ساين اب",
   "كومنت"
  ],
  "summary": "Contact a sign-up in the Unassigned pool to claim it, log Contacted/Interested right from the row, and keep everything in the comment log — it all writes back to the sheet.",
  "blocks": [
   {
    "t": "p",
    "md": "**Your list opens on whatever was handed to you most recently.** Every view of sign-ups you already hold — 🙋 Mine, My team, All, 🤝 Referrals — is sorted by **when it was assigned, newest first**, so a sign-up given to you this morning is the top row rather than buried by its form date. (The 🆕 Unassigned pool is the exception: nothing there has been assigned, so it stays ordered by the sign-up date.) Any column header still re-sorts the list if you want it another way."
   },
   {
    "t": "steps",
    "items": [
     "Open [Sign-ups](/signups) → **🆕 Unassigned** and pick a fresh row — the **WhatsApp / Call** buttons are right there.",
     "Hit **Contact** — the sign-up becomes yours, your name lands on the sheet, and the details open so you can log everything on the spot.",
     "Set **Contacted** (Yes/No) and **Interested** (Yes/No) — from the details, or straight from the row: both are inline selects on the table.",
     "Drop a **comment** with what happened. Tapping WhatsApp/Call also offers to log the contact with the channel pre-filled, so nothing lives only in your chat history."
    ],
    "title": "Take a sign-up and work it"
   },
   {
    "t": "callout",
    "md": "**Some functions close the pool.** If your VP switched off self-service claiming, Contact on an unassigned row will tell you: your TL or VP hands out sign-ups instead. MMs and above can always assign.",
    "tone": "warn"
   },
   {
    "t": "p",
    "md": "**Comments are a two-class log, not a chat.** Your entries land in the sheet's *Comment* cell, a VP's in the *VP Comment* cell — each stamped with author and time. The list has a **Comment column** showing the thread newest-first (full text on hover) and a **💬 ➕** to add one without opening the row. Assigned and contacted dates stamp themselves."
   },
   {
    "t": "p",
    "md": "**Finding your way around:** the **🙋 Mine** chip jumps to your own rows from any view; column funnels filter Batch, Program, Contacted, Interested and Potential from the headers; and the **phone filter** on Quick actions goes both ways — only sign-ups *with* a phone, or only the **📵 missing-phone** ones (tracker placeholders like \"-\" count as missing)."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Reading the list at a glance** (v33.37): rows wear their contact state — a green edge = contacted & answered Yes, amber = contacted & answered No, plain = nobody has called yet. The **Contacted** filter has all three: Yes, No, and **Not contacted yet**."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can I edit the person's phone, program or university?",
      "a": "No — intake data belongs to the sheet and stays read-only in the details. You edit the workflow: Contacted, Interested, comments (and statuses once you own the row — see the potential flow)."
     },
     {
      "q": "The Call/WhatsApp buttons are missing on a row.",
      "a": "That sign-up has no usable phone number — the tracker sometimes holds placeholders. Filter 📵 missing-phone to find them, and try the email instead if there is one."
     },
     {
      "q": "What's Out of Process and who sets it?",
      "a": "A VP/Director archives a sign-up as Out of Process with a reason — it moves to 🗄️ Archived and is revivable. It's the only status the sheet's Status cell ever carries."
     },
     {
      "q": "I claimed one by mistake — how do I give it back?",
      "a": "Ask your TL or VP to reassign it (or Unassign it back to the pool) from the bulk bar or the row's assignee select."
     }
    ]
   }
  ]
 },
 {
  "id": "consideration-booked-call-life",
  "title": "A booked call's life — invite, reschedule, cancel",
  "emoji": "📅",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "reschedule",
   "cancel call",
   "meet link",
   "manage link",
   "calendar invite",
   "moved call",
   "google meet",
   "الغاء مكالمة",
   "تأجيل",
   "ميت لينك",
   "invitation"
  ],
  "summary": "Every booking gets a Meet invite and a confirmation with a manage link — the IR can move or cancel it themselves, you can cancel or ask them to move, and every move is remembered.",
  "blocks": [
   {
    "t": "p",
    "md": "The moment an IR books: a **Google Meet event** is created — on *your* calendar if you have a Google grant, otherwise on the **IM mailbox calendar** (the IR is invited by email either way, and the Meet link shows on your IR-calls page). You get a bell and an email; the IR gets a **confirmation email** in their own time zone with a private **manage link**."
   },
   {
    "t": "table",
    "headers": [
     "Who wants to change it",
     "How"
    ],
    "rows": [
     [
      "The IR reschedules",
      "Their manage link shows your live free slots (their current one excluded). Picking a new one moves the same event — no re-booking dance."
     ],
     [
      "The IR cancels",
      "One click on the manage link — no reason required from them. The calendar event is removed, mailbox-hosted or not."
     ],
     [
      "You cancel",
      "The call's card → cancel **with a reason** — the IR is emailed, the event is removed."
     ],
     [
      "You want it moved",
      "**Request reschedule** — you write a reason (it reaches the IR word for word) and they get their manage link to pick a new slot."
     ]
    ]
   },
   {
    "t": "p",
    "md": "A moved call **remembers**: every move is appended to its history, and the scheduled list says it in words — *\"Moved twice — first booked for …, then …. Last change by Ensar on …\"*. No more archaeology over what time it originally was."
   },
   {
    "t": "p",
    "md": "Any row on the scheduled list or the call log **opens into one organized card**: the IR's name, role, email (with its bounce state and the fix right there), WhatsApp button, Cairo time *and* their-zone time, their \"what I'd like to talk about\" note, the Meet link, the host, the full move history, and any cancel reason."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The call has no Meet link — why?",
      "a": "It shouldn't happen for new bookings: even without a Google grant the event is built on the IM mailbox calendar. If a genuinely link-less call exists, tell the IM team — the backfill script covers exactly this."
     },
     {
      "q": "Can I move the call myself instead of asking the IR?",
      "a": "The booking flow is IR-driven, so moving goes through their manage link — use **Request reschedule** with your reason. That keeps their consent and their calendar in the loop."
     },
     {
      "q": "The IR cancelled — is the meeting really gone from calendars?",
      "a": "Yes — the cancel deletes the event whether it lives on your calendar or the IM mailbox one. No ghost meetings."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**The confirmation comes from YOU (v33.40).** The IR's booking confirmation is sent from the host's own Gmail when their Google grant allows it — so the IR holds your real address and replies reach you directly. No grant yet? The system mailbox sends it with your address on Reply-To. Either way it is your **@aiesec.net** and never the backup personal Gmail (v33.41): a partner entity abroad must not end up writing to a private inbox."
   }
  ]
 },
 {
  "id": "ir-call-hand-over",
  "title": "Hand a booked IR call to someone else",
  "emoji": "🤝",
  "category": "consideration",
  "audience": "Consideration MMs & leaders",
  "audienceKeys": [
   "consideration",
   "leaders"
  ],
  "keywords": [
   "hand over",
   "handover",
   "reassign",
   "assign call",
   "give call",
   "another member",
   "can't make it",
   "swap host",
   "transfer call",
   "تحويل مكالمة",
   "اسلم المكالمة"
  ],
  "summary": "Can't make a call you've been booked for? Give it to another member instead of cancelling — same time, new host, and everything moves with it.",
  "blocks": [
   {
    "t": "p",
    "md": "Until now a call you couldn't make had two exits and both cost the LC something: **cancel** it on the IR, or **ask them to move it**, which makes a partner entity abroad redo work because of our rota. There's a third now, and it's usually the right one: keep the time, change the host."
   },
   {
    "t": "steps",
    "items": [
     "Open [Consideration](/consideration) → the scheduled call.",
     "Hit **🤝 Hand over** in the call's action row.",
     "Pick who takes it — the list is the consideration crew.",
     "That's it. The call is theirs from that moment."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Everything moves, not just the name.** A fresh calendar invite is built on the new host's calendar (or the IM mailbox if they have no Google grant) with the IR invited, and the old event is withdrawn. The IR gets an email in **their own time zone** saying who they'll be meeting, with the new Meet link — the time never changes. Both members get a bell and an email: one gains the call, the other is released from it."
   },
   {
    "t": "table",
    "headers": [
     "Who can hand a call over",
     "Which calls"
    ],
    "rows": [
     [
      "Team Leader / Coordinator (MMs)",
      "Their own calls — and a TL, their team's."
     ],
     [
      "LCVP / Director / LCP",
      "Anyone's call in the module."
     ],
     [
      "Member",
      "None — a Member holds their calls; ask your TL or VP to move one."
     ]
    ]
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does the call still count for me?",
      "a": "No — from the hand-over it counts for the new host, in the by-member ranking and the lane. That's the point: whoever does the call gets the credit."
     },
     {
      "q": "What if they're already busy at that time?",
      "a": "Sodio refuses the hand-over and names the call that clashes. It compares real intervals, so a partial overlap is caught too, not just an identical slot."
     },
     {
      "q": "Does the IR's reschedule link still work?",
      "a": "Yes, and it now reads the NEW host's availability — which is exactly right."
     },
     {
      "q": "Does a GV call become a GT call if a GT member takes it?",
      "a": "No. The GV/GT tag is what the conversation is about, fixed when it was booked. Only the host changes."
     },
     {
      "q": "What if the IR's email has bounced?",
      "a": "Then nothing is sent there — Sodio says so instead of claiming they were told. Fix the address on the call, or reach them on WhatsApp."
     }
    ]
   }
  ]
 },
 {
  "id": "consideration-partner-lcs-cvs",
  "title": "Partner LCs & the CV pool",
  "emoji": "🗂️",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "partner LC",
   "registry",
   "CV pool",
   "upload CV",
   "AI extraction",
   "IR contacts",
   "history",
   "notes",
   "بارتنر",
   "سي في",
   "شركاء",
   "رفع سي في",
   "violet man",
   "partnership"
  ],
  "summary": "The registry remembers every partner LC — country, GV/GT badges, its IR people, notes and a full history timeline — and the IGT-only CV pool reads uploaded CVs with AI.",
  "blocks": [
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Import another LC's whole CV folder.** CV tab → **Import a Drive folder** → paste the Google Drive folder link → **Scan folder**. The AI finds the CVs however the folder is organised — by programme, by sector, a folder per person with videos and certificates, or everything loose — names each person and reads GTa/GTe and the sector from the folders. When a file's name doesn't say whose it is (\"Untitled\", a Canva template name, \"Document from…\"), the AI opens the file and reads it before deciding. You see the list before anything is copied: untick what you don't want, pick the partner LC, import. Each CV is copied and read one at a time, and importing the same folder again only brings what is new. If Sodio can't open the folder, ask the LC to share it with the LC mailbox, or with \"anyone with the link\"."
   },
   {
    "t": "p",
    "md": "**The registry** (⚙ on the IR-calls tab) is the LC's memory of every partner entity. Each LC carries its country, **GV/GT badges derived from the calls actually made** (never stored, never stale), its IR people — every IR is a real contact row with a pick-list role, email and WhatsApp, and an IR who books through your link (or whose requested time you accept) is added automatically — plus **notes** on the LC itself or on any single IR (the 💬 button on their row). The **History** button opens one timeline — calls, CVs and notes, newest first — each call entry naming both the IR *and* the member who took it, with the IR's own \"what I'd like to talk about\" note and the in-call notes. \"Have we spoken to these people before?\" is one click now."
   },
   {
    "t": "p",
    "md": "Registry filters: by **country**, by **reached as** GV / GT / Both / Never, by **has calls · has CVs · 🤝 partnered · nothing yet**, and by **👥 Assigned to** — who works the LC, derived from its calls (each caller + their Team Leader). Anyone on the crew adds an LC; renaming is open to MMs and above (it cascades everywhere); **deleting** stays VP+ and is refused while calls or CVs still point at it. Names are normalized on the way in — \"AIESEC in İstanbul\", \"LC Istanbul\" and \"istanbul\" can't become three rows."
   },
   {
    "t": "p",
    "md": "**The CV pool** (IGT only): upload an EP's CV in any format — an LC is required, because a CV without a source is an orphan — and **AI extraction** fills name, phone, email, industry, skills, summary and the full text (PDFs and images read directly; anything unreadable is marked for manual fill). Fields stay editable by the uploader or a VP+, there's a re-run button, files open via short-lived signed links, and a WhatsApp button appears only when the extracted number is actually valid."
   },
   {
    "t": "p",
    "md": "The CV pool filters **server-side over the whole pool** — Industry, AI status, Uploaded by, Partner LC, and has/no number — so a filter narrows thousands of CVs, not the page you happen to be on. On a computer they are funnels on the column headers; **on a phone they are labelled chips above the cards** (a card list has no header to hang a funnel on, which is why the pool used to be search-only there)."
   },
   {
    "t": "callout",
    "md": "**The Violet Man reads the pool.** Ask it things like *\"CVs with C# in skills\"* or *\"marketing CVs from AIESEC in Kocaeli\"* — it searches the real pool with your permissions.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The AI extracted the wrong phone/industry — can I fix it?",
      "a": "Yes — every extracted field is editable by whoever uploaded the CV or any VP+, and there's a re-run button if you'd rather let the AI try again."
     },
     {
      "q": "Why can't I delete a partner LC?",
      "a": "It still has calls or CVs pointing at it — the registry refuses to orphan history. Empty LCs delete fine."
     },
     {
      "q": "Why does an LC show both GV and GT badges?",
      "a": "Because it's been reached as both — the badges are computed from the actual calls, so they can never drift from reality."
     },
     {
      "q": "Can I create an LC from the CV tab?",
      "a": "Yes — a CV can arrive from an LC we've never called, so inline LC creation stays there. Renaming and deleting live in the registry only."
     }
    ]
   }
  ]
 },
 {
  "id": "icx-approvals",
  "title": "Approvals — the ICX MOS",
  "emoji": "🏆",
  "category": "consideration",
  "audience": "Consideration crew, their MMs and VPs",
  "audienceKeys": [
   "consideration",
   "leaders",
   "mm"
  ],
  "keywords": [
   "approval",
   "approvals",
   "approved",
   "MOS",
   "KPI",
   "plan",
   "planned vs achieved",
   "leaderboard",
   "subtool",
   "ECB",
   "EXPA",
   "credit",
   "counts for",
   "team leader",
   "ابروفال",
   "موافقة",
   "الموس"
  ],
  "summary": "Every approved EP is logged once in Consideration → Approvals, credited to one person — and counted against the planning sheet, on the dashboard, the MM plans and the period reports.",
  "blocks": [
   {
    "t": "p",
    "md": "An **approval** is the ICX MOS: an EP from abroad approved on one of our opportunities. The planning sheet has always planned them (IGV · IGTa · IGTe) and every consideration MM files an approvals plan — now Sodio counts them too. They live on the **Approvals** tab of [Consideration](/consideration?tab=approvals)."
   },
   {
    "t": "steps",
    "title": "Log an approval",
    "items": [
     "Open [Consideration → Approvals](/consideration?tab=approvals). The yellow card lists approvals the **ECB SubTool** already knows about that nobody has logged — hit **Log it** on yours and the EP, EXPA id, date and sending LC are filled in for you.",
     "Not on the SubTool yet? **Log an approval** and type it: programme (GV / GTa / GTe), the EP's name and EXPA id, and the approval date.",
     "Say **who made it** — yourself, or (as an MM or VP) someone from the crew you answer for.",
     "Pick the **sending LC** (or add a new one), **how it came** (IR call, CV pool, EXPA organic, partner referral) — link the IR call or CV when there is one — and **our opportunity** (the account they were approved on).",
     "Add the EP's email / WhatsApp and any notes, then **Log it**."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Who it counts for**: one person per approval. A member's approvals ALSO count for their **Team Leader**, and the TL's own approvals are theirs too — the same way opens roll up on the raising side. So the tab and the dashboard show two boards: **by person** and **by MM (own + team)**."
   },
   {
    "t": "p",
    "md": "**Where it shows**: the consideration lane on the [dashboard](/dashboard) now opens with **planned vs achieved** (the month, or the sprint when *This sprint* is pressed, and the whole peak), a month-by-month strip against the plan, both boards, and where the approvals came from. **Who sees which plan**: VPs, Directors and the LCP see the function's planning sheet against the whole lane (and on [Planning](/planning)); a Team Leader or Coordinator sees the plan THEY filed on their [profile](/profile) against their own approvals (a TL's include their team's); a Member sees no plan, just the counts and the boards. The sprint/month report emails carry the approvals count and per-person numbers, without the plan."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can the same EP be logged twice?",
      "a": "No — the EXPA id is the guard. Typing just the EP id (without the opportunity part) also covers that EP's SubTool row, so a hand-logged approval never shows up again as a suggestion."
     },
     {
      "q": "I logged it under the wrong person — can I fix it?",
      "a": "Yes. Open it from the list: whoever logged it, whoever it counts for, their Team Leader and the function's VPs can edit or remove it."
     },
     {
      "q": "Why is my approval not on the plan card?",
      "a": "The card counts by the approval date. An approval dated last month counts for last month — check the date on the row."
     }
    ]
   }
  ]
 },
 {
  "id": "cxp-documents",
  "title": "CXP — attaching and downloading ECB documents",
  "emoji": "🗂️",
  "category": "leaders",
  "audience": "CXP, and the MMs and VPs of IGV · IGT · OGV · OGT",
  "audienceKeys": [
   "leaders",
   "mm",
   "consideration",
   "ogx"
  ],
  "keywords": [
   "cxp",
   "ecb",
   "subtool",
   "audit",
   "document",
   "upload",
   "attach",
   "download",
   "zip",
   "weekly",
   "deadline",
   "passport",
   "مستندات",
   "رفع",
   "تحميل"
  ],
  "summary": "Attach each EP's documents from their CXP page (any size up to 25 MB), view or download them from Sodio, and download a whole week — or a whole EP — as one ZIP.",
  "blocks": [
   {
    "t": "steps",
    "title": "Attach a document",
    "items": [
     "Open [CXP](/cxp) and click the EP.",
     "On the document's row press **Attach** — or drag the file from your computer straight onto the row.",
     "A progress bar shows the upload; when it says **Saving to Drive…** the file is being put in the EP's Drive folder. It's done when the row turns to **View · Download**.",
     "Wrong file? **Replace** it, or the 🗑 marks it as not collected again (the file itself stays in Drive as evidence)."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "Files up to **25 MB** — photos straight from a phone and scanned PDFs included. (Before v37 anything over about 4.5 MB silently failed; that's fixed.) Since v37.1 everything is kept in a fresh Drive directory, **Sodio — CXP Submissions**; the old system's files were not carried over."
   },
   {
    "t": "p",
    "md": "**Downloading**: every collected document has **View** (opens in the tab) and **Download**, served by Sodio — you don't need access to the Drive folder. **Download all** on an EP's page gives that EP's whole file as one ZIP, sorted by stage. On the [weekly board](/cxp/weekly), each function's card has **Download ZIP** for the selected deadline — past weeks too — with a README inside listing what's included and what's still missing. Leaders can also **Build Drive folder**, a folder of shortcuts for the week."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "It says \"collected · ECB sheet\" but there's no file to download.",
      "a": "That document is ticked on the ECB SubTool but was never attached in Sodio — attach the file if you have it."
     },
     {
      "q": "Who can download?",
      "a": "Anyone who can read that function's submissions in CXP — the same people who can see the EP."
     }
    ]
   }
  ]
 },
 {
  "id": "export-data",
  "title": "Download your data (Excel or CSV)",
  "emoji": "📥",
  "category": "getting-started",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "export",
   "download",
   "excel",
   "csv",
   "xlsx",
   "extract",
   "report",
   "spreadsheet",
   "تحميل",
   "اكسيل",
   "تصدير"
  ],
  "summary": "Every list and dashboard has an Export button: the rows you see, with your filters, as Excel or CSV. Only what you can already see.",
  "blocks": [
   {
    "t": "steps",
    "title": "Export what's on screen",
    "items": [
     "Open the list — [Raising](/accounts), [Sign-ups](/signups), [Consideration](/consideration) (IR calls, CVs, partner LCs, approvals), [Attendance](/attendance), [CXP](/cxp), [Members](/members) — and set the filters you want.",
     "Press **Export** at the top.",
     "Pick **Excel (.xlsx)** for everything in one workbook, or a **CSV** (one sheet per file)."
    ]
   },
   {
    "t": "p",
    "md": "**The dashboard exports as a workbook**: the lane's totals and conversions, every leaderboard, the MM and team boards and the drills — for the dates, team and member on the filter bar. EB members get the plan-vs-achieved rows too; everyone else gets the numbers without the planning."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**You can only export what you can see.** Each export is built by the same reader as its page, so a file never holds a row that isn't already on your screen — and every export is recorded in the log. **Settings → My data** lists every export open to you in one place."
   }
  ]
 },
 {
  "id": "new-term-peak",
  "title": "Starting a new peak or term (LCP & admins)",
  "emoji": "🧭",
  "category": "leaders",
  "audience": "The LCP and the admins",
  "audienceKeys": [
   "admin",
   "eb"
  ],
  "keywords": [
   "new term",
   "new peak",
   "handover",
   "restart membership",
   "planning",
   "migration",
   "transition",
   "تسليم",
   "ترم جديد",
   "بيك جديد"
  ],
  "summary": "Settings → LC & new term walks you through it: planning (term only), restarting the membership from a file, the handover notes, then Start.",
  "blocks": [
   {
    "t": "p",
    "md": "A **peak** restarts the **membership** — people leave, new ones join — but keeps the **planning**, which belongs to the term (February → January). A **term** restarts both. Everything is in [Settings → LC & new term](/profile/settings?tab=lc)."
   },
   {
    "t": "steps",
    "title": "The steps",
    "items": [
     "**Pick what's starting** — a new peak or a new term.",
     "**Planning (a new term only)** — paste the new planning sheet's link and press Link & import, or upload the planning workbook (.xlsx). Not ready yet? Tick “I'll add it later”; Sodio reminds you on the same page until it's in.",
     "**Membership** — download the current list, keep who stays, add who joins, and upload it with **Restart**. Whoever isn't on it is marked inactive: they stop signing in, but their accounts, calls and history stay theirs, and it's reversible. You see every change before anything is written.",
     "**Handover** — a note for the whole incoming EB, one for each function, and the links they'll need (Drive folders, the planning sheet, forms).",
     "**Start** — records the new peak or term, starts a fresh checklist, and notifies the EB to read the handover."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**The handover** is read by every VP, Director and the LCP in **Settings → Handover** — the general note, the links, and their own function's notes. The **checklist** keeps the things Sodio can't do for you (Drive access for the new EB, each VP checking their function's defaults, new members signing in with Google once), ticked, so the next LCP sees what was done."
   }
  ]
 },
 {
  "id": "lc-partnerships",
  "title": "Partnerships with partner LCs",
  "emoji": "🤝",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "partnership",
   "partner LC",
   "new partnership",
   "whatsapp group",
   "target",
   "assign",
   "MOS",
   "KPI",
   "شراكة",
   "بارتنرشيب",
   "جروب واتساب",
   "تارجت",
   "cross team",
   "counts for",
   "assigned to"
  ],
  "summary": "Approaching a new LC and opening the WhatsApp group IS the win — record it per programme (GV/GT), hand LCs out as targets, and watch the count on the consideration dashboard.",
  "blocks": [
   {
    "t": "p",
    "md": "A **partnership** is the consideration floor's other MOS: you approach an LC we've never worked with, you open the WhatsApp group with them — done, that's a partnership made. It's recorded **per programme**, so the same LC can be a brand-new **GT** partnership while being an old **GV** one; the two never contradict. Everything lives on the **Partner LCs tab** of [Consideration](/consideration)."
   },
   {
    "t": "steps",
    "title": "Record a partnership",
    "items": [
     "Open [Consideration](/consideration) → **Partner LCs** → **🤝 Record a partnership** (or the **Partnership** button on the LC's own card).",
     "Pick the LC — or add a brand-new one right there with its name and country.",
     "Pick the programme (**GV or GT** — it defaults to your own side) and the **partnership date** (defaults to today).",
     "Name the **IR** who anchors it, with their **WhatsApp or email — at least one is a must**: a partnership we can't reach isn't one.",
     "Save. The LC's card wears a green **🤝 partnership** chip, the IR lands in the LC's contact list, and the dashboard counts it."
    ]
   },
   {
    "t": "p",
    "md": "**🎯 Targets**: an MM or VP hands an LC to someone as a partnership target — \"go make this one\" — from the **Set a target** button (any LC, even a brand-new one created right there) or the LC's own card. A Team Leader hands targets to their own team — or to ANY consideration member when their function's defaults switch on **cross-team targets**; a Coordinator takes one themselves; VPs/Directors and the LCP reach the whole crew. The member **and their Team Leader** get the bell, the LC's card shows 🎯 with the assignee's name, and a **Your partnership targets** banner sits at the top of the tab for whoever holds one. Recording the partnership completes the target — and **it counts for the member it was assigned to**, even when a leader files it on their behalf. An MM recording a partnership their member made can also pick **Counts for** right on the record form."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**IR calls don't block a partnership** (since v36.1). The calls are stages on the road — scheduled, done — and the WhatsApp group is the partnership itself, so an LC you've already called can still be recorded, or set as a target, like any other. Only a partnership already MADE on a programme blocks a second one there; the other programme can still make its own."
   },
   {
    "t": "p",
    "md": "**On the dashboard**: the consideration lanes carry **🤝 Partnerships** (total, this month, pending targets) and a **Partnerships by member** strip — the member's own KPI. A partnership counts in the lane of its own programme tag, and the filter bar (dates, team, member) reaches it like everything else."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "The LC isn't in the registry yet — do I add it first?",
      "a": "No need — the record form has \"➕ A brand-new LC\": name + country, and the LC and the partnership are created together."
     },
     {
      "q": "Can a target be taken back?",
      "a": "Yes — the assignee (\"Hand it back\" on the banner), whoever assigned it, or any VP can clear a pending target. A made partnership never clears."
     },
     {
      "q": "We're already a GV partnership — can I record GT too?",
      "a": "Yes, that's the point: partnerships are per programme. The form simply blocks the programme that's already made."
     },
     {
      "q": "Who gets the credit when my TL records my target for me?",
      "a": "You do — completing a pending target always credits the member it was assigned to, and you're notified that it landed."
     }
    ]
   },
   {
    "t": "p",
    "md": "**Who works an LC** is derived from its calls, never stored: every member who made a call with it, plus each caller's Team Leader (a member and their TL on the same team is the point, not a contradiction). The registry filters by **👥 Assigned to**, and each card lists its people."
   }
  ]
 },
 {
  "id": "consideration-reporting-calls",
  "title": "Reporting your IR calls",
  "emoji": "📝",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "report call",
   "in-call notes",
   "call log",
   "overdue",
   "time passed",
   "screenshot",
   "demand",
   "calls need you",
   "تقرير المكالمة",
   "ريبورت",
   "لوج",
   "مكالمة فاتت"
  ],
  "summary": "A call isn't done until you report it — in-call notes and a screenshot complete it, the ⏰ chip and the 'calls need you' banner chase the ones you forgot, and the call log filters server-side.",
  "blocks": [
   {
    "t": "p",
    "md": "After the call, open it from the scheduled list and fill the **in-call notes**: the demand (industry chips + Other), free notes, and a **screenshot** of the call — it lands named in the Drive folder. That's what moves the call from *scheduled* to *completed* and feeds the Booked → happened number on the lane."
   },
   {
    "t": "p",
    "md": "**Forgot one?** A booked call whose time passed while still unreported gets an **⏰ Time passed — report it** chip, and a banner counts them: *\"N calls need you\"* (bounced emails ride the same count). The banner follows the hierarchy — a member answers for their own calls, a Team Leader for the team's (or the whole function's, if their VP set that in [MM access](/help?a=mm-access)), a VP/Director/LCP for the whole floor — so a clean slate shows **no banner at all**. **Show them** narrows the list to exactly those rows, and a **Waiting to be reported** KPI sits on the dashboard lane. A host who has **left the LC** (inactive) no longer counts: their past calls stay in the log, but nobody is chased to report them (v37.1)."
   },
   {
    "t": "steps",
    "items": [
     "Open [Consideration](/consideration) → your scheduled calls → tap the call (or its ⏰ chip).",
     "Pick the **demand** — which industries/products they're interested in — and write what was said.",
     "Attach the call **screenshot** and save. Done: it's completed, logged, and off your banner."
    ],
    "title": "Report a call"
   },
   {
    "t": "p",
    "md": "A call that happened outside the booking flow can still be recorded — the manual **past-call** form sits behind a toggle on the same tab (future timestamps are refused; a future call should be a booking)."
   },
   {
    "t": "p",
    "md": "The **call log** is the whole history, server-paged — so its filters run **in the query**, over everything, not just the page on screen: column funnels on **Product** (GV/GT), **Status**, **By** (who took it), **Partner LC**, plus search and a **Called from → to** date window. Filter options come from the full log, and any row opens the call's detail card."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why do I see a 'calls need you' banner when I reported all mine?",
      "a": "If you're a TL or above, the banner covers your team's or floor's calls, not just yours — hit **Show them** to see exactly whose. A member with a clean slate never sees it."
     },
     {
      "q": "Do I have to attach a screenshot?",
      "a": "No — it's optional (but encouraged: it's nice proof the call happened), and it's filed automatically into the LC's Drive folder. If the Drive upload hiccups, the call is still recorded; the report never gets lost to a storage error."
     },
     {
      "q": "Can I edit a report after saving?",
      "a": "The call's card shows everything recorded; if something's genuinely wrong, ask your VP — and for a wrong *time*, remember reschedules are tracked with full history, so don't re-book to fix a typo."
     }
    ]
   },
   {
    "t": "p",
    "md": "**The scheduled list sorts and narrows too (v33.41):** sort by soonest, latest, partner LC, who takes it, or just-booked; filter by **When** (today · next 7 days · still ahead · ⏰ time passed) and by what the call **Carries** (⚠️ bounced email · has a Meet link · no Meet link · their note) — on top of the Mine / With / LC / Product chips."
   }
  ]
 },
 {
  "id": "consideration-overview",
  "title": "The Consideration module — what lives where",
  "emoji": "🌍",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "consideration",
   "IR calls",
   "international relations",
   "CV pool",
   "partner LC",
   "GV",
   "GT",
   "dashboard lane",
   "اي ار",
   "كونسيديريشن",
   "مكالمات",
   "شركاء",
   "partnership",
   "شراكة"
  ],
  "summary": "Consideration is where IR calls with partner LCs and the CV pool live — one tab for calls, one for CVs (IGT only), and a dashboard lane per product.",
  "blocks": [
   {
    "t": "p",
    "md": "[Consideration](/consideration) is the supply side of ICX: talking to **partner LCs abroad** so their EPs come to Alexandria. It has two tabs — **IR calls** (the shared call log, your booking link, scheduled calls, the partner-LC registry) and **CVs** (the EP CV pool). The CV tab is **IGT only** — IGV consideration people keep the IR-call side but never see CVs."
   },
   {
    "t": "p",
    "md": "Every IR call carries its **own product tag — GV or GT** — decided when the call is booked and frozen. That tag (not the host's current functions) is what splits calls between the **IGV Consideration** and **IGT Consideration** dashboard lanes, so a dual-function member's calls count once, in the right place. Old untagged calls stay visible to everyone."
   },
   {
    "t": "p",
    "md": "The [dashboard](/dashboard) consideration lane is a real dashboard: calls this month vs last month, completed, upcoming, a **Booked → happened** conversion, partner LCs reached (and reached for the *first time* this month), CVs on the IGT side, a per-month bar strip that starts at the **peak's first month** (no comparing against last term), a **Calls-by-member** drill where **Done + Upcoming + Waiting = Total**, and — since v33.38 — **🤝 Partnerships**: made in total, made this month, pending targets, and who made them. It takes the same filter bar as every other lane — dates, team, member — and the date inputs are deliberately *not* clamped to today, because a call can be in the future."
   },
   {
    "t": "table",
    "headers": [
     "Who",
     "What they see"
    ],
    "rows": [
     [
      "Consideration crew (function or sub-function says Consideration)",
      "The whole module — shared call log, booking link, scheduled calls, registry; CVs only if IGT"
     ],
     [
      "IGV / IGT VPs & Directors",
      "The module + their product's consideration lane"
     ],
     [
      "LCP / admin",
      "Everything, every lane"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "A **Waiting to be reported** KPI sits on the lane: booked calls whose time passed while nobody reported them. If it's not zero, someone owes a report — see [Reporting your IR calls](/consideration).",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I'm IGV consideration — where are my CVs?",
      "a": "There aren't any: the CV pool is **IGT only** by design. You keep the full IR-call side."
     },
     {
      "q": "I work both GV and GT — which lane do my calls count in?",
      "a": "Whichever product the call was **booked as**. The tag is frozen at booking, so changing functions later never rewrites your history."
     },
     {
      "q": "Why does the trend strip only show a couple of months?",
      "a": "It starts at the current peak's first month on purpose — the previous term's calls aren't a fair comparison, so Sodio refuses to draw them next to yours."
     }
    ]
   }
  ]
 },
 {
  "id": "consideration-time-zones",
  "title": "Time zones on the booking page",
  "emoji": "🕰️",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "time zone",
   "timezone",
   "cairo time",
   "VPN",
   "booking page",
   "local time",
   "التوقيت",
   "توقيت القاهرة",
   "فرق التوقيت",
   "IR clock"
  ],
  "summary": "The booking page draws itself in the visitor's own time zone — and when their connection and device disagree (VPN), the connection wins with a one-tap way back.",
  "blocks": [
   {
    "t": "p",
    "md": "An IR in Jakarta who books \"6:00 PM\" means 6 PM *at home* — so the booking page renders everything in **the visitor's zone**, exactly like Google Calendar. The day strip is properly **regrouped**, not just relabelled: a Cairo-midnight slot shows up as the previous evening in Algiers. A picker lets them switch zones, and the chosen zone also prefills their country."
   },
   {
    "t": "p",
    "md": "**The VPN case:** a browser reports the *machine's* zone, which a VPN never changes. When the zone resolved from the **connection** disagrees with the device, the connection wins — it's the one signal that moves when the person does. The device zone stays one tap away (\"Showing Singapore time — your device says Cairo. Use Cairo instead\") for the corporate-VPN case where the machine was right all along. No question is ever asked; the page just picks sensibly."
   },
   {
    "t": "p",
    "md": "The zone is **stored on the booking** and on the partner LC, so every later email — confirmation, reschedule, cancellation — leads with **their** time and carries Cairo as the second line. The screen and the email are built by the same label function, so they can never disagree."
   },
   {
    "t": "p",
    "md": "On your side nothing changes: the crew reads Cairo everywhere — except that a scheduled call also shows the IR's local time next to it, so nobody wonders why someone missed a call that fell at 3 AM their side."
   },
   {
    "t": "callout",
    "md": "Egypt's DST is handled end to end: stored instants are always right, and on the spring-forward night the slot that would land in the hour that doesn't exist is simply never offered.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "An IR says the page shows the wrong city — what do I tell them?",
      "a": "Tell them to tap the one-line switch under the times (it offers their device's zone), or pick any zone from the picker. Their booking stores whichever zone the page was showing when they booked."
     },
     {
      "q": "Do I have to convert times when emailing an IR?",
      "a": "No — every automatic email already leads with the IR's clock and puts Cairo second. And the scheduled-call row shows you both clocks, so if you ever write to them yourself (the [Emails](/emails) tab, for MMs and above — or plain Gmail) you have the right time to copy."
     },
     {
      "q": "Does the IR's zone change what's stored?",
      "a": "Never. Every booking is stored as one exact instant; zones only change how it's *drawn* for each person."
     }
    ]
   }
  ]
 },
 {
  "id": "consideration-bounced-email",
  "title": "When the IR's email is wrong",
  "emoji": "📮",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "bounced",
   "email bounced",
   "wrong email",
   "fix email",
   "mailer daemon",
   "typo domain",
   "invite not received",
   "ايميل غلط",
   "الايميل مش واصل",
   "bounce"
  ],
  "summary": "Provably wrong addresses are refused at booking; the rest are caught by the bounce watcher, which flags the call and gives you a one-click fix that re-sends the invite.",
  "blocks": [
   {
    "t": "p",
    "md": "Two layers protect the one channel a booked call depends on. **At booking**, the page refuses what can be *proven* wrong: dead or mistyped domains (a curated typo table plus a live MX check — and if DNS itself is down, the check fails open rather than blocking a real person), burner domains, stray leading/trailing dots, and local parts that break Gmail's own published rules — an address Gmail itself would never have issued can't be real."
   },
   {
    "t": "p",
    "md": "**After booking**, what couldn't be proven — a perfectly valid gmail.com with the name spelled backwards — reveals itself only when the mail server bounces. The **bounce watcher** rides the 15-minute cron, scans the IM mailbox for mailer-daemon reports, and flags any scheduled call whose address matches: an **⚠️ Email bounced** chip on the row, a bell for you, and an email that carries a **wa.me link to the IR** — their WhatsApp number is the one channel we know works, so use it to get the right address."
   },
   {
    "t": "steps",
    "items": [
     "Open the call (the row's card shows *⚠️ bounced — the address doesn't exist* with **Fix it** right next to it).",
     "Type the corrected address — it's checked like a fresh booking (typo domains and burners refused again).",
     "Save. Sodio **swaps the attendee on the calendar event** — Google re-sends the Meet invite to the right inbox — updates the LC's contact row, re-sends the confirmation email in the IR's own time zone with their manage link, and clears the flag."
    ],
    "title": "Fixing it"
   },
   {
    "t": "callout",
    "md": "If the swap is impossible — no event was ever created because the host had no Google grant, or that grant was revoked since — the event is **rebuilt on the IM mailbox** instead of silently doing nothing. And if the confirmation to the *new* address also fails, the call is re-flagged rather than pretending success.",
    "tone": "info"
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**The problem was on THEIR side?** If the address was right all along (their mailbox was broken and then fixed), open **Fix the email**, keep the address exactly as it is, and hit the button — the bounce flag clears, the calendar invite is re-issued and a fresh confirmation goes out. Re-sending to the same address is a supported retry, not an error."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who can fix a bounced address?",
      "a": "The call's owner or a VP — from the call's card, right where the warning sits."
     },
     {
      "q": "Why was a booking refused with 'check the email'?",
      "a": "The address failed a check we can prove: a typo'd or dead domain, a burner, a stray dot, or a Gmail username that can't exist. Ask the IR to re-type it carefully — the page says exactly what's wrong."
     },
     {
      "q": "A bounce got flagged but the IR swears the email is right — now what?",
      "a": "Bounces come from the receiving mail server, not from us — something rejected it. WhatsApp them (the flag email carries the link), confirm the exact spelling, and use **Fix it** even if the 'new' address only differs by one character."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**If the host has no inbox at all** (no AIESEC address, no backup Gmail), the bounce alert email goes to the consideration leadership instead — the bell alone gets scrolled past, and someone with a mailbox has to carry the message (v33.40)."
   }
  ]
 },
 {
  "id": "consideration-booking-link",
  "title": "Your booking link — /book/your-slug",
  "emoji": "🔗",
  "category": "consideration",
  "audience": "Consideration crew",
  "audienceKeys": [
   "consideration"
  ],
  "keywords": [
   "booking link",
   "book",
   "availability",
   "slots",
   "buffer",
   "slot length",
   "IR booking",
   "schedule",
   "لينك الحجز",
   "مواعيد",
   "ازاي اعمل لينك حجز",
   "سلوت",
   "per day limit",
   "sunday",
   "weekday cap",
   "no slots",
   "end date",
   "nobody books"
  ],
  "summary": "Set your availability on the My booking link card and share sodio.vercel.app/book/your-slug — IRs abroad pick a free slot themselves.",
  "blocks": [
   {
    "t": "p",
    "md": "Instead of WhatsApp ping-pong about times, share your link: an IR anywhere in the world opens `sodio.vercel.app/book/<your-slug>`, sees your free slots **in their own time zone**, and books one. The call lands on your scheduled list with a Meet link and a calendar invite for both of you."
   },
   {
    "t": "diagram",
    "diagramId": "ir-booking",
    "caption": "From sharing your link to a booked call on both calendars."
   },
   {
    "t": "steps",
    "items": [
     "Open [Consideration](/consideration) → the **My booking link** card.",
     "Pick your **slug** (that's the last part of the URL) and turn the link **Active**.",
     "Add availability: **weekly** rows (e.g. every Tuesday 6–10 PM) or **one-date** rows for a specific day. Times step in **5 minutes** (hour + minute + AM/PM selects), and a window may end at **12 AM midnight**.",
     "Choose **Slot length** (15 minutes up to 2 hours), an optional **Buffer between calls**, and if you want: minimum notice, how far ahead people can book, and start/end dates for the whole link.",
     "Copy the link and send it to your partner LCs."
    ],
    "title": "Set it up once"
   },
   {
    "t": "p",
    "md": "**How the buffer actually works:** when nothing is booked, slots sit back-to-back. The moment a call is booked, the grid **re-anchors around it** — with a 6:00 PM call, 30-minute slots and a 10-minute buffer, the next offered slot is **6:40**, then 7:10. So you always get your breather after a real call, without your empty evenings being chopped into weird gaps."
   },
   {
    "t": "p",
    "md": "The form checks each availability row **as you type**: a backwards or under-10-minute window, a missing day/date, or an overlap with another window on the same day gets outlined with the reason — **every** row in the clash, and a one-date row that collides with that weekday's weekly window too — and Save waits until it's fixed. Two IRs racing for the same slot can't collide either — the second one is told the slot was just taken and shown fresh ones."
   },
   {
    "t": "p",
    "md": "The IR's side asks for their **name and role** (Member / MM / LCVP / LCP), their **LC** (with suggestions from the registry so duplicates don't multiply), a **required email**, a **phone with country code**, and **what they'd like to talk about** — that note reaches your email and the calendar event, so you never walk in blind."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Daily cap & longer buffers** (v33.37): the settings card can limit your link to **N calls per day** (a full day simply stops being offered) and the buffer between calls now goes up to **2 hours** (1h / 1½h / 2h)."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can my window end at midnight?",
      "a": "Yes — pick **12 AM** as the end. A 10 PM → 12 AM window offers its full set of slots, last one included."
     },
     {
      "q": "Why can't the IR see a slot I know is free?",
      "a": "Check minimum notice and the max-advance window, whether the slot collides with a booked call **plus its buffer**, and whether the link is Active. Also: a Cairo wall-clock time that doesn't exist on a DST-change night is dropped on purpose."
     },
     {
      "q": "Do I need a Google account grant for this to work?",
      "a": "No — if your Google grant is missing, the Meet event is created on the LC's IM mailbox calendar instead and you're invited by email. The link on your IR-calls page always works."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Per-day caps (v33.39):** besides the general \"calls per day\" limit, every weekday can carry its OWN cap — \"3 a day, but Sunday only 1\". Set the small per-day row under the cap on your booking card; \"–\" follows the general number. A full day simply stops being offered on your link."
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**If nobody can book you, the card says why (v33.44).** A link that is switched off, a schedule whose **end date has passed**, a start date still in the future, no hours at all, hours only on dates that are gone — each one silently empties your grid, and now each one is spelled out at the top of *My booking link*. If every setting looks fine but the grid is still empty (fully booked, daily cap, minimum notice), it says that too."
   }
  ]
 },
 {
  "id": "attendance",
  "title": "Attendance — who records it, and how working hours record themselves",
  "emoji": "🙋",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "attendance",
   "absent",
   "late",
   "excuse",
   "working hours",
   "automatic attendance",
   "appeal",
   "confirm attendance",
   "reminder",
   "حضور",
   "غياب",
   "تسجيل الحضور",
   "اعتراض",
   "invited function",
   "cross function",
   "excuse",
   "can't come",
   "late",
   "اعتذار"
  ],
  "summary": "Meetings and outings are recorded by hand; working hours pre-fill themselves from your real work and a human confirms — with appeals if a mark is wrong and a reminder ladder if nobody records.",
  "blocks": [
   {
    "t": "p",
    "md": "After every touch point, an attendance sheet is filled on [/attendance](/attendance): **attended · late · absent**, with a \"valid excuse?\" box. Team points are recorded by the **Team Leader**, function points by the **VP/Director**, LC points by **TM**. **Nobody marks themself** — a TL records their team and TM records the TL."
   },
   {
    "t": "p",
    "md": "**Working hours record themselves** 🤖 — then a human confirms. You're pre-filled as attended when, inside the session window (15 minutes before the start to 4 hours after), you did either **2+ real work actions at least 10 minutes apart** or **5+ actions** however tightly packed. Real work = logging a contact, booking a visit, recording a deal, working a sign-up, logging an IR call, adding or updating an account, uploading a CV, and more. Two clicks in a row won't fool it; a genuine ten-contact burst counts."
   },
   {
    "t": "callout",
    "md": "The AI's answer is a **proposal**, marked \"AI pre-filled — review & confirm\". The recorder reviews the rows, fixes any, and hits `Confirm attendance` — that's the only thing that makes it official. A human edit always wins over the engine.",
    "tone": "info"
   },
   {
    "t": "steps",
    "items": [
     "Open [Attendance](/attendance) — sessions still owed a record are waiting for you, or use the picker to open **any** past touch point you may record.",
     "Mark each person attended / late / absent (search and the status filter help on a 70-row LC session). For working hours, review the pre-filled rows instead.",
     "Add excuses where they apply, then hit `Confirm attendance`."
    ],
    "title": "Record a session"
   },
   {
    "t": "p",
    "md": "**Disagree with a mark?** Open your history and hit `Appeal` — your message goes to whoever recorded it, with TM on CC. There's no appeal on \"attended\" (nothing to contest). You see your own history and rate; a TL sees the team's, a leader the function's, TM the LC's — and the table filters from its columns: **Type**, **Status**, **Member**."
   },
   {
    "t": "callout",
    "md": "**The reminder ladder is real.** If a session sits unrecorded, the responsible recorder gets one email per day (late evening Cairo time). After **three reminders**, Sodio greets them with a blocking prompt on next open that won't go away until the sheet is filled. Just fill it. 💜",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I worked the whole session — why am I pre-filled absent?",
      "a": "The engine only sees actions **inside Sodio** during the window (contacts, visits, deals, sign-ups, IR calls, account edits…). Work that lived in WhatsApp is invisible to it. Ask your recorder to fix the row before confirming, or appeal after."
     },
     {
      "q": "Can I appeal being marked attended?",
      "a": "No — there's nothing to contest. Appeals exist for late/absent marks only."
     },
     {
      "q": "Why wasn't I on the attendance sheet at all?",
      "a": "You were unticked from **Who's invited** when the touch point was booked (or edited later) — only invited people appear on the sheet. Inactive members and the Admin caretaker role are never on one either."
     },
     {
      "q": "Who confirms working hours?",
      "a": "Same as any point: the TL for a team session, the VP/Director for a function one, TM for LC-wide. The pre-fill even runs automatically when they open the sheet after the window closes — they just review and confirm."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Cross-function touch points record per slice (v33.40).** When a touch point invites another function, that function's own MMs and VPs/Directors open the sheet and set **their own people's** rows — the booking function's crew can't fill the invited function's slice, and vice versa. TM and the LCP keep the whole sheet, and the sheet confirms once every slice is recorded."
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**Working hours are SUGGESTED, never recorded (v33.42).** The engine used to write attended/absent rows on its own — and those counted everywhere while nobody had confirmed them. Now it fills the sheet in front of you (each row marked *suggested*) and **stores nothing**: correct what looks wrong and press Confirm. Until you do, the session counts as unrecorded and keeps reminding you."
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Can't make it? Say so BEFORE (v33.43).** On any upcoming touch point of yours — on the [Calendar](/calendar) — there's a **🙏 Can't make it?** button: pick *can't come* or *I'll be late*, give a one-line reason, and it emails the TM function straight away and lands on the attendance sheet as **excused**. Whoever records the session can still change it. After the session it's the appeal you want instead."
   }
  ]
 },
 {
  "id": "custom-calendar-items",
  "title": "Custom calendar items — 📌 slots and tasks for anyone",
  "emoji": "📌",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "custom item",
   "calendar item",
   "add item",
   "block time",
   "weekly repeat",
   "routine",
   "visible to",
   "assign slot",
   "task",
   "بلوك وقت",
   "اضافة موعد",
   "عنصر في التقويم"
  ],
  "summary": "Anyone can add Google-Calendar-style slots and tasks to the calendar, assign them to people in their reach, repeat them weekly, and choose who else sees them.",
  "blocks": [
   {
    "t": "p",
    "md": "Custom items are the calendar's free-form layer: a title, a time, and an assignee list — no derived audience, no attendance sheet, no reminder ladder. **Everyone** can add them from `Add item` in the [Calendar](/calendar) header, or from any future day's panel. They show as green **📌** chips."
   },
   {
    "t": "table",
    "headers": [
     "You are…",
     "You can assign the item to…"
    ],
    "rows": [
     [
      "Member / Coordinator",
      "Your own team — yourself, same-manager teammates, and your TL"
     ],
     [
      "Team Leader",
      "Your team"
     ],
     [
      "LCVP / Director",
      "Your function"
     ],
     [
      "LCP-level",
      "Anyone"
     ]
    ]
   },
   {
    "t": "p",
    "md": "Every assignee gets a **bell** when they're added (and if they're removed), and the item lands on their calendar. The server re-validates every assignee against your reach — the picker can't offer anyone it would refuse."
   },
   {
    "t": "p",
    "md": "**Repeat: \"Weekly — N weeks\"** (2 to 12) books a routine in one action — the same slot every week, each week its own item, so one occurrence can be deleted without the rest. Assignee bells say \"repeats weekly ×N\"."
   },
   {
    "t": "table",
    "headers": [
     "You are…",
     "\"Visible to\" options"
    ],
    "rows": [
     [
      "Member / Coordinator / TL",
      "Just me · my team · my function"
     ],
     [
      "LCVP / Director",
      "Just me · my function"
     ],
     [
      "LCP-level",
      "Just me · the EB · the whole LC (+ your function if you hold one)"
     ],
     [
      "TM (any role)",
      "All of the above for your role, plus the whole LC"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**Visibility defaults to \"just me\"** — sharing is a decision, not an accident. Use it to say \"this hour is blocked, my team can see I'm busy\" without inviting anyone. Whoever you put on the item sees it regardless of the visibility setting.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who can delete an item?",
      "a": "Its owner, or anyone LCP-level. Deleting one occurrence of a weekly repeat leaves the rest alone — each week is its own item."
     },
     {
      "q": "Should this be a custom item or a touch point?",
      "a": "If you need attendance, announcements and the reminder ladder, it's a touch point. If it's a slot, a task, or a blocked hour, it's an item — deliberately lightweight."
     },
     {
      "q": "I changed function — does that change who sees my old items?",
      "a": "No. The function on an item is frozen at creation, so moving function never rewrites the audience of every past item."
     }
    ]
   }
  ]
 },
 {
  "id": "rate-a-touch-point",
  "title": "Rate a touch point — 1 to 5 stars",
  "emoji": "⭐",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "rate",
   "rating",
   "stars",
   "session feedback",
   "touch point feedback",
   "feedback",
   "evening email",
   "review meeting",
   "تقييم",
   "تقييم الميتنج",
   "نجوم"
  ],
  "summary": "Any touch point you were part of can be rated 1–5 stars from the Feedback page — the note is optional, it goes quietly to TM and the LCP, and the evening of a session you get one email asking for it.",
  "blocks": [
   {
    "t": "p",
    "md": "A session isn't a shout-out or a concern — \"good, but it ran long\" is neither a complaint about a person nor applause for one. So a touch point is **rated**: on [Feedback](/lc-feedback), pick **A touch point**, choose any past one you were part of, and tap **1–5 stars** (each star has a word under it, Poor → Excellent). The note is optional — the stars *are* the review."
   },
   {
    "t": "steps",
    "items": [
     "Open [Feedback](/lc-feedback) and pick **A touch point**.",
     "Choose the session from the list of past touch points you were part of.",
     "Tap the stars. Add a note if you have one.",
     "Hit `Send the rating`. Done."
    ],
    "title": "Rate one in four seconds"
   },
   {
    "t": "callout",
    "md": "**It always travels the quiet path.** Whatever the score, the rating lands privately in the inbox read by the people who run the LC's sessions — **TM and the LCP** — never as a shout-out to whoever booked it. A 5-star meeting doesn't email anyone \"💜 someone appreciated you\"; a person is never scored, only the session. The inbox shows ★★★★☆ beside the row.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "**You'll be asked — once.** The evening of a touch point (22:00 Cairo), everyone who was invited gets one email asking for the rating, with TM and the booker on CC. It says honestly how small the ask is (\"It is one tap. Five stars, pick one, done.\") — and it never sends twice for the same session, because an inbox that asks twice for a four-second job is an inbox people filter."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Do I have to have been marked attended to rate it?",
      "a": "No — any past touch point you were part of can be rated; attendance isn't required."
     },
     {
      "q": "Is the rating anonymous?",
      "a": "You can send it with the anonymity toggle on — your name won't be shown with it, and the rating counts either way."
     },
     {
      "q": "Can I rate a touch point without stars, just a note?",
      "a": "No — a touch point needs a rating and a rating needs a touch point; the server refuses one without the other. The note is the optional part."
     },
     {
      "q": "Who exactly reads the ratings?",
      "a": "The feedback inbox: the whole TM function, the LCP, and the IM director. Not the person who booked the session."
     }
    ]
   },
   {
    "t": "p",
    "md": "**Who gets asked (v33.42):** the evening nudge goes to the floor — members and MMs. VPs, Directors and the LCP aren't chased for a rating (they can still open Feedback and rate any touch point they were part of). **TM rides the CC on LC-wide sessions only** — a team meeting's rating is its own crew's business."
   }
  ]
 },
 {
  "id": "the-calendar",
  "title": "The calendar — everything on one month",
  "emoji": "🗓️",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "calendar",
   "month view",
   "visits calendar",
   "ir calls calendar",
   "touch points calendar",
   "filters",
   "my team",
   "day view",
   "الكالندر",
   "التقويم",
   "جدول الزيارات"
  ],
  "summary": "One month view holds your visits, IR calls, touch points and custom items — filter by kind, narrow by scope chips, and click any day for its full panel.",
  "blocks": [
   {
    "t": "p",
    "md": "[Calendar](/calendar) is one month with everything you're part of: **visits** (one stable color per member), **IR calls** (teal), **touch points** (purple) and **custom 📌 items** (green). Weeks start on Saturday, times are 12-hour, phones get agenda cards instead of a grid, and `?m=YYYY-MM` picks the month."
   },
   {
    "t": "p",
    "md": "**Filter by kind** with the chips on the filter bar — `Visits · IR calls · Touch points · Items`, each with its color dot. People whose remit spans functions also get a **function filter**; custom items are never filtered by function — they're invite-shaped and always yours."
   },
   {
    "t": "table",
    "headers": [
     "You are…",
     "Your scope chips"
    ],
    "rows": [
     [
      "Member / Coordinator",
      "Everyone · Mine · My team · My function (no My team chip if you have no teammates)"
     ],
     [
      "Team Leader",
      "Everyone · My team · My function (\"mine\" *is* the team)"
     ],
     [
      "LCVP / Director / LCP",
      "Everyone · My function (the function *is* your team)"
     ]
    ]
   },
   {
    "t": "p",
    "md": "Your chip choice is remembered per browser. \"Mine\" keeps your own visits and IR calls plus the touch points you're actually part of; \"Everyone\" is the whole picture you're allowed to see."
   },
   {
    "t": "steps",
    "items": [
     "Click any day — a panel opens with that Cairo day's touch points, IR calls, visits and items.",
     "Visit chips click through to the account (only ones you can open).",
     "If you can book touch points, `Book a touch point on this day` opens the dialog with the date pre-filled.",
     "On any future day, `Add item` drops a custom 📌 slot right there."
    ],
    "title": "The day panel"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why do I see other teams' touch points?",
      "a": "You see what you belong to: your team's points, your function's (other teams' included — same function, same floor) and every LC-wide one. Use the scope chips to narrow."
     },
     {
      "q": "Can I see another function's calendar?",
      "a": "No — the calendar is your own function's world (LCP/admin see all). The function filter only appears for people whose remit genuinely spans functions."
     },
     {
      "q": "Whose visits am I looking at?",
      "a": "The whole function's, one color per member, with a legend and counts — booking a visit puts it here automatically."
     }
    ]
   }
  ]
 },
 {
  "id": "touch-points-basics",
  "title": "Touch points: Meeting, Working hours & Outing",
  "emoji": "📅",
  "category": "touchpoints",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "touch point",
   "meeting",
   "working hours",
   "outing",
   "book a meeting",
   "routine",
   "virtual meeting",
   "google meet",
   "move meeting",
   "cancel meeting",
   "ميتنج",
   "توتش بوينت",
   "ازاي احجز ميتنج",
   "اجتماع"
  ],
  "summary": "A touch point is any LC moment — a Meeting, Working hours or an Outing — booked from the calendar, announced to everyone invited, and followed by an attendance sheet.",
  "blocks": [
   {
    "t": "p",
    "md": "A touch point is one of three things: a **Meeting**, **Working hours**, or an **Outing**. That's the whole name — where the audience starts (your team, your function, the LC) is a separate question, and who actually shows up is the one after that. Lists show it as \"Meeting · IGV\", plus \"(6 invited)\" when a guest list was hand-picked."
   },
   {
    "t": "diagram",
    "diagramId": "touch-point-flow",
    "caption": "Book it → people attend → attendance is recorded → the session gets rated"
   },
   {
    "t": "table",
    "headers": [
     "You are…",
     "You can book…"
    ],
    "rows": [
     [
      "Team Leader",
      "Your **team's** touch points (you may invite sibling teams of your function)"
     ],
     [
      "LCVP / Director",
      "Your **function's** touch points (you may invite another function)"
     ],
     [
      "TM core",
      "**LC-wide** touch points"
     ],
     [
      "LCP / admin",
      "Anything"
     ]
    ]
   },
   {
    "t": "steps",
    "items": [
     "Open [Calendar](/calendar) and hit the book button — or click any day and choose `Book a touch point on this day` (the date comes pre-filled).",
     "Pick the kind — **Meeting · Working hours · Outing** — and where the audience starts (the options match your role).",
     "Set the date and a **start time**. There is no end time — on purpose.",
     "Check **Who's invited** — everyone the scope reaches, already ticked. Untick anyone who isn't actually coming (see the \"Who's invited\" article).",
     "Optionally add a note, and for a **Meeting** you can flip on virtual — Sodio creates a real **Google Meet** link and puts it in everyone's invite.",
     "The **Tell everyone invited** switch is ON by default: everyone gets an email + a bell, with the TM VP on CC. Flip it off for a quiet booking."
    ],
    "title": "Book one"
   },
   {
    "t": "callout",
    "md": "**Logging something that already happened is silent.** Pick a past date and the touch point is simply recorded — no emails, no bells, nobody's inbox pays for your bookkeeping.",
    "tone": "tip"
   },
   {
    "t": "p",
    "md": "Booking a whole peak one evening at a time is a waste of an evening: the **Routine** builder lays out your repeating rhythm — every Tuesday meeting, every Saturday working hours — and creates them all up front. Each one is its own touch point, so one can be moved or cancelled without touching the rest."
   },
   {
    "t": "p",
    "md": "Plans change: it can be **moved or cancelled** from the calendar — tap the touch point and pick `Move or cancel`. Who may: always the person who booked it; the function's **VP/Director** for their function's team and function points; **TM** for LC-wide ones; the LCP/admin for anything. A cancel needs a reason, and either way everyone invited is emailed again."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why is there no end time?",
      "a": "Deliberate. A touch point has a start; how long it runs is life's business. Attendance for working hours is measured in a window around the start (see the Attendance article)."
     },
     {
      "q": "Can working hours or an outing be virtual?",
      "a": "No — only Meetings. Working hours are people sitting and working, and an outing is by definition somewhere."
     },
     {
      "q": "I RSVP'd to a virtual meeting in Google Calendar — does that count?",
      "a": "Yes. For virtual meetings your RSVP is read back from Google Calendar and pre-fills your attendance on its own."
     },
     {
      "q": "Who gets told when I book?",
      "a": "Everyone invited gets an email and a bell, with the TM VP on CC — unless you switched **Tell everyone invited** off, or the touch point is in the past (past ones are always silent)."
     }
    ]
   },
   {
    "t": "p",
    "md": "**Where it happens (v33.43):** every non-virtual touch point takes an optional **Where** — \"the office, third floor\", \"the café on Fouad St\" — and it rides every invite and move email. A virtual meeting's *where* is its Meet link, so the field is hidden there."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Who gets told (v33.43):** the people expected at it — minus whoever booked it (they know) and minus LCVPs/Directors/the LCP, who read the calendar rather than being pinged. Nobody is announced as \"booked by\" any more: the invite says the what, the when and the where. Attendance still covers everyone in the audience, leaders included."
   }
  ]
 },
 {
  "id": "touch-point-whos-invited",
  "title": "Who's invited — picking who is actually coming",
  "emoji": "✅",
  "category": "touchpoints",
  "audience": "Anyone who books touch points",
  "audienceKeys": [
   "leaders",
   "tm",
   "eb",
   "mm"
  ],
  "keywords": [
   "invited",
   "guest list",
   "audience",
   "untick",
   "invite list",
   "leaders and mms",
   "members only",
   "edit invited",
   "who's invited",
   "attendance sheet",
   "مين معزوم",
   "قائمة الدعوة"
  ],
  "summary": "Booking shows the derived audience as a tick list — untick people, use the one-tap group chips, and edit the list later; it can only ever narrow, and it locks once attendance is recorded.",
  "blocks": [
   {
    "t": "p",
    "md": "A touch point's people are **derived**: pick a scope and everyone matching it is invited, announced to, and marked present or absent. Right most of the time — wrong when three people already told you they can't make it. So booking shows **Who's invited**: the derived list, everyone ticked. Untick anyone and they're removed from the invite **and** from the attendance sheet — no more being marked absent from something nobody expected them at."
   },
   {
    "t": "steps",
    "items": [
     "Open **Who's invited** while booking — the count next to it says how many are in.",
     "Tap a chip to make it your audience in one go: **Leaders & MMs**, **Members only**, or any **team** in the list.",
     "Adjust individuals from there — tick and untick freely.",
     "The chips are built from the people in front of you, so they can never select someone outside the audience you were allowed to book."
    ],
    "title": "Use the group chips instead of thirty checkboxes"
   },
   {
    "t": "callout",
    "md": "**The list can only ever narrow.** It's an opt-out over the derived audience, validated server-side — a Team Leader cannot reach a name outside their own team, whatever the ticks say. And unticking *everybody* is refused: a touch point with nobody in it isn't one.",
    "tone": "info"
   },
   {
    "t": "callout",
    "md": "**Leave everyone ticked and the audience stays live**: nothing is stored, so someone who joins the function before the session is automatically in. The moment you untick even one person, the list is frozen to exactly the ticked people.",
    "tone": "tip"
   },
   {
    "t": "p",
    "md": "**It's editable after booking too.** People join, people drop out — open the touch point, go to **Who's invited → Edit**, and save. It's deliberately **quiet** (tidying a list the morning of a meeting must not email twenty people), and it **locks once attendance has been recorded** — that register was signed off."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I unticked myself — do I disappear from my own touch point?",
      "a": "You're off the invite and the attendance sheet, yes — but you still see the session on your calendar. You booked it; visibility is a separate question."
     },
     {
      "q": "Do Routine-created touch points get a guest list?",
      "a": "No — the Routine builder books derived points, which is the sane default for a whole peak booked up front. Edit any single one's list afterwards if you need to."
     },
     {
      "q": "Why can't I edit the list any more?",
      "a": "Attendance has been recorded for that touch point. The register was confirmed, so the list is locked."
     }
    ]
   }
  ]
 },
 {
  "id": "system-feedback",
  "title": "Report a bug or suggest a feature (system feedback)",
  "emoji": "🛠️",
  "category": "emails-feedback",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "feedback",
   "bug",
   "report bug",
   "suggestion",
   "enhancement",
   "broken",
   "feature request",
   "system feedback",
   "فيدباك",
   "مشكلة",
   "عطل",
   "اقتراح"
  ],
  "summary": "Something broken or an idea to make Sodio better? The System feedback form on your profile sends it straight to the IM team.",
  "blocks": [
   {
    "t": "p",
    "md": "Feedback about **Sodio itself** — a dead button, wrong numbers, a feature you wish existed — goes through **System feedback**. Find it on your [Profile](/profile) (the \"Give feedback\" card) — it opens the form at [/feedback](/feedback). Feedback about **people** is a different door: see [LC feedback](/lc-feedback)."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**Or just say it.** Next to **Send feedback** there's an **Or WhatsApp me directly** button — it opens a chat with the IM director carrying the page you were on. Use the form when it can wait and the detail matters (it keeps the type, the category and your screenshots, and it can't get lost in a chat); use WhatsApp when you're blocked right now, or when it's faster to show than to write."
   },
   {
    "t": "steps",
    "items": [
     "Open [/profile](/profile) and hit `Give feedback` (or go straight to [/feedback](/feedback)).",
     "Pick the type: **🐞 Bug**, **✨ Enhancement**, or **Other** — the category list adapts to your pick (for a bug: \"Doesn't work / button dead\", \"Wrong data / numbers\", \"Slow / laggy\"… for an enhancement: \"New feature\", \"UX / easier flow\", \"Mobile experience\"…).",
     "Describe it. Screenshots help enormously — **attach files** right on the form.",
     "Optionally flip **Send anonymously 🎭** — no name attached, but also no thank-you credit. Your call.",
     "Send. It reaches the IM team's private inbox."
    ],
    "title": "File it"
   },
   {
    "t": "callout",
    "md": "For bugs, say **what you clicked, what you expected, and what happened instead** — plus your phone/laptop. \"The dashboard is wrong\" takes a week to find; \"IGV lane shows 3 visits but I booked 4, here's the account\" takes an hour.",
    "tone": "tip"
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Report from anywhere** (v33.37, re-homed in v33.38): the 🛠️ button sits **beside the refresh button** (top-right) on desktop and **beside the notification bell** in the top bar on your phone — it opens this same form in a dialog and attaches the page you were on, so the IM team can find the problem fast."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who reads it?",
      "a": "Only the IM team — the inbox is restricted to the IM director and coach. If you didn't send anonymously, they can thank you (in-app + email) when it ships."
     },
     {
      "q": "This is about a person, not the system — where does it go?",
      "a": "Use [LC feedback](/lc-feedback) instead: shout-outs, concerns and touch-point ratings all live there, with their own privacy rules."
     },
     {
      "q": "Will I hear back?",
      "a": "Often yes — fixes tend to land fast, and the inbox has a thank-you action. Anonymous feedback is still read and acted on, there's just nobody to thank."
     }
    ]
   }
  ]
 },
 {
  "id": "emails-tab",
  "title": "Send branded emails from the Emails tab",
  "emoji": "📨",
  "category": "emails-feedback",
  "audience": "MMs and above",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "emails",
   "send email",
   "email tab",
   "gmail",
   "signature",
   "template",
   "layout",
   "bcc",
   "cc",
   "attachments",
   "violet man email",
   "write with ai",
   "ai email",
   "draft",
   "ازاي ابعت ايميل",
   "ايميل رسمي",
   "توقيع",
   "templates",
   "start from",
   "signature",
   "كتابة ايميل"
  ],
  "summary": "Write to a partner, an EP or another LC with the LC's look — it sends from your own Gmail, with your signature built automatically.",
  "blocks": [
   {
    "t": "p",
    "md": "**The Emails tab is every member's now (v33.41).** It used to be MMs and above, which just sent members back to a blank Gmail with no signature. The letter still goes out from **your own Gmail** — Sodio is the stationery, not the sender — so nothing reaches further than it did; what you gain is the LC's layout, your real signature, and a starting point. The [Emails](/emails) tab (Coordinators and above) is Sodio's stationery: pick a starting point, write, preview, send. It goes out from **your own Gmail** — the reply lands in your inbox and the email sits in your Sent folder. Sodio supplies the frame, not the sender."
   },
   {
    "t": "steps",
    "items": [
     "Open [/emails](/emails) and pick a starting point: **Blank**, **Reaching a company**, **Following up**, **Thank you after a meeting**, or **Writing to another LC**.",
     "Add recipients in **To** — type any address, or pick anyone in the LC by name (works in **Cc** and **Bcc** too, and you can reuse addresses you've written to before). `+ Cc` / `+ Bcc` reveal those fields.",
     "Or tap a **group chip** — My team, Everyone, the EB, the LB, all MMs, any function or standing team. Each chip expands into real addresses you can still edit or remove, and they're built from the membership so they can't go stale.",
     "Write the letter. The editor has bold/italic/underline, links, numbered lists, quotes, a **text-size menu** (each option shown at its own size), droppable AIESEC logos, and spell check on every field.",
     "Pick a **layout**: Branded card, Bold banner, Letterhead, or Plain.",
     "Hit `Preview` — it's rendered by the **same code that sends**, so what you see is exactly what lands in their inbox.",
     "Hit `Send now`, or `Save as draft` to leave it in your Gmail and sleep on it."
    ],
    "title": "Send an email"
   },
   {
    "t": "p",
    "md": "**Your signature is automatic**: name, your full role title, AIESEC in Alexandria, your WhatsApp-linked number and the AIESEC human mark — built from your membership row. Nothing to paste, nothing to forget. **It names every function you hold** (v34.10) — someone who is Director of two things signs as both, and CXP says which side, ICX or OGX. If yours reads wrong, the fix is your **Functions / Sub functions** on the membership row, not the email."
   },
   {
    "t": "callout",
    "md": "Stuck on the words? The **✨ Write with AI** button writes or reworks the letter — describe what you want, or ask it to shorten, warm up, or translate what you already typed. (It used to be labelled \"Violet Man\", which named the assistant instead of saying what the button does.) It drafts, you decide: **always read it before you send**.",
    "tone": "tip"
   },
   {
    "t": "callout",
    "md": "**Attachments**: an email carrying files is left in your **Gmail drafts** instead of sending straight away — open Gmail, check the files landed, and hit send from there. And your half-written email **survives leaving the tab**: everything is saved as you type, so a wrong click costs you nothing. `Start again` wipes it when you actually want a clean slate.",
    "tone": "info"
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Two doors moved in here** (v33.37): the **Expectation mail** button (top-right, for its usual OGT/OGV leaders — the sidebar tab is gone) and a **Signing the contract** template for OGX MMs+ — subject, the signing steps and the EP's to-do list prefilled, `customer.support@aiesec.net.eg` added to CC automatically. Attach the contract + acceptance note (attachments take several files) and send."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who can see the Emails tab?",
      "a": "MMs and above — Coordinators, Team Leaders, Directors, LCVPs and the LCP. Members write to partners through the account's **Proposal email** button instead."
     },
     {
      "q": "Can Bcc recipients see each other?",
      "a": "No — it's a real `Bcc:` header, so Gmail strips it from every delivered copy. Nobody in To or Cc sees the Bcc list either."
     },
     {
      "q": "Where do replies go?",
      "a": "Straight back to your own Gmail — Sodio never sits in the middle. The **Sent before** list on the tab remembers who you've written to."
     },
     {
      "q": "I left mid-email — is it gone?",
      "a": "No. Recipients, subject, body, layout and template are all restored when you come back. Only `Start again` clears them."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**What your email looks like (v34.10)**: the **AIESEC in Alexandria logo** sits on top of every email Sodio sends — yours and the automatic ones, inside the LC and outside it. The frame under it is the LC's purple, and the bottom of every email carries **\"Powered by Sodio\"** with **\"Made by 2.0\"** in smaller type beneath. You don't set any of it; it's the house style."
   },
   {
    "t": "p",
    "md": "**\"Start from\" is yours.** The template list is built from what you actually do: raising crews see the company pitch, the follow-up and the thank-you; OGX sees reaching a sign-up, nudging a quiet EP and (MMs) the contract mail; consideration sees writing to another LC and asking for their CVs; B2C sees the customer offer; TM sees the team invite. Everyone keeps **Blank**. **Group blasts stay an MM's tool** — a member addresses their own team and function, not the whole LC."
   }
  ]
 },
 {
  "id": "expectation-mail",
  "title": "Send the Expectation mail (OGT/OGV)",
  "emoji": "✉️",
  "category": "emails-feedback",
  "audience": "OGT & OGV VPs/Directors",
  "audienceKeys": [
   "ogx",
   "leaders",
   "eb"
  ],
  "keywords": [
   "expectation mail",
   "expectation setting",
   "home entity",
   "ogt mail",
   "ogv mail",
   "ep email",
   "ir email",
   "tn fee",
   "salary",
   "vp email",
   "ميل التوقعات",
   "ايميل EP"
  ],
  "summary": "Build the Home Entity Expectation Setting email from a form, review the exact final version, and send it from your own Gmail.",
  "blocks": [
   {
    "t": "p",
    "md": "The **Expectation mail** tab (route `/ogt-mail`, for OGT & OGV VPs/Directors + the LCP) turns the pre-approval \"Home Entity Expectation Setting Mail\" into a form: fill the standardized fields once, review the exact email, send. If you hold both programs, a **variant toggle** switches between the OGT and OGV versions — OGT keeps **Salary (If any)**, OGV requires **TN Fee and what it covers**."
   },
   {
    "t": "steps",
    "items": [
     "Fill the form: numeric **EP ID** and **Opportunity ID**, the slot dates (picked from a calendar, rendered like \"Aug 5, 2026\"), flexible per-day **working-hours rows**, and the logistics questions (with details where you answer yes).",
     "Enter both recipients — the **EP's email and the IR's email** are required. `customer.support@aiesec.net.eg` is always on CC (shown read-only so you know).",
     "Hit the build button to reach the **review step**: the final email renders in-app with an **editable subject** (defaults to \"Home Entity Expectation Setting Mail\") and an **editable body** — click into it and fix anything.",
     "Choose `Send now` (goes out from **your own Gmail**) or `Save as draft instead` (lands in your Gmail Drafts for you to send later)."
    ],
    "title": "Build and send it"
   },
   {
    "t": "p",
    "md": "The email ends with **your signature** — name, position (LCVP/Director, Outgoing Global Talent/Volunteer), phone and email — so the EP knows exactly who's writing."
   },
   {
    "t": "callout",
    "md": "The review step **survives tab switches** — your built preview, edited subject and body are cached, so checking something else mid-way costs you nothing.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can I edit the email before it goes out?",
      "a": "Yes — that's the whole point of the review step. Both the subject and the body are editable in place; what you see is what's sent."
     },
     {
      "q": "Who does it actually send from?",
      "a": "Your own Gmail, via the grant you gave at first sign-in. Replies come back to you and the email sits in your Sent folder."
     },
     {
      "q": "Why won't it send without the IR's email?",
      "a": "Both the EP and the IR must be in To — the expectation mail is for both sides, and the server requires both addresses."
     }
    ]
   }
  ]
 },
 {
  "id": "lc-feedback",
  "title": "Shout-outs, concerns & touch-point ratings (LC feedback)",
  "emoji": "💜",
  "category": "emails-feedback",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "lc feedback",
   "shout out",
   "shoutout",
   "concern",
   "complaint",
   "anonymous",
   "rate touch point",
   "rating",
   "stars",
   "appreciation",
   "شكوى",
   "تقييم",
   "شكر",
   "فيدباك عن حد"
  ],
  "summary": "Appreciate someone, raise a concern privately, or rate a touch point 1–5 stars — with an anonymous option on all of it.",
  "blocks": [
   {
    "t": "p",
    "md": "[LC feedback](/lc-feedback) is the sidebar's door for feedback about **people and sessions** (Sodio bugs go to [System feedback](/feedback)). Three jobs, three paths: a **🎉 shout-out** reaches the person directly; a **😟 concern** goes to a private inbox; **a touch point gets 1–5 stars** and travels the quiet inbox path whatever the score."
   },
   {
    "t": "steps",
    "items": [
     "Open [/lc-feedback](/lc-feedback). The form opens on **Concern** — flip to **🎉 Shout-out** if you're here with good news.",
     "Pick **what it's about**: people, or **A touch point** (any past touch point you were part of — you don't have to have been marked present).",
     "For people: use the smart **quick-pick chips** (My TL, my team… — level-aware, you're never offered yourself) or search the LC and pick up to 10 names.",
     "For a touch point: pick the session and tap the **stars** (1 = Poor → 5 = Excellent). The stars ARE the review — the note is optional.",
     "Write the message (required except for ratings), **attach files** if they help, and optionally flip **Send anonymously 🎭**.",
     "Send. A shout-out bells + emails the person; a concern lands privately; a rating lands in the inbox with its stars."
    ],
    "title": "Send one"
   },
   {
    "t": "callout",
    "md": "**Who sees a concern**: only TM (the whole function), the LCP and the IM director — the private channel. Your name won't be shown with an anonymous one. A shout-out to several people goes as **one email with everyone on BCC**, so recipients never see each other's addresses.",
    "tone": "info"
   },
   {
    "t": "callout",
    "md": "Attended a touch point today? Expect **one evening email** asking you to rate it — it's genuinely one tap: five stars, pick one, done. You're asked exactly once per touch point.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does a 5-star rating notify the organizer?",
      "a": "No — ratings always travel the quiet inbox path, whatever the score. A person is never scored; only the session is."
     },
     {
      "q": "If I file anonymously, can they still tell me it was handled?",
      "a": "Yes — the inbox has a \"tell them it's handled\" action that reaches you without revealing you to anyone reading the inbox."
     },
     {
      "q": "Why can't I rate a person?",
      "a": "By design. Stars are for sessions (\"good, but it ran long\" is not a complaint about anybody); for people you have shout-outs and concerns."
     },
     {
      "q": "Can a shout-out be anonymous?",
      "a": "Yes — they'll know someone appreciated them, just not who."
     }
    ]
   }
  ]
 },
 {
  "id": "feedback-inbox",
  "title": "Work the LC feedback inbox",
  "emoji": "📥",
  "category": "emails-feedback",
  "audience": "TM, the LCP & IM",
  "audienceKeys": [
   "tm",
   "admin"
  ],
  "keywords": [
   "feedback inbox",
   "concerns inbox",
   "handle concern",
   "share feedback",
   "mark done",
   "archive feedback",
   "tell author",
   "ratings inbox",
   "انبوكس الفيدباك",
   "شكاوى"
  ],
  "summary": "Concerns, touch-point ratings and shout-outs grouped by kind, with states, sharing, and a way to answer the author — even an anonymous one.",
  "blocks": [
   {
    "t": "p",
    "md": "The inbox opens from the **Inbox** button on [/lc-feedback](/lc-feedback) — visible only to its owners: **TM (the whole function), the LCP and the IM director**. New concerns bell + email exactly that list. Rows are grouped into three kinds — **😟 Concerns · 📅 Touch points · 🎉 Shout-outs** — each with an unread count, filtered by state: **Open · Done · Archived**."
   },
   {
    "t": "steps",
    "items": [
     "Read it — attachments open right from the row, and touch-point rows show their **★ rating** at a glance.",
     "`📨 Share` passes it to anyone in the LC (bell + email carrying the **message only** — the author's identity never travels, so anonymity survives being passed on). The row remembers who it was shared with.",
     "`💬 Tell them it's done` sends the author a \"it's handled\" note (optional message included) — this reaches **even anonymous authors**: Sodio knows who wrote it, you still don't.",
     "`Done` closes it (the row records who closed it and when); `🗄️ Archive` files it away; `↩️ Reopen` brings an archived row back."
    ],
    "title": "Handle a row"
   },
   {
    "t": "callout",
    "md": "Rarely, an anonymous row shows **\"🎭 Anonymous — Name (admin eyes only)\"**. Only the break-glass admin sees that name, and the label means what it says: **it must not leave that screen**. To everyone else in the inbox the row is simply anonymous — keep it that way when sharing or discussing it.",
    "tone": "warn"
   },
   {
    "t": "table",
    "headers": [
     "Kind",
     "How it arrived",
     "What to do with it"
    ],
    "rows": [
     [
      "😟 Concern",
      "Privately filed about a person — the author may be anonymous",
      "Handle it with TM/the LCP, share to whoever can act, tell the author when it's resolved"
     ],
     [
      "📅 Touch point",
      "A 1–5 star session rating (note optional) — the evening email asks attendees automatically",
      "Scan the stars, read the notes, feed it back to whoever runs sessions"
     ],
     [
      "🎉 Shout-out",
      "The person already got it (bell + email) — this is your copy",
      "Enjoy it, mark done. Nothing to fix"
     ]
    ]
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does sharing a row reveal who wrote it?",
      "a": "Never. The share email and bell carry the message, not the author — an anonymous row stays anonymous no matter how many times it's passed on."
     },
     {
      "q": "What happened to the 'seen' state?",
      "a": "It was merged away — seen and done were the same thing in practice. The states are new (Open), done, and archived."
     },
     {
      "q": "Why don't 5-star touch points show up as shout-outs?",
      "a": "Ratings always take the quiet path, whatever the score — a great meeting is data for the session-runners, not applause for a person."
     }
    ]
   }
  ]
 },
 {
  "id": "distribute-work",
  "title": "Distribute the work — pools, reassigns & claims",
  "emoji": "📦",
  "category": "leaders",
  "audience": "Team Leaders & above",
  "audienceKeys": [
   "leaders",
   "mm",
   "eb"
  ],
  "keywords": [
   "unassigned",
   "reassign",
   "bulk assign",
   "claim",
   "distribute accounts",
   "hand over",
   "pool",
   "market research",
   "cross-function",
   "sign-ups pool",
   "توزيع الاكونتات",
   "ازاي اوزع الشغل"
  ],
  "summary": "How the unassigned pool, single and bulk reassigns, claiming and cross-function hand-overs work — and why an account always follows its new owner's function.",
  "blocks": [
   {
    "t": "p",
    "md": "Imported market research lands **unassigned** — nobody's until distributed. Everyone above the Member role (Coordinators, TLs, Directors, VPs, LCP) sees the unowned pool on [Raising](/accounts) via the Responsible filter's **— Unassigned** option; plain Members never do, so their list stays a to-do list of their own work."
   },
   {
    "t": "diagram",
    "diagramId": "roles",
    "caption": "Who sees which accounts — the scope every reassign and leaderboard runs on."
   },
   {
    "t": "steps",
    "items": [
     "One account: open it and use the Responsible picker — a TL chooses self or a team member, leaders reach their whole function.",
     "Many: on [Raising](/accounts), enter Select mode, tick the rows (or `All`), then `Assign to…`. RBAC re-runs per row — rows outside your reach are skipped and counted in the toast.",
     "Leave **`Email them about it 📬`** on to send the new owner a bell + an email listing the accounts. Assigning to yourself sends nothing."
    ],
    "title": "Reassign accounts (single or bulk)"
   },
   {
    "t": "p",
    "md": "**An account always follows its owner.** Hand an account to someone who doesn't work its function and it MOVES to theirs — leaving it behind would make it vanish from the new owner's list while still counting on the old function's dashboard. IGTe → IGV lands on Global Classroom by default; a move blocked by an archived namesake in the target world tells you so in plain words. **Claiming** works the same way: any unowned account can be claimed by anyone with create rights, in any function, and it lands in the claimer's function."
   },
   {
    "t": "p",
    "md": "On [Sign-ups](/signups) the Unassigned tab is the pool: members claim one (`Claim → Contact` — if the function leader has left self-claiming on) or leaders bulk-assign with the same per-row checks. Referrals are assigned from birth — an unassigned sign-up is invisible to the OGX dashboard by design. And promoting a Member/Coordinator to TL+ automatically releases their status-less sign-ups back to the pool."
   },
   {
    "t": "callout",
    "md": "Unassigned accounts are deliberately half-locked: booking a visit or recording an unsplit deal on one fails with an \"assign it first\" message. Distribute first, then work.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why can't my member see the unassigned pool?",
      "a": "By design — distribution is an MM's job. Assign or let them claim; once it's theirs it's on their list."
     },
     {
      "q": "I reassigned 30 accounts and 4 were skipped — why?",
      "a": "The per-row RBAC check refused them: outside your scope or a function the target can't hold. The toast counts the skips; the rest went through."
     },
     {
      "q": "Does a hand-over notify the old owner?",
      "a": "No — the notification (bell + optional email) goes to the NEW responsible, listing what they just received."
     },
     {
      "q": "An account changed from IGT to IGV on its own — what happened?",
      "a": "It was handed to (or claimed by) someone who works IGV. The account follows its owner's function, always — check its History for the reassign entry."
     }
    ]
   }
  ]
 },
 {
  "id": "edit-the-membership",
  "title": "Edit the membership (EB)",
  "emoji": "🧑‍🤝‍🧑",
  "category": "leaders",
  "audience": "The EB",
  "audienceKeys": [
   "eb",
   "admin"
  ],
  "keywords": [
   "membership",
   "add member",
   "edit member",
   "sheet",
   "AIESEC mail",
   "personal gmail",
   "backup email",
   "manager",
   "stakeholder",
   "teams",
   "reset password",
   "deactivate",
   "تعديل الاعضاء",
   "اضافة عضو"
  ],
  "summary": "The Membership Google Sheet is the source of truth, synced both ways — here's how the EB edits members, what the two email fields mean, how managers default, and what the Reset password button really does.",
  "blocks": [
   {
    "t": "callout",
    "tone": "info",
    "md": "**Sodio is the membership now (v37.2).** Edit people here, or press **Download**, change the list in Excel, and **Upload** it back: Sodio shows exactly who is new, what changes for whom, and any line it can't read (with the reason) before anything is written. The “CRM — Membership” sheet is a mirror Sodio keeps writing — edits made in the sheet are no longer read back. Team Leaders can also mark their own members inactive from their profile."
   },
   {
    "t": "p",
    "md": "Editing is an **EB** power — LCVPs and the LCP/admin on [/membership](/membership); Directors have function authority but don't edit membership. Since v37.2 **Sodio is the source**: the **CRM — Membership** Google Sheet is a mirror Sodio rewrites (**Rewrite the sheet** forces it), and the half-hourly import no longer reads it back. A plain **Upload** updates people; a **restart** upload (whoever isn't on the file goes inactive, history kept) is the LCP's/admins', for a new peak or term."
   },
   {
    "t": "steps",
    "items": [
     "Open [/membership](/membership), search by name, email, team, function or role.",
     "Click a member to edit, or `Add member`. Every save syncs to the sheet — the toast says so.",
     "Set the role (LCP · LCVP · Director · Team Leader · Coordinator · Member), functions and sub-functions (free-form — unknown values are kept as chips), the manager, and the team from the registry picker.",
     "Flip `Active` off to deactivate — they land on the /inactive screen at next sign-in, everywhere (login, Google, mid-session)."
    ],
    "title": "Edit or add a member"
   },
   {
    "t": "table",
    "headers": [
     "Field",
     "What it is"
    ],
    "rows": [
     [
      "AIESEC Mail",
      "The identity: sign-in + what the Membership sheet carries. Optional at first (phone-only members exist), locked once set — adding it later is the upgrade path"
     ],
     [
      "Personal Gmail — backup only",
      "A DIFFERENT inbox for password resets and IR-call invites until the @aiesec.net lands. Never a sign-in, never written to the sheet — the half-hourly import can't clobber it. Refused if it equals the AIESEC Mail"
     ]
    ]
   },
   {
    "t": "p",
    "md": "**Manager defaults** (the UI word for the sheet's Stakeholder): when no manager is named, an MM (TL/Coordinator/Member) gets their function's VP, else the function's Director, else the LCP; VPs and Directors get the LCP. A plain Member can never be anyone's manager. **Teams registry** (the Teams card): five types — EB and LB are single teams; `Function`, `Function leaders` and `Team` exist per function, with `Team` being the many TL teams. The sheet's Teams tab mirrors the in-app registry after every change."
   },
   {
    "t": "p",
    "md": "**`Reset password`** (in the member dialog) does exactly what the login page's **Forgot password** does: it generates a fresh password and **emails it to the member** — their AIESEC Mail, or the backup Gmail if that hasn't landed yet. Their old password keeps working until they change it, so nobody is ever locked out by the button. (A phone-only member with no email at all can't receive one — they sign in with their phone in both fields instead.)"
   },
   {
    "t": "callout",
    "md": "A member with no email at all signs in with their **phone in both fields** until a password is set. And renames travel: correcting a spelling cascades to touch points, IR logs, sign-up assignments and manager-by-name references, so filters never offer the same person twice.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Can I just edit the Google Sheet directly?",
      "a": "Not any more — since v37.2 the membership sheet is a MIRROR: Sodio writes it, and edits made there are not read back. Edit in Sodio, or Download → change it in Excel → Upload (you'll see every change before anything is written). The other mirror sheets (Raising Accounts, Visits…) work the same way."
     },
     {
      "q": "Why can't I pick a Member as someone's manager?",
      "a": "By rule — managers are TL and above. The dialog won't offer it and the server refuses it."
     },
     {
      "q": "One person works two functions — how do I record that?",
      "a": "The Function cell takes several values (\"B2B, BD\" or \"IGV, IGT\") and the member gets both workspaces. Same for sub-functions."
     },
     {
      "q": "What happens to a promoted member's sign-ups?",
      "a": "Moving a Member/Coordinator to TL+ releases their status-less sign-ups back to the Unassigned pool automatically — rows with a status keep their history."
     }
    ]
   }
  ]
 },
 {
  "id": "function-defaults",
  "title": "Function defaults — your function, your switches",
  "emoji": "🎛️",
  "category": "leaders",
  "audience": "LCVPs & Directors",
  "audienceKeys": [
   "leaders",
   "eb",
   "admin"
  ],
  "keywords": [
   "function defaults",
   "settings",
   "podio cycle",
   "cadence",
   "who sees what",
   "open the floor",
   "claiming",
   "CIC",
   "referrals",
   "streak nag",
   "working hours",
   "attendance reminders",
   "اعدادات الفنكشن"
  ],
  "summary": "A card on every function leader's profile that replaces hard-coded behaviour with switches — Podio cadence, read-only visibility per role, OGX toggles and TM's attendance rules; untouched means exactly the old behaviour.",
  "blocks": [
   {
    "t": "p",
    "md": "If you lead a function (LCVP or Director — LCP/admin get all eight: IGV, IGT, B2B, BD, B2C, OGT, OGV, TM), your function's switches live in **[Settings](/profile/settings?tab=function) → My function** (they moved off the profile in v37.2). Every switch replaces a constant that used to live in the code, and every one is wired to something real. A function whose leader never opens it behaves exactly as it always did. The same page holds **🔑 MM access** — whose work each of your MMs reaches ([how it works](/help?a=mm-access))."
   },
   {
    "t": "steps",
    "items": [
     "Open your [profile](/profile) → **Settings** → **My function** — one block per function you lead.",
     "Flip the switches you want. Only the groups your function actually uses are shown — a TM leader never sees a Podio cadence, a B2C leader never sees the OGX pool.",
     "Hit `Save`. Only the switches on screen are sent; nothing off-screen can be blanked."
    ],
    "title": "Change a default"
   },
   {
    "t": "table",
    "headers": [
     "Group",
     "Functions",
     "Switches"
    ],
    "rows": [
     [
      "New accounts & Podio",
      "IGV · IGT · B2B · BD · B2C",
      "Do NEW accounts join the Podio continuous-update cycle, and every how many days (1–90). Old defaults: IGV/B2C/BD on, IGT/B2B off, 14 days · Do visit announcements ALSO reach the LCVP/Directors (off by default since v33.38 — they always ride the calendar invite) · (IGV/IGT) Whether MMs hand 🤝 partnership targets across teams (off by default: a TL targets their own team only) · **Visits land on my calendar** — ON by default: every visit in the function invites you to its calendar event; OFF leaves it to the member and their TL (v33.44)"
     ],
     [
      "Who sees the whole function",
      "Raising + OGX functions",
      "Per role — Members / Coordinators / Team Leaders — may OPEN every account or sign-up in the function. **Read-only**: editing, reassigning and every leaderboard stay exactly as scoped before"
     ],
     [
      "OGX",
      "OGT · OGV",
      "Self-service claiming from the unassigned pool · the CIC second-call queue · who may log a referral (everyone vs MMs and above) · the daily streak nag email"
     ],
     [
      "Attendance (TM)",
      "TM",
      "The attendance-reminder ladder · automatic pre-fill of working-hours attendance · whether a function is judged on working hours at all"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "The visibility switches widen **reads only, inside your function only**. An opened Member can open every account and read its history, but can't edit, reassign or archive anything that isn't theirs — and dashboards, leaderboards and every mutation still run on the unchanged scope.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I changed the Podio cadence — do existing accounts move?",
      "a": "The default applies to NEW accounts. An existing account's cadence is edited on its own \"Podio — continuous update\" card, which restarts its countdown."
     },
     {
      "q": "If I turn claiming off, what happens to the pool?",
      "a": "Members stop self-claiming; leaders still distribute sign-ups by assigning them. Nothing already claimed moves."
     },
     {
      "q": "Can a Team Leader or Coordinator open this card?",
      "a": "No — it's the function's LCVP/Director (and LCP/admin). The switches are the leader's call about their own floor."
     },
     {
      "q": "What does an unset switch mean?",
      "a": "Exactly the behaviour that shipped before the card existed — that's locked by tests, so an LC that never opens it cannot notice it exists."
     }
    ]
   }
  ]
 },
 {
  "id": "mm-access",
  "title": "MM access — whose work each MM can reach",
  "emoji": "🔑",
  "category": "leaders",
  "audience": "VPs & Directors (and the MMs it's about)",
  "audienceKeys": [
   "leaders",
   "eb",
   "mm",
   "admin"
  ],
  "keywords": [
   "mm access",
   "access",
   "team leader",
   "coordinator",
   "my team",
   "whole function",
   "only themself",
   "permissions",
   "scope",
   "who can see",
   "reach",
   "turn a tl into a coordinator",
   "settings",
   "my function",
   "vp",
   "director",
   "صلاحيات",
   "تيم ليدر",
   "كوردينيتور"
  ],
  "summary": "A VP or Director decides, for each Team Leader and Coordinator in their function, whether they reach their own team, every member of the function, or only themself.",
  "blocks": [
   {
    "t": "p",
    "md": "Until now the role decided it alone: a **Team Leader** reached their direct team, a **Coordinator** reached nobody but themself. Now the function's **LCVP or Director** decides it per MM, from **[Settings](/profile/settings?tab=function) → My function → 🔑 MM access**. It's there for every operations function — **IGV, IGT, B2B & BD, B2C, OGT and OGV** — and the LCP/admin can set it for all of them."
   },
   {
    "t": "table",
    "headers": [
     "Setting",
     "What the MM can do"
    ],
    "rows": [
     [
      "**Their team**",
      "See and work their own team's accounts, sign-ups and calls — a Team Leader's normal access."
     ],
     [
      "**The whole function**",
      "See and work every member's accounts, sign-ups and calls in the function — like a Team Leader over the whole floor. Handy for an MM who runs the queue, or covers for a sprint."
     ],
     [
      "**Only themself**",
      "Their own work only — a Coordinator's normal access. This is how you turn a Team Leader into a Coordinator for access without touching the membership."
     ],
     [
      "**Default**",
      "No setting: Team Leaders get *their team*, Coordinators get *only themself* — exactly how Sodio behaved before."
     ]
    ]
   },
   {
    "t": "steps",
    "title": "Change an MM's access",
    "items": [
     "Open your [profile](/profile) → **Settings** → **My function**.",
     "In **🔑 MM access**, find the MM (each function you lead has its own list; B2B and BD are one list).",
     "Pick **Their team**, **The whole function**, **Only themself** — or **Default** to undo your choice. It saves the moment you pick, and the MM gets a bell telling them what changed."
    ]
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**What it covers:** whose accounts appear on the MM's Raising list and who they can edit and hand over, whose sign-ups they see under *My sign-ups* and can work or re-assign, who they can hand B2C calls to, which IR calls they answer for (the *calls need you* banner and handing a call over) and whose approvals they can correct. **What it doesn't change:** who reports to whom — the team card, the team plan, the team leaderboard, attendance and PDPs still follow the Manager column."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Does 'The whole function' include the VP's own accounts?",
      "a": "No — the function's LCVPs, Directors and the LCP aren't part of the floor an MM reaches. It's every Member, Coordinator and Team Leader who works the function."
     },
     {
      "q": "An MM works two functions with different VPs — what wins?",
      "a": "Each VP sets their own function. Whatever was set explicitly is what counts (a 'none' on one isn't undone by the other function's untouched default); if both set something, the MM reaches the union."
     },
     {
      "q": "Can a Team Leader set this for themself?",
      "a": "No — it's the function's LCVP/Director (or LCP/admin), and it can't be changed from a test view."
     },
     {
      "q": "I changed it and the MM still sees the old list.",
      "a": "It applies within about a minute (settings are cached briefly on each server). A refresh after that shows the new reach."
     }
    ]
   }
  ]
 },
 {
  "id": "leaderboards",
  "title": "How the leaderboards work",
  "emoji": "🏆",
  "category": "leaders",
  "audience": "Everyone with a lane",
  "audienceKeys": [
   "everyone",
   "leaders"
  ],
  "keywords": [
   "leaderboard",
   "ranking",
   "opens",
   "board",
   "MMs board",
   "members board",
   "re-sort",
   "team board",
   "approvals",
   "ليدر بورد",
   "الترتيب",
   "مين الاول"
  ],
  "summary": "Two boards per lane — Members and MMs — every funnel number at once, click any column header to re-rank, and leaders above MM never appear.",
  "blocks": [
   {
    "t": "p",
    "md": "Every lane on the [dashboard](/dashboard) carries **two leaderboards side by side**: a **Members** board (role Member) and an **MMs** board (Team Leaders & Coordinators). VPs, Directors and the LCP never appear on any board — leaders steer, they aren't ranked against the people they steer."
   },
   {
    "t": "p",
    "md": "Each board shows **every funnel number at once**, in funnel order: MR · Contacted · Visits · Visits done · Deals · Opens. **Click any KPI header to re-rank** by it — the rows glide into their new order. Default sort is Opens (Deals on the B2C lane, Approvals on OGX). \"Contacted\" counts accounts with at least one contact, not how many attempts you logged."
   },
   {
    "t": "p",
    "md": "On raising lanes, each row is that person's **own accounts** — no team rollup — and a deal always belongs to the account's **Responsible**, not whoever clicked `Record deal`. Personal Opens come from **deal allocations**: if a deal's opens were split across members, each person's board row shows exactly the share allocated to them, and someone who received split opens without owning the account still gets a row."
   },
   {
    "t": "p",
    "md": "On OGX lanes the two boards split the same way, with one twist: **an MM's number is their team's** — their own sign-ups land on their line, and so do their members'. When a sign-up went through CIC, both callers carry the sign-up and the contact (both actually spoke to the person), but the **outcome** (Applied → Accepted → Approved) counts for the second caller who took it there — and the function total still counts each sign-up exactly once."
   },
   {
    "t": "p",
    "md": "If your manager is a real Team Leader, you also get a **team leaderboard** — your team only. It ranks the team, not its leader: the TL doesn't take a row on the board they read, though their own accounts still count in the team plan's actuals."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I'm a Team Leader — why am I not on the Members board?",
      "a": "You're on the MMs board with the other Team Leaders and Coordinators. Members and MMs do different jobs; ranking them on one list flattered neither."
     },
     {
      "q": "My opens number dropped after a deal was recorded — how?",
      "a": "The deal's opens were probably split. Boards read allocations, so you only carry the share that was allocated to you. Open the deal's history entry to see the split."
     },
     {
      "q": "Can I see the boards for just this sprint?",
      "a": "Yes — the `This sprint` / `This month` chips and the date range re-scope the whole lane, boards included. Only the member filter is KPI-only."
     }
    ]
   }
  ]
 },
 {
  "id": "plans-are-the-goals",
  "title": "Plans are the goals",
  "emoji": "🎯",
  "category": "leaders",
  "audience": "MMs & leaders",
  "audienceKeys": [
   "leaders",
   "mm",
   "eb"
  ],
  "keywords": [
   "plan",
   "goals",
   "planning",
   "tl plan",
   "mm plan",
   "opens plan",
   "period report",
   "sprint",
   "quarter",
   "PlanCard",
   "my plan",
   "الخطة",
   "الاهداف",
   "البلانينج"
  ],
  "summary": "Nobody sets goals inside Sodio — the lane goal is the VP planning sheet, the team goal is the TL's filed plan, every MM files their own, and closing periods email a waterfall report.",
  "blocks": [
   {
    "t": "p",
    "md": "There is no `Set goal` button anywhere in Sodio, on purpose. Goals come from planning: the **lane goal** is the VP planning sheet (imported as plan cells), the **team goal** is the Team Leader's own filed plan, and every MM files a personal plan. Progress is drawn against real numbers automatically."
   },
   {
    "t": "callout",
    "tone": "warn",
    "md": "**A filed plan is private to the person who filed it (v36).** Until now every member of a team was shown their Team Leader's plan — their target and their shortfall — on their own dashboard, every day. That is a number between an MM and whoever reviews them, and there is nothing a member can do with it. You now see **only your own** plan. The Violet Man will not read out somebody else's either, and if you ask him he will say so.\n\nThe **function's** goal is a different thing and is untouched: it is what the whole crew is chasing together, and everybody still sees it."
   },
   {
    "t": "table",
    "headers": [
     "Card",
     "Where",
     "What it compares"
    ],
    "rows": [
     [
      "PlanCard (lane goal)",
      "Dashboard product lanes — leaders only",
      "The planning sheet's opens for the current sprint or month vs actual opens raised (toggle sprint/month). The B2B lane has no planned goal — the planning sheet skips B2B/BD"
     ],
     [
      "TeamPlanCard (team goal)",
      "Dashboard, when your manager is a real TL",
      "The TL's filed opens plan for this month vs the team's allocation-attributed actuals"
     ],
     [
      "My plan",
      "[Your profile](/profile)",
      "Your own filed plan per month of the peak vs your actuals — a TL's actuals cover the whole team, a Coordinator's their own"
     ]
    ]
   },
   {
    "t": "steps",
    "items": [
     "**Raising MMs** (Team Leaders AND Coordinators of IGV/IGT/B2B/BD): you file opens per month of the peak on first sign-in, and edit any time from the **My plan** card on [your profile](/profile).",
     "**OGX & Consideration MMs**: you file applicants / accepted / approvals for the peak's months on first sign-in, and edit from the same profile card.",
     "Work both sides? You file both plans — the raising opens card and the funnel card sit next to each other on the profile."
    ],
    "title": "File or edit your plan"
   },
   {
    "t": "p",
    "md": "[/planning](/planning) (LCP/admin + VPs & Directors of IGV/IGT/OGV/OGT) shows each function's full picture: sprint / month / quarter cards with plan vs actual opens, funnel tables, conversions, and the **MM plans** and **Raising MM plans** cards — each leader sees their own function's plans only."
   },
   {
    "t": "p",
    "md": "**Period reports**: every time a sprint, month or quarter closes, each function (IGV, IGT, B2B & BD) and the LCP get a **waterfall report email** — totals, plan vs achieved, then per team (bold) down to per person rows. It's automatic; nobody has to compile anything."
   },
   {
    "t": "callout",
    "md": "Calendar math, so the cards make sense: the term runs Feb→Jan, **S1 summer = Feb–Jul, S2 winter = Aug–Jan**, sprints are half-months (1–15 and 16–end of month), quarters are Feb–Apr, May–Jul, Aug–Oct, Nov–Jan.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I changed function — does my old plan follow me?",
      "a": "No. Plans are re-checked against your live membership: rows that no longer match your job are dropped, and the first-sign-in redirect will ask for the plan your NEW role actually files."
     },
     {
      "q": "Why does my team card show a nudge instead of numbers?",
      "a": "The TL hasn't filed this month's plan yet. It's one visit to their profile's My plan card."
     },
     {
      "q": "Why is there no PlanCard on the B2B lane?",
      "a": "The LC's planning sheet doesn't plan B2B/BD opens, so there's nothing honest to draw a bar against."
     },
     {
      "q": "Can conversions on /planning go over 100%?",
      "a": "Yes — applicants can outnumber opens, that's normal. Only the dashboard funnel caps at 100%."
     }
    ]
   }
  ]
 },
 {
  "id": "read-the-dashboard",
  "title": "Read the dashboard",
  "emoji": "📊",
  "category": "leaders",
  "audience": "Everyone with a lane",
  "audienceKeys": [
   "everyone",
   "leaders"
  ],
  "keywords": [
   "dashboard",
   "KPI",
   "lanes",
   "conversion",
   "my numbers",
   "filters",
   "sprint",
   "funnel",
   "B2B lane",
   "OGX dashboard",
   "consideration",
   "TM dashboard",
   "الداشبورد",
   "ارقامي",
   "لوحة"
  ],
  "summary": "What every lane, KPI card, conversion percentage and filter on /dashboard actually means — and why the leaderboards ignore your member filter.",
  "blocks": [
   {
    "t": "p",
    "md": "The [dashboard](/dashboard) shows your whole function's numbers, even if your accounts list only shows your own. Everyone in a module sees their function's aggregates; the lanes you get are the ones you actually work — a Member, Coordinator or Team Leader gets the side(s) their Sub Function names, an LCVP/Director gets both sides of their product, and the LCP/admin plus TM & F&L leadership see every lane."
   },
   {
    "t": "table",
    "headers": [
     "Lane",
     "Who sees it",
     "What it measures"
    ],
    "rows": [
     [
      "All ICX / IGV / All IGT / IGTa / IGTe",
      "That product's raising crew + leaders",
      "The account funnel, opens attributed per product (a B2B deal's IGV opens land in the IGV lane)"
     ],
     [
      "B2B",
      "The B2B crew, IGV/IGT VPs & Directors, LCP/admin",
      "B2B accounts only — B2B raises opens FOR the products, so their leaders follow it"
     ],
     [
      "BD",
      "The BD crew, LCP/admin (its own lane since v32.6)",
      "BD accounts — partnerships measured in money (EGP), not opens"
     ],
     [
      "B2C",
      "The B2C crew + LCP/admin",
      "Deals-centric: no Slots KPI, `Lead → Deal`, boards ranked by Deals, plus the B2C CIC card — B2C never counts in All ICX"
     ],
     [
      "OGT / OGV",
      "The OGX crews + overseers",
      "Sign-ups → Contacted → Interested → Applied → Accepted → Approved ★ — only sign-ups ASSIGNED to someone this peak count (the unassigned pool is a to-do list, not progress); referrals are counted too"
     ],
     [
      "IGV / IGT Consideration",
      "The consideration crews per product",
      "IR calls this month vs last, Booked → happened, partner LCs reached, CVs (IGT), a per-member calls drill and a **Waiting to be reported** KPI"
     ],
     [
      "TM",
      "TM core only (`?fn=TM`)",
      "Attendance rates by kind/function/member, plan-filing compliance, the awaiting-record chase count"
     ]
    ]
   },
   {
    "t": "table",
    "headers": [
     "KPI card",
     "Meaning"
    ],
    "rows": [
     [
      "Market Research",
      "Total accounts in the lane"
     ],
     [
      "Contacted",
      "Accounts with at least one logged contact (not the count of contact attempts)"
     ],
     [
      "Visits",
      "Visits scheduled"
     ],
     [
      "Visits done",
      "Visits reported as completed"
     ],
     [
      "Deals",
      "Count of deals — one account can hold several"
     ],
     [
      "Slots raised",
      "Opens, split per product from each deal"
     ],
     [
      "Lead → Open",
      "% of accounts that raised opens"
     ]
    ]
   },
   {
    "t": "p",
    "md": "Under the KPI row sits the **conversion strip**: MR → Contacted, Contacted → Visits, Visits → Done, and **Visit Done → Deal**. All conversions are capped at 100%, so a weird import can never show you a 340% funnel."
   },
   {
    "t": "callout",
    "md": "**A date range counts each KPI on ITS OWN date.** Pick `This month` and you get: accounts **added** this month, accounts **contacted** this month (the contact's own date — the name can be from any month), visits **booked** this month, visits **held** this month, deals **signed** this month and the opens those deals carried. Before v33.49 the range filtered accounts by the day they were ADDED and then counted everything else off that shortlist, which quietly hid a quarter of the month's calls and visits — every one of them made on an older account. If a number still looks wrong, hover the card: it says which date it is counting.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "Because each card answers its own question, a step can outrun the one above it — a month where the crew called 170 old names and added 96 new ones is a real month, not a broken number. The percentages stay capped at 100%."
   },
   {
    "t": "p",
    "md": "**Getting there:** the sidebar’s **Dashboard** tab, or the **Dashboard** button on [Raising](/accounts) and [Sign-ups](/signups) — the button follows the list you are looking at, so filtering Raising to IGV opens the IGV lane."
   },
   {
    "t": "p",
    "md": "Filters: `This month`, `This sprint` (sprints are half-months — 1–15 and 16 to end of month), a team filter (scoped to teams that actually have rows in this lane), a member filter, and a date range that is clamped to today. The date label follows the lane: **Worked** for accounts (each KPI on its own date), **Signed up** for OGX, **Called** for consideration — and the consideration lane is the one place a future date is allowed, because a call can legitimately be in the future."
   },
   {
    "t": "callout",
    "md": "**`My numbers`** (the chip in the filter bar) flips the KPIs + conversion strip to just your own accounts — your personal MOS tracker. It scopes the KPI totals ONLY: leaderboards, drills and plan progress always show the full picture. VPs, Directors and the LCP don't get the chip — the whole function is already theirs.",
    "tone": "info"
   },
   {
    "t": "p",
    "md": "The consideration lane's trend strip runs from the **peak's first month** to now — it never reaches back into the previous term, so the first month of a peak honestly shows one bar and says there's nothing before it to compare with. Its \"N calls need you\" banner follows the hierarchy: you answer for your own calls, a TL for the team's, a VP/Director/LCP for the floor — a clean slate shows no banner at all."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why don't I see the B2B lane?",
      "a": "It's isolated: the B2B/BD crew, IGV/IGT VPs & Directors and the LCP/admin see it. If B2B isn't in your functions or sub-functions and you're not one of those leaders, it's not yours."
     },
     {
      "q": "I picked a member and the leaderboard didn't change — bug?",
      "a": "By design. The member filter (and `My numbers`) scopes the KPI totals and conversions only; boards and drills always show everyone."
     },
     {
      "q": "Where did the goal bars go?",
      "a": "Goals come from planning now, not from an in-app dialog — the PlanCard and the TL's filed plan ARE the goals. See \"Plans are the goals\"."
     },
     {
      "q": "Why does the dashboard show more accounts than my list?",
      "a": "Your accounts list is scoped to what you own; the dashboard shows the whole function's aggregates so everyone can see where the funnel stands."
     },
     {
      "q": "I logged a contact and the dashboard didn't move — is it broken?",
      "a": "It should move on the next render now. The dashboard reuses its heavy account read for up to half an hour to keep the hosting bill down, but since v33.49 the snapshot re-checks what has changed on every load, and the work numbers (contacts, visits, deals) are read live every time. If a brand-new ACCOUNT is missing, hit Refresh once."
     },
     {
      "q": "Contacted is bigger than Market Research for this month — how?",
      "a": "Because they are two different questions about the same days: MR counts the names ADDED this month, Contacted counts the accounts CALLED this month whatever month they were added. A crew working through an older research list will always show that shape, and it is the honest one."
     }
    ]
   }
  ]
 },
 {
  "id": "members-directory",
  "title": "The members directory (TM)",
  "emoji": "📇",
  "category": "leaders",
  "audience": "TM & the LCP",
  "audienceKeys": [
   "tm",
   "leaders",
   "admin"
  ],
  "keywords": [
   "members directory",
   "TM",
   "MOS",
   "KPIs",
   "member performance",
   "directory",
   "talent management",
   "this sprint",
   "date window",
   "دليل الاعضاء",
   "ارقام الاعضاء"
  ],
  "summary": "The whole LC in one view — every member's info, team, manager and their function's own MOS/KPIs, filterable by role and re-counted for any date window.",
  "blocks": [
   {
    "t": "p",
    "md": "[/members](/members) is the whole-LC directory: every member's info, team, manager, contact shortcuts (email / call / WhatsApp) and their live **MOS/KPIs**. Access is the TM function (in functions or sub-functions) plus the LCP/admin — TM people without raising access still get the shell for /members and the playbook."
   },
   {
    "t": "table",
    "headers": [
     "Member's side",
     "MOS shown"
    ],
    "rows": [
     [
      "ICX raising / B2B",
      "The account funnel with **Opens** starred"
     ],
     [
      "BD",
      "The funnel plus **Money (EGP)** starred"
     ],
     [
      "B2C",
      "The funnel ending in **Deals** starred"
     ],
     [
      "OGX (OGT/OGV)",
      "Sign-ups → Contacted → Interested → Applied → Accepted → **Approved** ★, all live numbers"
     ],
     [
      "Consideration",
      "**Approvals** — their filed plan number until deeper call KPIs land"
     ]
    ]
   },
   {
    "t": "p",
    "md": "A dual-function member shows every side they work. Deal opens are allocation-attributed, so a member who received split opens carries their real share. Columns sort — the MOS column sorts by each member's own starred metric — and the ⚙ table settings let you reorder or hide columns."
   },
   {
    "t": "p",
    "md": "Filters: search, a role filter (including **MMs — TLs & Coordinators**), and a **date window**: `This month` and `This sprint` chips plus a from→to range. Every KPI is re-counted for the window; the default is all-time. The directory honours who's actually reviewed — the LCP, F&L leadership, CXP's people and TM's own MMs are out of the performance rows."
   },
   {
    "t": "callout",
    "md": "For attendance and compliance rather than funnel numbers, TM core has its own dashboard lane: [/dashboard?fn=TM](/dashboard) — attendance rate by kind, function and member, plan-filing compliance and the awaiting-record chase list.",
    "tone": "tip"
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Filter from the columns** (v33.36.2): every column here has its own funnel — Role (with a one-tap *MMs* option), Function, Sub function/side, Team, Manager, MOS, has-or-no email/phone, and has-or-no research/deals. They're multi-select, so \"the TLs and Coordinators of IGV and IGT\" is four taps. Search, the date window and ⚙ Columns stay in the bar above."
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why is a member missing from the directory?",
      "a": "They're either deactivated, or in the excluded review set (LCP, F&L VP/Director, CXP, TM's own MMs). Check /membership for their Active flag."
     },
     {
      "q": "Can regular members open /members?",
      "a": "No — it's TM + LCP/admin. Members see their own people on their profile's card instead."
     },
     {
      "q": "The numbers look small for a strong member — why?",
      "a": "Check the date window chips — you may be looking at this sprint only. The default is all-time."
     }
    ]
   }
  ]
 },
 {
  "id": "calendar-and-invites",
  "title": "Calendar reminders & invites, explained",
  "emoji": "📅",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "calendar",
   "reminder",
   "invite",
   "google calendar",
   "meet link",
   "no reminder",
   "re-login",
   "visit reminder",
   "ir call",
   "التقويم",
   "الاجتماع",
   "لينك ميت"
  ],
  "summary": "Why a calendar reminder did or didn't appear, how Meet links get created without a Google grant, and who gets invited to what.",
  "blocks": [
   {
    "t": "p",
    "md": "Booking a visit puts a real event on a real Google Calendar with **24h + 1h reminders**. Sodio tries three doors in order, so the event lands somewhere no matter how you signed in: **your own Google Calendar** (if you signed in with Google), then the shared **LC Visits calendar** on the IM mailbox, and finally a real **.ics invite by email**."
   },
   {
    "t": "steps",
    "items": [
     "The usual cause is a **dead Google grant** — you signed in with Google long ago and the access expired, or you've only ever used a password. Sodio tells you exactly which case you're in when it happens.",
     "The fix: **sign out, then sign in with Google once**. That refreshes the grant (it also powers your Gmail proposal drafts and the Emails tab).",
     "No AIESEC Google account yet? You're covered by the fallbacks — the event goes on the shared LC calendar or arrives as an email invite you can add with one tap."
    ],
    "title": "\"My reminder wasn't created\" — the fix"
   },
   {
    "t": "callout",
    "md": "**Who gets invited to a visit:** a Member's visit invites their **Team Leader + function VP(s)** as calendar attendees; a TL's or Coordinator's invites the VP(s). Separately, the whole function's raising crew gets a one-time FYI announcement (email + bell) — no calendar event for them. The LCP never gets operational email.",
    "tone": "info"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "My IR call has a Meet link but I never connected Google — how?",
      "a": "When the host has no Google grant, the event (and its Meet room) is created on the **IM mailbox calendar** instead, and both you and the IR are invited by email. Join from the link on the IR calls page or the invite in your inbox."
     },
     {
      "q": "I set a next step with a date — why is there an event at 11:00?",
      "a": "That's by design: a next step with a date but no time gets a follow-up event at **11:00** on your calendar. Give the step a time and the event moves to it. Clear the step (or archive the account) and the event is removed."
     },
     {
      "q": "I moved a visit — do people get spammed again?",
      "a": "No. Re-saving the same slot announces nothing, and a correction within 15 minutes stays quiet (your bell and the Google invite already carry the new time). Only a genuine move later sends a \"🗓️ Visit moved\" notice."
     },
     {
      "q": "Can I see my whole function's visits somewhere?",
      "a": "Yes — [/calendar](/calendar) shows the month for everything you belong to: visits (one color per member), IR calls, touch points and custom items, with filters by kind and scope."
     }
    ]
   }
  ]
 },
 {
  "id": "login-problems",
  "title": "I can't log in",
  "emoji": "🔑",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "login",
   "sign in",
   "password",
   "phone",
   "arabic keyboard",
   "494",
   "cookies",
   "inactive",
   "google",
   "forgot password",
   "مش عارف اسجل دخول",
   "الباسورد",
   "تسجيل الدخول",
   "backup gmail reset",
   "google error",
   "401"
  ],
  "summary": "The quick fixes for every known login problem — wrong-looking phone digits, the phone-in-both-fields rule, the rare cookie error, and the deactivated screen.",
  "blocks": [
   {
    "t": "p",
    "md": "**Most of these stopped being possible in v36.** The sign-in page now asks who you are first and then shows only the door that works for you, so \"I used the wrong one\" is no longer a thing you can do. What is left is below — and whatever the problem, the page itself will now tell you which one it is rather than giving you the same sentence every time."
   },
   {
    "t": "steps",
    "items": [
     "**First time ever?** Sodio will say so and offer you Google — with your @aiesec.net account. That one sign-in also grants the calendar and Gmail access behind your reminders and proposal emails. You pick a password immediately afterwards, and Sodio then signs you out ON PURPOSE so you use it once while it is fresh.",
     "**No AIESEC email yet?** Type your phone number and press Continue — Sodio recognises you and fills the password in for you, because your number IS your password until your address lands. That door closes the moment you set a password of your own.",
     "**Typing on an Arabic keyboard?** That's fine — Sodio translates Arabic digits (٠١٢ and ۰۱۲) to the normal ones automatically. If it still says your number doesn't exist, check for a typo or a missing digit.",
     "**Forgot your password?** Use the forgot-password link — Sodio **emails you a fresh password** right away. Your old one keeps working until you change it, so nobody gets locked out mid-reset."
    ],
    "title": "Try these in order"
   },
   {
    "t": "callout",
    "md": "**Seeing a blank error page or \"Request Header Too Large\" (494)?** Clear this site's cookies once (browser settings → site data for sodio.vercel.app), then sign in again with your phone/email + password. This was a one-time bug with oversized session cookies — clearing them once fixes it for good.",
    "tone": "warn"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "It says my number isn't on the membership — but it is!",
      "a": "Sodio matches your **exact full number** as it appears on the membership sheet. Ask your Team Leader or the EB to check the `CRM — Membership` sheet — a missing digit or an old number there is the usual culprit. The [membership page](/membership) (EB only) can fix it in-app too."
     },
     {
      "q": "I used to sign in with my phone in both fields and now it doesn't work.",
      "a": "That means a password exists for your account — either you set one, or forgot-password emailed you a fresh one. Use your phone + that password. If you can't find it, hit forgot-password again for a new one."
     },
     {
      "q": "I landed on a page saying my account is inactive.",
      "a": "You've been marked inactive on the membership sheet (that's the `/inactive` screen). If that's a mistake, contact your VP or the EB — once the sheet says Active again, you're back in within 30 minutes (or immediately after an in-app edit)."
     },
     {
      "q": "My AIESEC email finally arrived — what changes?",
      "a": "Once the EB adds it to your membership row, sign in **with Google once** (it grants your calendar + Gmail access), and from then on email or phone + password all work. The phone-in-both-fields door closes."
     }
    ]
   },
   {
    "t": "callout",
    "tone": "tip",
    "md": "**Forgot your password and your @aiesec.net hasn't arrived?** Type the **backup Gmail** from your profile instead — the reset now looks in both places (v33.44). And if Google shows an error on the way in, sign out of your other Google accounts (or use a private window): Sodio always asks you to pick an account now, and it must be your AIESEC one."
   }
  ]
 },
 {
  "id": "phones-and-numbers",
  "title": "Phone numbers — why Sodio rewrites what you typed",
  "emoji": "📱",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "phone number",
   "normalize",
   "+20",
   "whatsapp",
   "invalid phone",
   "landline",
   "hotline",
   "pasted number",
   "invisible characters",
   "رقم التليفون",
   "الرقم غلط",
   "واتساب"
  ],
  "summary": "Sodio cleans and normalizes every phone number to one canonical format — here's the format, the paste gotchas it fixes for you, and what counts as valid.",
  "blocks": [
   {
    "t": "p",
    "md": "Every phone field cleans itself **on blur** (when you tap away): pasted junk is stripped, Arabic digits (٠١٢ / ۰۱۲) become normal ones, and the number is rewritten to its canonical form. If it still fails, the error tells you the specific reason — trust it, the field shows exactly what Sodio sees."
   },
   {
    "t": "table",
    "headers": [
     "What you have",
     "What Sodio stores"
    ],
    "rows": [
     [
      "Egyptian mobile (010 / 011 / 012 / 015…)",
      "`+2010XXXXXXXX` — the canonical +20 form"
     ],
     [
      "Alexandria landline (03…)",
      "`+203XXXXXXX`"
     ],
     [
      "Cairo landline (02…)",
      "`+202XXXXXXXX`"
     ],
     [
      "Hotline / short code (16123, 19016…)",
      "Stored as dialled — 5 digits starting with 1"
     ],
     [
      "Anything international",
      "Full `+` form, 7–15 digits (e.g. `+9715XXXXXXXX`)"
     ]
    ]
   },
   {
    "t": "callout",
    "md": "**Pasted a number from WhatsApp and it \"looks perfect\" but keeps failing?** It used to carry invisible characters (bidi marks, zero-width spaces) you couldn't see or delete. Sodio strips all of those now — just tap out of the field and it rewrites itself clean.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Why is there no WhatsApp button on some numbers?",
      "a": "Landlines and hotlines can't receive WhatsApp, so Sodio never offers the WhatsApp tag or button for them. Mobiles get it; tag one number `Whatsapp` and the quick action uses that one."
     },
     {
      "q": "The public booking page shows a weird example number.",
      "a": "It's not weird — it's an example from **your country**, based on the country you picked. All 194 countries have their own tested example, so an IR in France sees a French-shaped number, not an Egyptian one."
     },
     {
      "q": "A sign-up shows no Call/WhatsApp buttons at all.",
      "a": "The tracker row has no real phone (placeholders like \"-\" are treated as missing). Filter with the phone funnel on Quick actions to find rows with or without numbers."
     }
    ]
   }
  ]
 },
 {
  "id": "something-looks-broken",
  "title": "Something looks broken",
  "emoji": "🔧",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "broken",
   "bug",
   "stale data",
   "refresh",
   "loading",
   "walking man",
   "buttons not working",
   "iphone",
   "frozen",
   "report bug",
   "feedback",
   "الموقع باظ",
   "مش شغال",
   "مشكلة"
  ],
  "summary": "What the walking man means, why numbers refresh when you come back to the tab, the iPhone dead-buttons fix, and the two right ways to report a bug.",
  "blocks": [
   {
    "t": "p",
    "md": "Before you panic: the **walking AIESEC human** means a page is loading, not broken — give it a second. And numbers refresh when you **return to the tab** (on focus), not constantly in the background — so if a colleague just recorded a deal, click back into Sodio and it updates."
   },
   {
    "t": "steps",
    "items": [
     "**Stale numbers?** Click away and back into the tab, or reload — data refreshes on focus.",
     "**Every button suddenly dead (usually iPhone)?** This was a stuck dialog lock and it now self-heals automatically. If you're somehow still stuck, one reload fixes it.",
     "**Can't log in at all?** See the [login problems](/help?a=login-problems) article — cookies, phone rules and the 494 error are all covered there.",
     "**Still broken?** Report it — see below. A bug nobody reports is a bug forever."
    ],
    "title": "Quick triage"
   },
   {
    "t": "steps",
    "items": [
     "Open [/feedback](/feedback), pick **Bug**, then the category that fits (\"Doesn't work / button dead\", \"Wrong data / numbers\", \"UI looks broken\", \"Responsiveness / mobile\"…). Say what you did, what you expected, and what happened — screenshots help enormously.",
     "For something about **your own info** (name, team, role): your [profile](/profile) has a **\"Wrong info? WhatsApp the admin to fix it\"** link that opens a chat straight to the IM admin.",
     "Feedback about **people or sessions** goes to [/lc-feedback](/lc-feedback) instead — that's a different inbox with different readers."
    ],
    "title": "How to report it right"
   },
   {
    "t": "callout",
    "md": "Unsure whether it's a bug or just how it works? Ask **The Violet Man** (the floating walking-man button) first — he knows the whole system and answers in Arabic or English.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "Who reads /feedback reports?",
      "a": "The system-feedback inbox is read by the IM team (Ahmed and Omar). Bugs get triaged and usually appear fixed in the next release — the changelog is full of exactly these reports."
     },
     {
      "q": "The page loads but a table is empty — bug?",
      "a": "Usually a filter. Column funnels stay active until you clear them (a filled funnel icon means it's on), and the date range persists in the URL. Clear the filters before reporting."
     },
     {
      "q": "Tooltips don't appear on my phone.",
      "a": "They do now — tap any hinted button once to see its tooltip (it closes on the next tap or after a few seconds). If one is genuinely missing, that's worth a feedback report."
     }
    ]
   }
  ]
 },
 {
  "id": "admin-toolkit",
  "title": "The IM admin's toolkit",
  "emoji": "🛠️",
  "category": "faq",
  "audience": "IM admin",
  "audienceKeys": [
   "admin"
  ],
  "keywords": [
   "admin",
   "health",
   "logs",
   "undo",
   "backup",
   "cron",
   "test session",
   "view as",
   "sandbox",
   "change journal",
   "restore",
   "audit"
  ],
  "summary": "Health checks, the activity console (search, filter and export every action ever taken), LC test sessions, view-as modes and the nightly backups.",
  "blocks": [
   {
    "t": "p",
    "md": "[/admin](/admin) is the cockpit: **Health** (DB, storage buckets, env keys, every cron's last run with freshness colors, today's table counts) and the **activity console** — every action anyone has ever taken in Sodio, searchable properly."
   },
   {
    "t": "callout",
    "tone": "info",
    "md": "**The console searches the WHOLE log, not the last page.** Until v36 it fetched the newest 80 actions and filtered them in your browser — so it could not find anything older than that, and said \"Nothing matches\" when the truth was that it had never looked. Filtering, searching and paging now happen in the database. Narrow by **person**, **action**, **thing**, **kind** (data · sign-in · admin · access · integration · security), **outcome** (went through · refused · failed) and a **date range** — then export what you are looking at as CSV. The filters live in the URL, so a filtered view is a link you can send to someone."
   },
   {
    "t": "p",
    "md": "Two things every row now carries that it did not before. **What changed** — a field edit records `industry: Software → Marketing`, not just the fact that something moved. And **who really did it**: an action taken inside a test view is credited to the member you are impersonating (by design), so the row reads *by Ahmed · acting as Hana* rather than looking like Hana did it herself."
   },
   {
    "t": "steps",
    "items": [
     "**There is no Undo on the log, and there should not be.** It was removed in v34.3 after being measured: it could never reverse anything (0 of 11,130 entries had a replayable journal row), because the audit row and the undo journal minted separate change sets that never joined. A rollback button that half-works corrupts data. The LOG is the record, and it is accurate — the LC test session's rollback is a different mechanism and still works.",
     "**LC test session:** open one session for the whole LC — everyone's writes are journaled, and stopping it rolls them all back or keeps them. **Warning below — read it.**",
     "**View-as (Test view):** pick any member from your profile and the whole app behaves as them. Default is **🧪 Sandbox** — every mutation journaled and rolled back on exit, with emails/notifications/calendar/sheet write-backs suppressed. Flip to **⚡ Real** and actions are genuine and attributed to that member. The audit records view_as start/stop under YOUR name either way, and /admin always reads your real session — a test view can never unmask anonymous feedback."
    ],
    "title": "Undo & testing"
   },
   {
    "t": "callout",
    "md": "**In an LC test session, side effects are NOT suppressed** — emails, bells, calendar events and Sheets write-backs fire for real and cannot be undone. Only the **database** rolls back. Permanent deletes of archived accounts are blocked while a session runs. (Sandbox view-as is the one that suppresses side effects — don't confuse the two.)",
    "tone": "warn"
   },
   {
    "t": "p",
    "md": "**Backups** run nightly at 02:00 UTC: all data tables (~19k rows, gzipped ~1.2 MB) go to the private Supabase `backups` bucket (30-day retention), a copy is emailed to the IM mailbox, and a third lands in the CRM Drive folder. Restore = run the migrations from `supabase/migrations/`, gunzip, insert each table's array. **Storage buckets (contracts, cvs) are NOT backed up** — they're files, not rows. A failed run returns 500 and shows on Health; silence there means success."
   },
   {
    "t": "table",
    "headers": [
     "Cron",
     "Cadence (UTC)"
    ],
    "rows": [
     [
      "visit-followups (+ bounce watcher)",
      "every 15 min"
     ],
     [
      "signups-import",
      "every 15 min"
     ],
     [
      "membership-import",
      "every 30 min"
     ],
     [
      "sheets-export (mirrors)",
      "hourly at :05"
     ],
     [
      "backup",
      "daily 02:00"
     ],
     [
      "podio-updates",
      "daily 05:00"
     ],
     [
      "period-reports",
      "daily 07:00"
     ],
     [
      "streak-nags",
      "daily 16:00"
     ],
     [
      "touch-point-feedback",
      "daily 19:00"
     ],
     [
      "attendance-reminders",
      "daily 20:59"
     ]
    ]
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "A cron shows amber/red on Health — what first?",
      "a": "Check that CRON_SECRET matches everywhere (Vercel env, .env.local, and the pg_cron jobs in supabase/cron.sql) — a mismatch means silent 401s, which has happened before. If the secret rotates, update both env locations, redeploy, and re-run the cron.schedule calls."
     },
     {
      "q": "Can I undo a bulk delete of archived accounts?",
      "a": "No — cascade deletes can't be restored by the journal, which is why bulk delete is refused in sandbox and blocked during an LC test session. Outside those, the nightly backup is your only net."
     },
     {
      "q": "The sheet imports stopped syncing — broken?",
      "a": "Maybe not: imports skip when the sheet's modifiedTime hasn't changed, and pause 01:00–07:00 Cairo. The manual \"Sync now\" buttons force a run — that's the human escape hatch."
     },
     {
      "q": "Who exactly counts as \"admin\" here?",
      "a": "ADMIN_EMAILS (the IM director) gets everything including anonymous-author unmasking. Role/sub-function **Admin** grants the admin tools (Health, logs, journal) without whole-LC visibility — whole-LC access belongs to the IM leadership, LCP and F&L."
     }
    ]
   },
   {
    "t": "p",
    "md": "**The test view is one tap from anywhere (v33.42):** the 👁 button beside 🛠️ Report (top-right on desktop, next to the bell on a phone) opens a searchable picker — pick a person and the whole app becomes theirs. It starts in **sandbox**, so anything you change is rolled back when you exit from the floating banner."
   }
  ]
 },
 {
  "id": "times-and-time-zones",
  "title": "Times & time zones — what clock is that?",
  "emoji": "🕰️",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "time zone",
   "cairo time",
   "vpn",
   "booking page",
   "12 hour",
   "am pm",
   "dst",
   "daylight saving",
   "wrong time",
   "التوقيت",
   "توقيت القاهرة",
   "الساعة"
  ],
  "summary": "Everything inside Sodio runs on Cairo time in 12-hour format; the public booking page follows the visitor's own clock — here's how, and why a VPN changes nothing.",
  "blocks": [
   {
    "t": "p",
    "md": "**Inside Sodio, every time is Cairo time**, shown in 12-hour AM/PM format — dashboards, visits, touch points, the calendar, all of it. The one exception is the public IR **booking page**, which draws itself in the *visitor's* time zone (like Google Calendar does), so an IR in Jakarta picks 6 PM meaning 6 PM at home. Scheduled IR calls inside Sodio show both clocks — Cairo AND the IR's — so nobody books someone into a 3 AM call by accident."
   },
   {
    "t": "callout",
    "md": "**\"I turned on a VPN and the booking page still shows my real city.\"** Actually it's the opposite now: the page trusts your **connection** first (where your traffic comes out), because that's the signal that moves when you do. Your device's own zone is offered as a one-tap fallback — \"your device says Cairo. Use Cairo instead\" — for the corporate-VPN case where the machine was right all along. Your browser's `Intl` clock never changes with a VPN; that's just how browsers work.",
    "tone": "info"
   },
   {
    "t": "steps",
    "items": [
     "On the booking page: check the time-zone picker at the top — you can set any zone manually, and it prefills the country too.",
     "Inside Sodio: remember it's always Cairo. If you're abroad, do the math or check the second line on IR calls (they show the IR's local time).",
     "Stored times are UTC instants under the hood, so nothing ever drifts — only the label changes with the zone."
    ],
    "title": "If a time looks wrong"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "What happens on Egypt's DST switch nights?",
      "a": "Handled. Stored times were always correct (the conversion is DST-aware), and on the spring-forward night — when the clock jumps from 00:00 straight to 01:00 — slots in the hour that doesn't exist are simply never offered."
     },
     {
      "q": "The IR's confirmation email — whose time does it speak?",
      "a": "Theirs, first. Confirmations, reschedules and cancellations lead with the IR's local time and carry Cairo as the second line, so the screen and the email can never disagree."
     },
     {
      "q": "Why do time inputs still look 24-hour sometimes?",
      "a": "Native time input fields keep the 24-hour format your device uses — that's the browser, not Sodio. Everything Sodio *displays* is 12-hour AM/PM."
     }
    ]
   }
  ]
 },
 {
  "id": "cant-see-account",
  "title": "Why can't I see an account or sign-up?",
  "emoji": "🕵️",
  "category": "faq",
  "audience": "Everyone",
  "audienceKeys": [
   "everyone"
  ],
  "keywords": [
   "can't see account",
   "missing account",
   "access",
   "scope",
   "permissions",
   "unassigned",
   "archived",
   "404",
   "sign-up missing",
   "visibility",
   "مش شايف الاكونت",
   "الصلاحيات"
  ],
  "summary": "Who sees what in Sodio, in plain words — and the four most common reasons an account or sign-up seems to have vanished.",
  "blocks": [
   {
    "t": "p",
    "md": "Sodio shows you exactly what your role covers — nothing is ever \"lost\", it's just outside your scope or moved. Here's the map."
   },
   {
    "t": "diagram",
    "diagramId": "roles",
    "caption": "Who sees which accounts — the scope pyramid."
   },
   {
    "t": "table",
    "headers": [
     "Your role",
     "Accounts you see"
    ],
    "rows": [
     [
      "Member / Coordinator",
      "Your own accounts (plus the unowned market-research pool, for Coordinators and above)"
     ],
     [
      "Team Leader",
      "Your own + your team members' accounts"
     ],
     [
      "VP (LCVP)",
      "Every account in your function(s) + B2B (they raise for you)"
     ],
     [
      "Director",
      "Same as a VP for their function(s) + B2B — but no membership editing"
     ],
     [
      "LCP / admin",
      "Everything"
     ]
    ]
   },
   {
    "t": "steps",
    "items": [
     "**It was archived.** The Archived tab on [Raising](/accounts) is LC-wide — every member can browse ALL archived names and open any archived account **read-only**. Check there first.",
     "**It's in the unassigned pool.** Imported market research lands with no responsible. Members can't see unowned rows — Coordinators and above can (look for the **— Unassigned** option in the Responsible filter).",
     "**It moved function.** An account always follows its owner — if it was handed to someone in another function, it now lives (and counts) there. Ask the leader who reassigned it.",
     "**It was reassigned.** If an account left your list, someone with the authority moved it. Your VP or TL can tell you where it went — the account's History says who and when."
    ],
    "title": "The usual suspects"
   },
   {
    "t": "callout",
    "md": "**Want to see your whole function?** Since v33.32, your VP or Director can open whole-function **viewing** for Members, Coordinators or Team Leaders from their profile's Function defaults card — you'd be able to OPEN every account in your function (still editing only your own). Ask them to flip the switch.",
    "tone": "tip"
   },
   {
    "t": "faq",
    "faqItems": [
     {
      "q": "I guessed an account's URL and got a 404 — is it deleted?",
      "a": "Not necessarily. A URL outside your scope returns a 404 on purpose — Sodio never confirms an account exists to someone who can't see it. If you think you should see it, ask your VP."
     },
     {
      "q": "Why does an IGT VP see B2B accounts?",
      "a": "B2B/BD raises opens for the whole ICX — their deals feed the IGV/IGTa/IGTe lanes. So IGV and IGT VPs and Directors always see B2B accounts alongside their own function's."
     },
     {
      "q": "A sign-up disappeared from my list on /signups.",
      "a": "Same logic: sign-ups are scoped to you, your team (TL), or your function (VP+). If it left your **My sign-ups**, it was reassigned or released to the Unassigned pool — the sign-up's History log in the detail dialog says exactly what happened."
     },
     {
      "q": "Can I re-add a name that's in the archive?",
      "a": "No — the archive IS the blacklist for its world. An archived name blocks re-adding until a TL or above revives it from the Archived tab. Note each world (ICX raising · BD · B2C) keeps its own archive, so a B2C archive never blocks an IGV account."
     }
    ]
   }
  ]
 }
];
