"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { PdpPageData, PdpTarget, PdpNumbers } from "@/server/pdp";
import { savePdp, pdpNumbersForTarget, type PdpInput } from "@/server/pdp-actions";
import { PDP_TRACKS, pdpTrackLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** FILING ONE PERSON'S PDP (v36).
 *
 *  The form is the one-on-one, in the order the conversation actually happens:
 *  the O2O questions first (how are you, what is in your way), then the two
 *  goals, then last month's numbers with the gap they point at — and the
 *  weekly steps under each goal, because a goal with no steps is a wish.
 *
 *  ⚠️ LAST MONTH'S NUMBERS ARE FETCHED, NOT TYPED. On the sheets, the leader
 *  copied them across from a dashboard that already knew them, which is both
 *  the most tedious part of the process and the part most likely to be wrong
 *  or skipped. Sodio reads them from the same function the dashboard reads,
 *  and freezes them into the row when it is filed, so the gap the plan names
 *  keeps matching the steps agreed against it. */
export function PdpForm({
  target, data, viewerName, onClose,
}: {
  target: PdpTarget;
  data: PdpPageData;
  viewerName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [numbers, setNumbers] = useState<PdpNumbers | null>(null);
  const existing = data.authored.find((p) => p.member_id === target.id) ?? null;

  const [o2o, setO2o] = useState<Record<string, string>>(
    (existing?.o2o as Record<string, string>) ?? {}
  );
  const [personalSkill, setPersonalSkill] = useState(existing?.personal_skill ?? "");
  const [personalGoal, setPersonalGoal] = useState(existing?.personal_goal ?? "");
  const [profMetric, setProfMetric] = useState(existing?.professional_metric ?? "");
  const [profTarget, setProfTarget] = useState(
    existing?.professional_target != null ? String(existing.professional_target) : ""
  );
  const [profGoal, setProfGoal] = useState(existing?.professional_goal ?? "");
  const [gapStep, setGapStep] = useState(existing?.gap_step ?? "");
  const [gapNote, setGapNote] = useState(existing?.gap_note ?? "");
  const [steps, setSteps] = useState<Record<string, Record<string, string>>>(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const t of PDP_TRACKS) out[t.value] = {};
    for (const s of existing?.steps ?? []) {
      out[s.track] = out[s.track] ?? {};
      out[s.track][String(s.week)] = s.body;
    }
    return out;
  });

  // last month's numbers — read once when the form opens
  useEffect(() => {
    let live = true;
    pdpNumbersForTarget(target.id)
      .then((n) => { if (live) setNumbers(n); })
      .catch(() => { if (live) setNumbers(null); });
    return () => { live = false; };
  }, [target.id]);

  // ⚠️ THE GAP IS A SUGGESTION, PRE-FILLED ONCE, NEVER FORCED. `funnelGap`
  // returns null when there is too little volume to say anything honest, and
  // the leader can always overrule it — they were in the room and it wasn't.
  useEffect(() => {
    if (numbers?.gap && !gapStep) setGapStep(numbers.gap.step);
    if (numbers?.metricLabel && !profMetric) setProfMetric(numbers.metricLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbers]);

  const setStep = (track: string, week: number, body: string) =>
    setSteps((s) => ({ ...s, [track]: { ...(s[track] ?? {}), [String(week)]: body } }));

  const submit = (file: boolean) =>
    start(async () => {
      const input: PdpInput = {
        memberId: target.id,
        o2o,
        personalSkill: personalSkill || null,
        personalGoal: personalGoal || null,
        professionalMetric: profMetric || null,
        professionalTarget: profTarget.trim() ? Number(profTarget) : null,
        professionalGoal: profGoal || null,
        gapStep: gapStep || null,
        gapNote: gapNote || null,
        steps,
        file,
      };
      const res = await savePdp(input);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(file ? `${target.name}'s PDP is filed 📋` : "Saved as a draft");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle dir="auto">📋 {target.name} · {data.monthLabel}</DialogTitle>
          <DialogDescription>
            Fill this in <b>together</b> — it is the one-on-one, not a form to send.
            {target.isMm && target.reports > 0 ? (
              <> Once it is filed, {target.name} owes {target.reports} of their own.</>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {/* ------------------------------------------------ the O2O ---- */}
          {data.questions.length > 0 ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">The conversation</h3>
              {data.questions.map((q) => (
                <div key={q.id} className="grid gap-1.5">
                  <Label htmlFor={`q-${q.id}`} dir="auto">{q.prompt}</Label>
                  {q.hint ? (
                    <p className="text-xs text-muted-foreground" dir="auto">{q.hint}</p>
                  ) : null}
                  <Textarea
                    id={`q-${q.id}`}
                    rows={2}
                    dir="auto"
                    value={o2o[q.id] ?? ""}
                    onChange={(e) => setO2o((s) => ({ ...s, [q.id]: e.target.value }))}
                    placeholder="Short answer…"
                  />
                </div>
              ))}
            </section>
          ) : null}

          {/* --------------------------------------- last month's numbers - */}
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">
              Last month{numbers?.monthLabel ? ` — ${numbers.monthLabel}` : ""}
            </h3>
            {!numbers ? (
              <p className="text-sm text-muted-foreground">Reading their numbers…</p>
            ) : numbers.snapshot ? (
              <>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {Object.entries(numbers.snapshot).map(([k, v]) => (
                    <div key={k} className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">{k}</p>
                      <p className="font-mono text-lg font-semibold tabular-nums">{String(v)}</p>
                    </div>
                  ))}
                </div>
                {numbers.gap ? (
                  <p className="rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                    🔎 The thinnest step is <b>{numbers.gap.step}</b> — {numbers.gap.note}
                  </p>
                ) : (
                  // funnelGap returns null rather than inventing one from three
                  // rows of data, and the form says so instead of showing
                  // nothing and letting the leader assume it found nothing wrong
                  <p className="text-xs text-muted-foreground">
                    Not enough here to point at one step honestly — pick the gap yourselves.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {numbers.note ?? "No numbers for last month."}
              </p>
            )}
          </section>

          {/* -------------------------------------------------- the goals - */}
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">🌱 The skill they want to build</h3>
            <Input
              dir="auto"
              value={personalSkill}
              onChange={(e) => setPersonalSkill(e.target.value)}
              placeholder="e.g. Saying no without losing the room"
            />
            <Textarea
              rows={2}
              dir="auto"
              value={personalGoal}
              onChange={(e) => setPersonalGoal(e.target.value)}
              placeholder="What does better look like by the end of the month?"
            />
            <Weeks track="personal" weeks={data.weeks} steps={steps} onChange={setStep} />
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">🎯 The month&apos;s target</h3>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                className="w-28"
                value={profTarget}
                onChange={(e) => setProfTarget(e.target.value)}
                placeholder="12"
              />
              <Input
                dir="auto"
                value={profMetric}
                onChange={(e) => setProfMetric(e.target.value)}
                placeholder="opens · approvals · partnerships"
              />
            </div>
            <Textarea
              rows={2}
              dir="auto"
              value={profGoal}
              onChange={(e) => setProfGoal(e.target.value)}
              placeholder="How are they going to get there?"
            />
            <Weeks track="professional" weeks={data.weeks} steps={steps} onChange={setStep} />
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">🔎 The gap to close</h3>
            <Input
              dir="auto"
              value={gapStep}
              onChange={(e) => setGapStep(e.target.value)}
              placeholder="which funnel step"
            />
            <Textarea
              rows={2}
              dir="auto"
              value={gapNote}
              onChange={(e) => setGapNote(e.target.value)}
              placeholder="Why is it thin, and what changes it?"
            />
            <Weeks track="gap" weeks={data.weeks} steps={steps} onChange={setStep} />
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={pending}>
            Save draft
          </Button>
          <Button onClick={() => submit(true)} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            File it — {viewerName.split(" ")[0]} &amp; {target.name.split(" ")[0]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The four weeks of the month, as the calendar actually falls. */
function Weeks({
  track, weeks, steps, onChange,
}: {
  track: string;
  weeks: PdpPageData["weeks"];
  steps: Record<string, Record<string, string>>;
  onChange: (track: string, week: number, body: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {pdpTrackLabel(track)} — one step a week
      </p>
      {weeks.map((w) => (
        <div key={w.week} className="flex items-center gap-2">
          <span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">
            W{w.week} · {w.label}
          </span>
          <Input
            dir="auto"
            className="h-8"
            value={steps[track]?.[String(w.week)] ?? ""}
            onChange={(e) => onChange(track, w.week, e.target.value)}
            placeholder="…"
          />
        </div>
      ))}
    </div>
  );
}
