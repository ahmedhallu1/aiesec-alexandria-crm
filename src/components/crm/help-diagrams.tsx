"use client";

/** THE HELP CENTER'S ILLUSTRATIONS (v33.36).
 *
 *  Hand-drawn inline SVG — no images to load, no external hosts, and every
 *  colour comes from the theme (CSS variables + the official product colours),
 *  so they read correctly in light and dark mode alike.
 *
 *  Each diagram answers ONE question a paragraph answers badly: what order
 *  things happen in, or who sits above whom. Articles reference them by id
 *  through the `diagram` block; an unknown id renders nothing rather than a
 *  broken page.
 */

const BLUE = "var(--chart-1)";
const GV = "#F85A40";
const GT = "#0CB9C1";
const AMBER = "#F48924";
const OK = "#10b981";
const MUTED = "var(--muted-foreground)";

/** One pill-shaped step. Text is centred; width fits ~12 chars. */
function Pill({
  x, y, w = 108, label, color = BLUE, sub,
}: {
  x: number; y: number; w?: number; label: string; color?: string; sub?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} rx={15} ry={15} width={w} height={30} fill={color} opacity={0.14} />
      <rect x={x} y={y} rx={15} ry={15} width={w} height={30} fill="none" stroke={color} strokeWidth={1.4} />
      <text x={x + w / 2} y={y + 19} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={color}>
        {label}
      </text>
      {sub ? (
        <text x={x + w / 2} y={y + 44} textAnchor="middle" fontSize={9.5} fill={MUTED}>
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, color = MUTED }: { x1: number; y1: number; x2: number; y2: number; color?: string }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 5;
  return (
    <g stroke={color} fill={color} opacity={0.75}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.4} />
      <polygon
        points={`${x2},${y2} ${x2 - ah * Math.cos(angle - 0.45)},${y2 - ah * Math.sin(angle - 0.45)} ${x2 - ah * Math.cos(angle + 0.45)},${y2 - ah * Math.sin(angle + 0.45)}`}
        stroke="none"
      />
    </g>
  );
}

/** The account funnel: Lead → Contacted → Visit Scheduled → Visit Done → Deal,
 *  with Out of Process as the exit lane underneath. */
function PipelineDiagram() {
  const steps = ["Lead", "Contacted", "Visit booked", "Visit done", "Deal 🎉"];
  const w = 96, gap = 26, y = 12;
  return (
    <svg viewBox={`0 0 ${steps.length * (w + gap) - gap} 118`} role="img" aria-label="The raising pipeline" className="w-full max-w-xl">
      {steps.map((s, i) => (
        <Pill key={s} x={i * (w + gap)} y={y} w={w} label={s} color={i === steps.length - 1 ? OK : BLUE} />
      ))}
      {steps.slice(0, -1).map((_, i) => (
        <Arrow key={i} x1={(i + 1) * (w + gap) - gap + 2} y1={y + 15} x2={(i + 1) * (w + gap) - 4} y2={y + 15} />
      ))}
      {/* the exit lane */}
      <Arrow x1={w / 2} y1={y + 32} x2={w / 2} y2={72} color={GV} />
      <Pill x={8} y={74} w={150} label="Out of Process 🗄️" color={GV} />
      <text x={170} y={93} fontSize={10} fill={MUTED}>
        any stage can exit — archived, name stays blocked, revivable by a TL+
      </text>
      <text x={0} y={114} fontSize={10} fill={MUTED}>
        The stage is derived from what you log — nobody sets it by hand. Deals don&apos;t end the account: keep working it.
      </text>
    </svg>
  );
}

/** OGX: Sign-up → Contacted → Interested → Applied → Accepted → Approved ★ */
function SignupFunnelDiagram() {
  const steps = [
    { label: "Sign-up", color: BLUE },
    { label: "Contacted", color: BLUE },
    { label: "Interested", color: BLUE },
    { label: "Applied", color: GT },
    { label: "Accepted", color: GT },
    { label: "Approved ★", color: OK },
  ];
  const w = 88, gap = 18, y = 16;
  return (
    <svg viewBox={`0 0 ${steps.length * (w + gap) - gap} 92`} role="img" aria-label="The OGX sign-up funnel" className="w-full max-w-xl">
      {steps.map((s, i) => (
        <Pill key={s.label} x={i * (w + gap)} y={y} w={w} label={s.label} color={s.color} />
      ))}
      {steps.slice(0, -1).map((_, i) => (
        <Arrow key={i} x1={(i + 1) * (w + gap) - gap + 2} y1={y + 15} x2={(i + 1) * (w + gap) - 4} y2={y + 15} />
      ))}
      <text x={0} y={72} fontSize={10} fill={MUTED}>
        You mark Contacted &amp; Interested · the sign-up&apos;s OWNER moves it Applied → Accepted → Approved (the MOS).
      </text>
      <text x={0} y={86} fontSize={10} fill={MUTED}>
        Approved = accepted by the host, paid, signed — ready to travel. Parents Approval stays a VP call.
      </text>
    </svg>
  );
}

/** IR booking: share link → IR picks slot → Meet invite → the call → notes. */
function IrBookingDiagram() {
  const steps = [
    { label: "Share your link", sub: "sodio.vercel.app/book/you" },
    { label: "IR picks a slot", sub: "their own time zone" },
    { label: "Meet invite ✉️", sub: "auto, both of you" },
    { label: "The call 🌍", sub: "Meet link on the row" },
    { label: "In-call notes", sub: "saving completes it" },
  ];
  const w = 108, gap = 22, y = 12;
  return (
    <svg viewBox={`0 0 ${steps.length * (w + gap) - gap} 78`} role="img" aria-label="How IR booking works" className="w-full max-w-xl">
      {steps.map((s, i) => (
        <Pill key={s.label} x={i * (w + gap)} y={y} w={w} label={s.label} color={i === 4 ? OK : GT} sub={s.sub} />
      ))}
      {steps.slice(0, -1).map((_, i) => (
        <Arrow key={i} x1={(i + 1) * (w + gap) - gap + 2} y1={y + 15} x2={(i + 1) * (w + gap) - 4} y2={y + 15} />
      ))}
    </svg>
  );
}

/** Visits: contact log → Visit Scheduled → invite + reminders → report it. */
function VisitFlowDiagram() {
  const steps = [
    { label: "Log a contact", sub: "result: Visit Scheduled" },
    { label: "Calendar invite", sub: "24h + 1h reminders" },
    { label: "The visit 🏢", sub: "TL & VP invited too" },
    { label: "Report it", sub: "+2h email asks; the banner waits" },
  ];
  const w = 118, gap = 26, y = 12;
  return (
    <svg viewBox={`0 0 ${steps.length * (w + gap) - gap} 96`} role="img" aria-label="A visit's life" className="w-full max-w-xl">
      {steps.map((s, i) => (
        <Pill key={s.label} x={i * (w + gap)} y={y} w={w} label={s.label} color={i === 3 ? AMBER : BLUE} sub={s.sub} />
      ))}
      {steps.slice(0, -1).map((_, i) => (
        <Arrow key={i} x1={(i + 1) * (w + gap) - gap + 2} y1={y + 15} x2={(i + 1) * (w + gap) - 4} y2={y + 15} />
      ))}
      <text x={0} y={88} fontSize={10} fill={MUTED}>
        Not reported? It shows on Raising as &quot;N visits need a report&quot; — yours, your team&apos;s, or your function&apos;s.
      </text>
    </svg>
  );
}

/** Who sees what — the scope pyramid. */
function RolesDiagram() {
  const rows = [
    { label: "LCP · IM lead — the whole LC", w: 420, color: BLUE },
    { label: "LCVP / Director — their function (+ B2B)", w: 330, color: GT },
    { label: "Team Leader — own + their team's", w: 240, color: AMBER },
    { label: "Member / Coordinator — their own", w: 170, color: GV },
  ];
  return (
    <svg viewBox="0 0 440 168" role="img" aria-label="Who sees what" className="w-full max-w-md">
      {rows.map((r, i) => (
        <g key={r.label}>
          <rect x={(440 - r.w) / 2} y={i * 40 + 4} width={r.w} height={30} rx={15} fill={r.color} opacity={0.14} />
          <rect x={(440 - r.w) / 2} y={i * 40 + 4} width={r.w} height={30} rx={15} fill="none" stroke={r.color} strokeWidth={1.4} />
          <text x={220} y={i * 40 + 23} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={r.color}>
            {r.label}
          </text>
        </g>
      ))}
      <text x={220} y={162} textAnchor="middle" fontSize={10} fill={MUTED}>
        Reading widens upward; editing stays with the owner. Every rule is enforced on the server.
      </text>
    </svg>
  );
}

/** Touch points: book → who's invited → session → attendance → rating. */
function TouchPointFlowDiagram() {
  const steps = [
    { label: "Book it 📅", sub: "Meeting · WH · Outing" },
    { label: "Who's invited", sub: "tick list, group chips" },
    { label: "The session", sub: "email + bell went out" },
    { label: "Attendance", sub: "auto for working hours" },
    { label: "Rate it ⭐", sub: "1–5, evening email asks" },
  ];
  const w = 104, gap = 22, y = 12;
  return (
    <svg viewBox={`0 0 ${steps.length * (w + gap) - gap} 78`} role="img" aria-label="A touch point's life" className="w-full max-w-xl">
      {steps.map((s, i) => (
        <Pill key={s.label} x={i * (w + gap)} y={y} w={w} label={s.label} color={i === 4 ? OK : "var(--primary)"} sub={s.sub} />
      ))}
      {steps.slice(0, -1).map((_, i) => (
        <Arrow key={i} x1={(i + 1) * (w + gap) - gap + 2} y1={y + 15} x2={(i + 1) * (w + gap) - 4} y2={y + 15} />
      ))}
    </svg>
  );
}

const DIAGRAMS: Record<string, () => React.ReactElement> = {
  pipeline: PipelineDiagram,
  "signup-funnel": SignupFunnelDiagram,
  "ir-booking": IrBookingDiagram,
  "visit-flow": VisitFlowDiagram,
  roles: RolesDiagram,
  "touch-point-flow": TouchPointFlowDiagram,
};

export function HelpDiagram({ id, caption }: { id: string; caption?: string }) {
  const D = DIAGRAMS[id];
  if (!D) return null;
  return (
    <figure className="my-2 overflow-x-auto rounded-xl border bg-muted/30 p-3">
      <D />
      {caption ? (
        <figcaption className="mt-1.5 text-xs text-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
