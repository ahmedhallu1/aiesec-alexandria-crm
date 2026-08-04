/**
 * LB LAUNCH DRAFTS (v33) — one Gmail DRAFT per Leadership Body member.
 *
 * These people already know what Sodio is. They sat through the session. So
 * this is NOT a tutorial: it's the "it's live, it's yours, here's your lever"
 * email — short, specific to the person, and a bit funny. The EB gets a
 * EVERY ROLE gets its own letter — the LCP does not read a VP's email, a
 * Coordinator does not read a Team Leader's. Re-running REPLACES the previous
 * drafts to the same people rather than piling up duplicates.
 *
 * NOTHING IS SENT. Every message lands in the sender's Drafts folder to be
 * read and sent by hand.
 *
 *   node scripts/draft-lb-announcements.mjs --dry      # plan only
 *   node scripts/draft-lb-announcements.mjs --emit=/tmp/lb   # + HTML previews
 *   node scripts/draft-lb-announcements.mjs            # create the drafts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const DRY = process.argv.includes("--dry");
const EMIT = (process.argv.find((a) => a.startsWith("--emit=")) || "").replace("--emit=", "");

function findEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".env.local");
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const envPath = findEnv();
const ENV = {};
if (envPath) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2].replace(/^"|"$/g, "").trim();
  }
}
const get = (k) => process.env[k] || ENV[k] || "";

const CLIENT_ID = get("AUTH_GOOGLE_ID");
const CLIENT_SECRET = get("AUTH_GOOGLE_SECRET");
const REFRESH = get("GMAIL_REFRESH_TOKEN");
const SENDER = get("GMAIL_SENDER");
const SENDER_NAME = get("GMAIL_SENDER_NAME") || "Sodio · AIESEC in Alexandria";
const SUPA_URL = get("SUPABASE_URL");
const SUPA_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
// The LIVE url, always. .env.local carries localhost for dev, and a launch
// email pointing at localhost:3000 is worse than useless — every link in it
// would be dead for all 28 recipients.
const RAW_URL = get("NEXT_PUBLIC_APP_URL") || "";
const APP_URL = (/localhost|127\.0\.0\.1/.test(RAW_URL) || !RAW_URL
  ? "https://sodio.vercel.app"
  : RAW_URL
).replace(/\/$/, "");

// ── the LB, per the system's own rule ───────────────────────────────────────
const LB_ROLES = ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"];
const isEb = (m) => m.role === "LCP" || m.role === "LCVP";

// ── look ────────────────────────────────────────────────────────────────────
const layout = (pre, body) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef3fa;font-family:'Segoe UI',Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${pre}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa;padding:26px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px -12px rgba(3,126,243,.35);">
<tr><td style="background:linear-gradient(135deg,#037EF3,#0a5fd0 55%,#0A2540);padding:26px 30px;">
  <p style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.3px;">Sodio</p>
  <p style="margin:4px 0 0;color:rgba(255,255,255,.82);font-size:13px;">AIESEC in Alexandria</p>
</td></tr>
<tr><td style="padding:28px 30px 8px;color:#0f172a;font-size:15px;line-height:1.65;">${body}</td></tr>
<tr><td style="padding:18px 30px 26px;">
  <p style="margin:0;color:#8595a8;font-size:12px;">Sent by Sodio · <a href="${APP_URL}" style="color:#037EF3;">${APP_URL.replace(/^https?:\/\//, "")}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;

const btn = (label, url) =>
  `<p style="margin:22px 0 6px;"><a href="${url}" style="display:inline-block;background:#037EF3;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:10px;">${label}</a></p>`;
const h = (t) =>
  `<p style="margin:24px 0 6px;font-size:12px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#037EF3;">${t}</p>`;
const ul = (items) =>
  `<ul style="margin:6px 0 4px;padding-left:20px;">${items.map((i) => `<li style="margin:7px 0;">${i}</li>`).join("")}</ul>`;
const note = (html) =>
  `<div style="margin:18px 0;padding:13px 16px;background:#f0f7ff;border-left:4px solid #037EF3;border-radius:8px;font-size:14px;">${html}</div>`;

// ── what each PERSON actually got, not what their band got ─────────────────
//
// The first cut wrote one EB letter and one MM letter. That is how the LCP
// ended up reading a letter about "your function" — she doesn't have one, she
// has all of them. Every letter below is keyed on the person's actual job.

const blueMan = `<b>The Blue Man</b> 🚶 got sharper: he answers in <i>your</i> question's language (he used to reply in Arabic to English questions — sorry about that), he stopped refusing things he demonstrably has the data for, and he gives the whole answer instead of one line.`;

const sign = `<p style="margin:14px 0 0;color:#5c6b80;font-size:13px;">— Ahmed, IM</p>`;

/** THE LCP — the only person whose scope is the whole LC. */
function lcpLetter(c) {
  return {
    subject: `${c.nick}, the whole LC is in Sodio now — every function, one screen`,
    pre: "Every function's funnel, plan and people — without asking anyone.",
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>You're the only person in the LC whose job needs <b>all of it at once</b>, so
that's what you've got: every function's dashboard, every lane, every team —
IGV and IGT (raising and consideration, split properly now), B2B, BD, B2C, OGT
and OGV. No screenshots, no "can you send me the numbers", no waiting for a VP
to be free.</p>
${note(`The honest version: <b>you can now see which functions are actually
logging their work and which ones are telling you a story.</b> The dashboard
only knows what people put in it, so an empty lane means one of two things and
both are worth a conversation.`)}
${h("What only you have")}
${ul([
  "<b>Every lane, live</b> — MR → Contacted → Visits → Done → Deals → Opens per function, with the conversion between every step, and the same numbers your VPs see.",
  "<b>Plan vs actual across the LC.</b> Targets come from the planning sheet, not from anyone typing a nice number into Sodio — so the comparison is honest by construction.",
  "<b>The concerns inbox.</b> A 😟 about any member reaches you and TM privately, anonymously if they choose. Nobody else can open it.",
  "<b>Membership.</b> The sheet is still the source of truth, but you can edit people in-app and it writes back.",
])}
${h("Two levers worth using this week")}
${ul([
  "<b>Ask instead of digging.</b> The Blue Man reads your whole scope — try <i>\"which function has the worst visit-to-deal conversion this month?\"</i>",
  "<b>The LC calendar.</b> Every function's meetings, visits and IR calls in one month. If a week looks empty, it was empty.",
])}
<p style="margin-top:18px;">${blueMan}</p>
${btn("Open the LC dashboard", `${APP_URL}/dashboard`)}
<p style="margin:16px 0 0;">If a number looks wrong, tell me — a wrong number is
worse than no number, and I'd rather hear it from you first. 💙</p>
${sign}`,
  };
}

/** What changed for each function this release — used by VP/Director letters. */
const VP_SPECIFIC = {
  IGV: {
    lead: "IGV is two jobs and Sodio finally treats it that way: <b>IGV Raising</b> and <b>IGV Consideration</b> are separate dashboards, and your people only get the side their Sub Function actually names.",
    bullets: [
      "Your raisers see raising numbers. Your consideration people see IR calls and partner LCs. Nobody wades through the other half any more.",
      "Every IGV account carries its project, and the accounts list can be filtered by it from the column header.",
      "The archive is shared LC-wide — a name your team burned is visible to everyone before they waste a call on it.",
    ],
  },
  IGT: {
    lead: "IGT stopped being one blurred number: <b>IGT Raising, IGTa, IGTe</b> and <b>IGT Consideration</b> are four lanes now, each with its own funnel.",
    bullets: [
      "IGTa and IGTe split out, so a strong teaching month can't hide a weak talent one.",
      "<b>The CV pool is yours alone.</b> Companies want talent, not volunteers — IGV consideration no longer sees applicants' CVs at all.",
      "B2B's opens still feed your lanes, so a bulk B2B deal shows up where it belongs.",
    ],
  },
  OGT: {
    lead: "OGT's sign-ups, funnel and streaks are all live — and the streak board now covers <b>all of OGX</b>, not just OGV.",
    bullets: [
      "The full ladder — Sign-ups → Contacted → Interested → Applied → Accepted → <b>Approved</b> — with conversions, on your own dashboard.",
      "The streak can't be gamed any more: it reads live contacts, so undoing one removes the day. Your MMs will notice.",
      "The Expectation-Setting mail composer drafts into <i>your</i> Gmail with your signature — you review and send.",
    ],
  },
  OGV: {
    lead: "OGV's 🔥 streak board grew up — and the important part: <b>you can see it now.</b> It used to be MMs-only, which made it impossible for you to push.",
    bullets: [
      "One board for all of OGX, filterable to OGV, with <b>today's contact count</b> next to every name.",
      "It reads live contacts, so it can't be gamed — contact and undo and the day disappears.",
      "The full sign-up funnel to Approved is on your dashboard, with the team and member filters.",
    ],
  },
  TM: {
    lead: "TM got the biggest structural change: <b>you now read every function's dashboard</b>, because you review every function's people and couldn't do that from the outside.",
    bullets: [
      "Every lane — ICX, B2B, BD, B2C, OGT, OGV — read-only where it isn't yours to work.",
      "<b>Touch points, attendance and appeals</b> are yours end to end, including LC-wide sessions.",
      "<b>Virtual touch points</b>: the invite collects everyone's Yes/No and pre-fills attendance — you still confirm at the end of the day.",
      "A 😟 concern about any member now reaches <b>you</b> as well as the LCP. That was a gap.",
    ],
  },
  "F&L": {
    lead: "F&L reads <b>every</b> lane now — every function's funnel and money without asking anyone for a screenshot.",
    bullets: [
      "Every dashboard, read-only where it isn't yours to work.",
      "<b>BD's money is its own lane</b> now, separate from B2B's opens — EGP per deal, per account, and on the mirror sheet.",
      "Deal contracts are uploaded and stored against the deal, so the paperwork sits with the number.",
    ],
  },
  B2C: {
    lead: "B2C is a proper island now: your own lane, your own archive, your own rules.",
    bullets: [
      "<b>A name IGV burned no longer blocks you.</b> BD and B2C share one archive world; raising has its own — different service, different history.",
      "Deals are deals — no opens, no splits — behind the contract form, exactly how you sell.",
      "The Podio continuous-update countdown per account, with the reminder going to the owner and to you.",
    ],
  },
  BD: {
    lead: "<b>BD has its own dashboard.</b> Your numbers used to be folded into B2B's, which made both meaningless — you sell partnerships, they raise opens.",
    bullets: [
      "Your lane, your funnel, your money — <b>EGP per deal</b> as the MOS, not opens.",
      "It's yours and the LCP's only. The ICX VPs see B2B (which raises for them); they don't see BD.",
      "A name burned by raising doesn't block a BD partnership any more — different service, different archive.",
    ],
  },
};

function vpLetter(c) {
  const spec = VP_SPECIFIC[c.fn] || { lead: "", bullets: [] };
  return {
    subject: `${c.nick}, ${c.fn} is live in Sodio — and it's built the way you run it`,
    pre: `Your ${c.fn} function, end to end.`,
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>No tour — you sat through the session. Just the part that's <b>yours</b>:
${c.fn} is live with real data, and this release changed your function
specifically.</p>
${spec.lead ? note(spec.lead) : ""}
${h(`What's new for ${c.fn}`)}
${ul(spec.bullets)}
${h("Your levers")}
${ul([
  "<b>The plan is the goal.</b> Nobody types targets into Sodio — your planning sheet is the target and the dashboard tracks against it automatically.",
  "<b>Your MMs' filed plans</b> are visible, so a team without one is obvious instead of invisible.",
  `<b>The Timeline button</b> on the calendar books your whole routine for the peak in one click — and a <b>virtual</b> touch point takes attendance from everyone's Yes/No on the invite.`,
])}
<p style="margin-top:18px;">${blueMan} Try <i>"how is ${c.fn} doing this month?"</i>.</p>
${btn(`Open the ${c.fn} dashboard`, `${APP_URL}/dashboard`)}
<p style="margin:16px 0 0;">Your people copy what you do with this. If they never
see you in it, no feature saves it. Break it and tell me what broke. 💙</p>
${sign}`,
  };
}

function directorLetter(c) {
  const spec = VP_SPECIFIC[c.fn] || { lead: "", bullets: [] };
  return {
    subject: `${c.nick}, ${c.fn} is live — the whole function, in your hands`,
    pre: `${c.fn}, end to end.`,
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>You run ${c.fn}, so this is the letter about ${c.fn} — nothing else.</p>
${spec.lead ? note(spec.lead) : ""}
${h("What changed for you")}
${ul(spec.bullets)}
${h("What you can do that your team can't")}
${ul([
  `Every ${c.fn} account, whoever owns it — plus reassignment across the function and the archive.`,
  "Bring an archived account back, in bulk if you need to.",
  "The whole function's funnel and leaderboard, with team and member filters.",
])}
<p style="margin-top:18px;">${blueMan}</p>
${btn(`Open ${c.fn}`, `${APP_URL}/dashboard`)}
<p style="margin:16px 0 0;">Tell me what's wrong with it — bluntly, the feedback
tab has a 🎭 anonymous option if that helps. 💙</p>
${sign}`,
  };
}

/** Team Leaders — the team is the unit. */
function tlLetter(c) {
  const raising = ["IGV", "IGT", "B2B", "BD", "B2C"].includes(c.fn);
  return {
    subject: `${c.nick}, your team is already in Sodio — go look`,
    pre: "Your team's numbers, your plan, your people.",
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>Short one. <b>Sodio is live, your team's real work is in it, and your
dashboard shows your team — not the whole function.</b></p>
${note(`<b>Your filed plan is the target</b> and your team's actual numbers sit
next to it. If you haven't filed one, your profile asks for it — that number IS
your team goal, so it's worth five honest minutes.`)}
${h("The three that save you the most time")}
${ul(
  raising
    ? [
        "<b>Adding an account checks itself</b> — already in the CRM? in the archive? <b>already on Podio?</b> All answered while you type. No second tab.",
        "<b>Quick actions log themselves.</b> Tap WhatsApp / call / email on any row and the contact form opens with the channel picked, every result available — <i>Not interested</i> archives it, <i>Visit scheduled</i> books the visit.",
        "<b>Reporting a visit asks what came out of it</b> — interested, not interested, sending the proposal, not ready yet — and does the right next thing instead of leaving you a blank box.",
      ]
    : [
        "<b>Unassigned is the pool</b> — contact a sign-up, claim it, and it's yours. Your team view shows what your people are holding.",
        "<b>The 🔥 streak</b> reads live contacts, so it can't be gamed — and it shows today's count next to every name on the board.",
        "<b>Everything writes back to the tracker sheet</b>, stamped with your name — you never touch the sheet again.",
      ]
)}
${h("And the thing that ends the attendance argument")}
<p>Your <b>Timeline</b> books your team's whole routine for the peak in one
click. Make a meeting <b>virtual</b> and the invite collects everyone's Yes/No —
attendance fills itself in and you just confirm.</p>
<p style="margin-top:18px;">${blueMan} Ask <i>"which of my team's accounts has no next step?"</i>.</p>
${btn("Open Sodio", APP_URL)}
<p style="margin:16px 0 0;">Anything wrong, slow or ugly — feedback tab, or just
reply. 🎭 anonymous is there if you'd rather be blunt. 💙</p>
${sign}`,
  };
}

/** Coordinators — no team under them; their own work is the unit. */
function coordLetter(c) {
  return {
    subject: `${c.nick}, Sodio is live — your work, your numbers`,
    pre: "Everything you log rolls up automatically.",
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>You know the pitch, so: <b>it's live, your real work is in it, and your own
numbers are on your dashboard.</b> Nothing to set up.</p>
${note(`<b>Your filed plan is your target</b> — it sits right next to what you've
actually done. If you haven't filed one yet, your profile asks.`)}
${h("What saves you time immediately")}
${ul([
  "<b>Everything checks itself</b> while you type — duplicates, the archive, and whether the company is already on Podio.",
  "<b>Tap to contact, and it logs itself</b> — the form opens with the channel already picked and every result available.",
  "<b>You'll be chased, gently.</b> Visits get a follow-up prompt, accounts without a next step get flagged, and attendance nags until it's recorded. That's the system doing the remembering, not you.",
])}
<p style="margin-top:18px;">${blueMan}</p>
${btn("Open Sodio", APP_URL)}
<p style="margin:16px 0 0;">Found a bug or have an idea? Feedback tab — 🎭
anonymous if you prefer. 💙</p>
${sign}`,
  };
}

function letterFor(m, c) {
  if (m.role === "LCP") return lcpLetter(c);
  if (m.role === "LCVP") return vpLetter(c);
  if (m.role === "Director") return directorLetter(c);
  if (m.role === "Team Leader") return tlLetter(c);
  return coordLetter(c);
}

function encodeHeader(v) {
  return /^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
async function createDraft(gmail, to, subject, html) {
  const raw = Buffer.from(
    [
      `From: ${encodeHeader(SENDER_NAME)} <${SENDER}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      html,
    ].join("\r\n"),
    "utf8"
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  return res.data.id;
}

async function main() {
  const url = `${SUPA_URL}/rest/v1/members?is_active=eq.true&select=name,nickname,email,role,functions,sub_functions,team_name`;
  const res = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) { console.error(`✖ Supabase fetch failed: ${res.status}`); process.exit(1); }
  const members = await res.json();

  const plan = [];
  for (const m of members) {
    if (!LB_ROLES.includes(m.role)) continue;
    if (!m.email) { console.warn(`  ! ${m.name} has no email — skipped`); continue; }
    const fns = [...(m.functions || []), ...(m.sub_functions || [])];
    const fn = ["IGV", "IGT", "OGT", "OGV", "B2C", "BD", "B2B", "TM", "F&L", "CXP"].find((f) => fns.includes(f)) || "";
    const ctx = { nick: m.nickname || m.name.split(" ")[0], name: m.name, role: m.role, fn };
    const letter = letterFor(m, ctx);
    plan.push({
      email: m.email, name: m.name, role: m.role, fn,
      band: isEb(m) ? "EB" : "MM",
      subject: letter.subject, html: layout(letter.pre, letter.body),
    });
  }

  plan.sort((a, b) => (a.band === b.band ? a.name.localeCompare(b.name) : a.band === "EB" ? -1 : 1));
  const eb = plan.filter((p) => p.band === "EB").length;
  console.log(`\n📬 ${plan.length} LB draft(s) — ${eb} EB, ${plan.length - eb} MM${DRY ? "   (DRY RUN)" : ""}\n`);
  for (const p of plan) {
    console.log(`  ${p.band === "EB" ? "👑" : "⚡"} ${p.role.padEnd(12)} ${p.name.padEnd(24)} ${(p.fn || "—").padEnd(5)} <${p.email}>`);
  }

  if (EMIT) {
    mkdirSync(EMIT, { recursive: true });
    for (const p of plan) writeFileSync(join(EMIT, `${p.band}__${p.name.replace(/[^\w]+/g, "_")}.html`), p.html);
    console.log(`\n💾 ${plan.length} HTML previews → ${EMIT}\n`);
  }
  if (DRY) { console.log("\n(Preview only. Re-run without --dry to create the drafts.)\n"); return; }

  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: REFRESH });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  // Remove any earlier draft to the same person first — re-running this after
  // a wording fix should REPLACE, not leave two versions in the folder.
  const wanted = new Set(plan.map((p) => p.email.toLowerCase()));
  let removed = 0;
  try {
    let pageToken;
    do {
      const list = await gmail.users.drafts.list({ userId: "me", maxResults: 100, pageToken });
      for (const d of list.data.drafts || []) {
        const full = await gmail.users.drafts.get({ userId: "me", id: d.id, format: "metadata" });
        const headers = full.data.message?.payload?.headers || [];
        const to = (headers.find((x) => x.name?.toLowerCase() === "to")?.value || "").toLowerCase();
        const subj = headers.find((x) => x.name?.toLowerCase() === "subject")?.value || "";
        const mine = /Sodio is live|in Sodio now|is live in Sodio|already in Sodio|the whole function/i.test(subj);
        if (mine && [...wanted].some((e) => to.includes(e))) {
          await gmail.users.drafts.delete({ userId: "me", id: d.id });
          removed++;
        }
      }
      pageToken = list.data.nextPageToken;
    } while (pageToken);
  } catch (e) {
    console.warn(`  ! could not clean old drafts: ${e?.message || e}`);
  }
  if (removed) console.log(`🧹 Replaced ${removed} earlier draft(s)\n`);

  console.log(`Creating drafts in ${SENDER} …\n`);
  let ok = 0;
  for (const p of plan) {
    try {
      const id = await createDraft(gmail, p.email, p.subject, p.html);
      ok++;
      console.log(`  ✅ ${p.name.padEnd(24)} ${id}`);
    } catch (e) {
      console.error(`  ✖ ${p.name.padEnd(24)} ${e?.message || e}`);
    }
  }
  console.log(`\n✅ ${ok}/${plan.length} drafts in ${SENDER}'s Drafts. Nothing was sent — review and send by hand.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
