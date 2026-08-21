/** Render a representative set of Sodio emails to HTML, so the branding can be
 *  reviewed without sending anything to a real person.
 *
 *    NEXT_PUBLIC_APP_URL=http://localhost:3100 \
 *      npx tsx --tsconfig tsconfig.scripts.json scripts/preview-emails.ts /tmp/sodio-emails
 *
 *  Point APP_URL at a running dev server so the header lockup actually loads. */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  accountsAssignedEmail,
  irBookingConfirmEmail,
  newPasswordEmail,
  streakNagEmail,
  visitAnnouncementEmail,
  welcomeEmail,
} from "@/lib/email/templates";

const out = process.argv[2] ?? "/tmp/sodio-emails";
mkdirSync(out, { recursive: true });

const samples: [string, { subject: string; html: string }][] = [
  ["01-welcome", welcomeEmail({
    name: "Mariam Hassan", role: "Team Leader",
    functions: ["IGV"], sub_functions: ["Raising"],
  })],
  ["02-accounts-assigned", accountsAssignedEmail({
    memberName: "Mariam", managerName: "Yara Nabil",
    accountNames: ["Hadana Moves", "Elite Hospital", "Softa Solutions", "Mamma Mia"],
    accountsUrl: "https://sodio.vercel.app/accounts",
  })],
  ["03-visit-announcement", visitAnnouncementEmail({
    responsibleName: "Youssef Atya", accountName: "Elite Hospital", product: "IGV",
    visitDate: "Tue, 26 Aug 2026", visitTime: "2:30 PM",
    notes: "Reception said to ask for Dr. Salma — bring two printed proposals.",
    accountUrl: "https://sodio.vercel.app/accounts/elite-hospital",
  })],
  ["04-new-password", newPasswordEmail({ memberFirstName: "Mariam", password: "sodio-4821-fox" })],
  ["05-streak-nag", streakNagEmail({ firstName: "Nada", streak: 9 })],
  ["06-ir-booking-external", irBookingConfirmEmail({
    bookerName: "Ensar Yilmaz", memberName: "Dai Mohamed", partnerLc: "AIESEC in İstanbul Asia",
    whenLabel: "Thu, 28 Aug 2026 · 4:00 PM (Istanbul)",
    cairoLabel: "3:00 PM Cairo", slotMinutes: 30,
    meetLink: "https://meet.google.com/abc-defg-hij",
    manageUrl: "https://sodio.vercel.app/book/manage/demo-token",
  })],
];

const index: string[] = [];
for (const [name, mail] of samples) {
  writeFileSync(join(out, `${name}.html`), mail.html);
  index.push(`<li><a href="./${name}.html">${name}</a> — <b>${mail.subject}</b></li>`);
  console.log(`${name.padEnd(26)} ${mail.subject}`);
}
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><meta charset=utf-8><title>Sodio email previews</title>
   <body style="font-family:system-ui;padding:32px;max-width:760px;margin:auto">
   <h1>Sodio email previews</h1><ul style="line-height:2">${index.join("")}</ul></body>`
);
console.log(`\n${samples.length} rendered into ${out}`);
