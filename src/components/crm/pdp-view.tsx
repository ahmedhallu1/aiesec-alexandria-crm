"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, ClipboardList, Circle, Target, Users2 } from "lucide-react";
import type { PdpPageData, PdpRow, PdpTarget } from "@/server/pdp";
import { togglePdpStep } from "@/server/pdp-actions";
import { PDP_TRACKS, pdpTrackLabel, fmtDateTime } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PdpForm } from "./pdp-form";
import { cn } from "@/lib/utils";

/** ONE-ON-ONES AND DEVELOPMENT PLANS (v36).
 *
 *  Three audiences on one page, because they are three views of one
 *  conversation and splitting them would hide the cascade:
 *
 *   · **Mine** — the plan somebody filed FOR me, and the weekly steps I tick.
 *     This is the half the Google Sheets never really gave a member: the sheet
 *     lived in their leader's Drive, so "what did we agree" meant asking.
 *   · **My people** — who I owe a conversation to this round, and where each
 *     one stands. An MM's list is their members; a VP's is their MMs, and each
 *     row says how many that MM then owes, so the cascade is visible from the
 *     top rather than discovered when it fails.
 *   · **The LC** — TM and the LCP only: who has filed and who has not. */
export function PdpView({
  data, viewerId, viewerName,
}: {
  data: PdpPageData;
  viewerId: string;
  viewerName: string;
}) {
  const [filingFor, setFilingFor] = useState<PdpTarget | null>(null);
  const owed = [...data.targets.mms, ...data.targets.others];
  const done = owed.filter((t) => t.state === "filed").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="rise-in">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          <ClipboardList className="mr-1.5 inline size-6 text-primary" />
          One-on-ones &amp; development plans
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.cycle ? (
            <>
              <b>{data.monthLabel}</b>
              {data.deadlineLabel ? (
                <>
                  {" "}· due <b>{data.deadlineLabel}</b>
                  {data.overdue ? (
                    <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                      — past the deadline
                    </span>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            "No round is open right now — TM opens one for the month."
          )}
        </p>
      </header>

      {/* ---------------------------------------------------------- MINE --- */}
      {data.mine ? (
        <MyPdp pdp={data.mine} canTick />
      ) : data.cycle && owed.length === 0 && !data.runsProcess ? (
        <Card className="rise-in">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nothing filed for you yet this round. Your leader will sit down with
            you and fill it in — it is a conversation, not a form you get sent.
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------ MY PEOPLE --- */}
      {owed.length > 0 ? (
        <Card className="rise-in rise-in-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Users2 className="size-4 text-muted-foreground" />
              My people
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {done}/{owed.length} filed
              </span>
              {/* ⚠️ A COUNT, NEVER A CAP. The TM brief says "max 4 MMs each",
                  which is a statement about workload, not a rule — refusing a
                  fifth would break the one leader who genuinely has five. */}
              {owed.length > 4 ? (
                <span className="text-xs font-normal text-muted-foreground">
                  · that is more than the four this process assumes
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.targets.mms.length > 0 ? (
              <Group
                label="Your MMs"
                hint="file for these, and each of them then files for their own people"
                targets={data.targets.mms}
                onFile={setFilingFor}
                disabled={!data.cycle}
              />
            ) : null}
            {data.targets.others.length > 0 ? (
              <Group
                label="Also reporting to you"
                hint="members with no MM between you and them"
                targets={data.targets.others}
                onFile={setFilingFor}
                disabled={!data.cycle}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* -------------------------------------------------------- THE LC --- */}
      {data.compliance ? (
        <Compliance
          c={data.compliance}
          /* ⚠️ TM AND THE LCP FILE FROM HERE, NOT FROM "My people". They MAY
             file for anyone — that is the unsticking case, when a leader has
             left or gone quiet and somebody's conversation is stranded — but
             putting the whole LC in a card headed "My people" made a list of
             79 out of a to-do list of three. It belongs on the LC-wide list,
             where the person being unstuck is actually visible. */
          onFile={data.runsProcess ? setFilingFor : undefined}
        />
      ) : null}

      {/* ------------------------------------------------------- HISTORY --- */}
      {data.myHistory.length > 0 ? (
        <Card className="rise-in rise-in-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My earlier plans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.myHistory.map((p) => (
              <details key={p.id} className="rounded-lg border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                  {p.personal_skill ?? "Development plan"}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {p.filed_at ? fmtDateTime(p.filed_at) : "draft"}
                  </span>
                </summary>
                <div className="pt-2">
                  <MyPdp pdp={p} canTick={false} bare />
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {filingFor && data.cycle ? (
        <PdpForm
          target={filingFor}
          data={data}
          viewerName={viewerName}
          onClose={() => setFilingFor(null)}
        />
      ) : null}
    </div>
  );
}

function Group({
  label, hint, targets, onFile, disabled,
}: {
  label: string;
  hint: string;
  targets: PdpTarget[];
  onFile: (t: PdpTarget) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {label} <span className="font-normal">— {hint}</span>
      </p>
      {targets.map((t) => (
        <div
          key={t.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
        >
          <span className="min-w-0 flex-1 font-medium" dir="auto">{t.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{t.role}</span>
          {t.isMm && t.reports > 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              owes {t.reports}
            </Badge>
          ) : null}
          <StateChip state={t.state} />
          <Button
            size="sm"
            variant={t.state === "filed" ? "outline" : "default"}
            className="h-8"
            disabled={disabled}
            onClick={() => onFile(t)}
          >
            {t.state === "none" ? "File it" : t.state === "draft" ? "Finish it" : "Open"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function StateChip({ state }: { state: PdpTarget["state"] }) {
  if (state === "filed")
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        filed
      </span>
    );
  if (state === "draft")
    return (
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        draft
      </span>
    );
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">not yet</span>;
}

/** The plan as the person it is ABOUT reads it. */
function MyPdp({ pdp, canTick, bare }: { pdp: PdpRow; canTick: boolean; bare?: boolean }) {
  const body = (
    <div className="space-y-4">
      {pdp.personal_skill || pdp.personal_goal ? (
        <Goal
          icon="🌱"
          title="The skill"
          headline={pdp.personal_skill}
          note={pdp.personal_goal}
        />
      ) : null}
      {pdp.professional_metric || pdp.professional_goal ? (
        <Goal
          icon="🎯"
          title="The month's target"
          headline={
            pdp.professional_target != null && pdp.professional_metric
              ? `${pdp.professional_target} ${pdp.professional_metric}`
              : pdp.professional_metric
          }
          note={pdp.professional_goal}
        />
      ) : null}
      {pdp.gap_step || pdp.gap_note ? (
        <Goal
          icon="🔎"
          title="The gap to close"
          headline={pdp.gap_step}
          note={pdp.gap_note}
        />
      ) : null}

      {PDP_TRACKS.map((t) => {
        const steps = pdp.steps.filter((s) => s.track === t.value).sort((a, b) => a.week - b.week);
        if (steps.length === 0) return null;
        return (
          <div key={t.value} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {pdpTrackLabel(t.value)} — week by week
            </p>
            {steps.map((s) => (
              <Step key={s.id} id={s.id} week={s.week} body={s.body} done={s.done} canTick={canTick} />
            ))}
          </div>
        );
      })}
    </div>
  );

  if (bare) return body;
  return (
    <Card className="rise-in">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Target className="size-4 text-primary" /> My plan
          {pdp.author_name ? (
            <span className="text-xs font-normal text-muted-foreground">
              with {pdp.author_name}
            </span>
          ) : null}
          {pdp.status === "draft" ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">draft</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Goal({
  icon, title, headline, note,
}: {
  icon: string;
  title: string;
  headline: string | null;
  note: string | null;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">
        {icon} {title}
      </p>
      {headline ? (
        <p className="font-medium" dir="auto">{headline}</p>
      ) : null}
      {note ? (
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** ⚠️ THE ONE THING THE PERSON A PLAN IS ABOUT MAY CHANGE ON IT. The plan is
 *  their leader's; the doing is theirs, and a plan you cannot mark progress on
 *  is a document rather than a plan. */
function Step({
  id, week, body, done, canTick,
}: {
  id: string;
  week: number;
  body: string;
  done: boolean;
  canTick: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState(done);

  const toggle = () =>
    start(async () => {
      const next = !optimistic;
      setOptimistic(next);
      const res = await togglePdpStep(id, next);
      if (!res.ok) {
        setOptimistic(!next); // put it back — the server said no
        toast.error(res.error);
        return;
      }
      router.refresh();
    });

  return (
    <button
      type="button"
      disabled={!canTick || pending}
      onClick={toggle}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        optimistic && "bg-emerald-500/5",
        canTick ? "hover:border-primary/50" : "cursor-default"
      )}
    >
      {optimistic ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">W{week}</span>
        <span className={cn(optimistic && "text-muted-foreground line-through")} dir="auto">
          {body}
        </span>
      </span>
    </button>
  );
}

function Compliance({
  c, onFile,
}: {
  c: NonNullable<PdpPageData["compliance"]>;
  onFile?: (t: PdpTarget) => void;
}) {
  const total = c.rows.length;
  return (
    <Card className="rise-in rise-in-3">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarClock className="size-4 text-muted-foreground" /> Across the LC
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {c.filed}/{total} filed
            {c.draft > 0 ? ` · ${c.draft} still draft` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {total === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nobody owes a PDP this round.
          </p>
        ) : (
          // ⚠️ NAMES AND STATES ONLY. TM's leadership needs to see that a
          // conversation happened; they do not need its contents to do that,
          // and `canReadPdp` still governs opening any individual plan. A
          // compliance list that doubles as a reading list would make people
          // careful about what they write down, which is the one thing this
          // process cannot afford.
          c.rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/30"
            >
              <span className="min-w-0 flex-1 font-medium" dir="auto">{r.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.role}</span>
              {r.managerName ? (
                <span className="text-xs text-muted-foreground" dir="auto">
                  with {r.managerName}
                </span>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  no manager on file
                </span>
              )}
              <StateChip state={r.state} />
              {onFile ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() =>
                    onFile({
                      id: r.id,
                      name: r.name,
                      role: r.role,
                      team_name: null,
                      functions: r.functions,
                      // this list is names and states; the cascade counts
                      // belong to "My people" and are not read here
                      isMm: false,
                      reports: 0,
                      state: r.state,
                      pdpId: null,
                    })
                  }
                >
                  {r.state === "none" ? "File it" : "Open"}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
