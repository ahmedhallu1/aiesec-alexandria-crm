"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Inbox, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import type { AttendedTouchPointOption, LcFeedbackRow } from "@/server/data";
import {
  getFeedbackFileUrl, setLcFeedbackStatus, shareLcFeedback, submitLcFeedback,
  tellLcFeedbackAuthor,
} from "@/server/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FeedbackAttachments, type FeedbackAttachment } from "./feedback-attachments";

/* ------------------------------------------------------------------ types */

interface LiteMember {
  id: string;
  label: string;
  role: string;
  team: string | null;
  functions: string[];
}

interface LiteViewer {
  id: string;
  role: string;
  stakeholderId: string | null;
  teamMemberIds: string[];
  functions: string[];
}

const MAX_PEOPLE = 10;

/** The chip label follows the MANAGER's actual role — a Team Leader's manager
 *  is a VP, so a TL never sees a "My TL" chip. */
const MANAGER_LABEL: Record<string, string> = {
  "Team Leader": "My TL",
  LCVP: "My VP",
  Director: "My Director",
  LCP: "My LCP",
  Coordinator: "My Coordinator",
  Member: "My manager",
};

/* ------------------------------------------------------------------ view */

/** What each star MEANS — a number with no words is read differently by
 *  everyone, and a 3 that one person calls "fine" another calls "bad". */
const STAR_WORDS: Record<number, string> = {
  1: "Poor",
  2: "Could be better",
  3: "Fine",
  4: "Good",
  5: "Excellent",
};

export function LcFeedbackView({
  members,
  touchPoints,
  viewer,
  isInboxOwner,
  inbox,
}: {
  members: LiteMember[];
  /** past touch points the viewer was part of (v33.19) — empty hides the tab */
  touchPoints: AttendedTouchPointOption[];
  viewer: LiteViewer;
  isInboxOwner: boolean;
  inbox: LcFeedbackRow[];
}) {
  // opens on CONCERN (v33.19.2): a shout-out is easy to give unprompted;
  // the harder thing is the one worth lowering the barrier for
  const [positive, setPositive] = useState(false);
  const [target, setTarget] = useState<"people" | "touchpoint">("people");
  const [touchPointId, setTouchPointId] = useState("");
  /** 1–5 stars — a touch point is RATED, never praised or reported (v33.33) */
  const [rating, setRating] = useState(0);
  const [hoverStar, setHoverStar] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const aboutTouchPoint = target === "touchpoint" && touchPoints.length > 0;
  const chosenTouchPoint = touchPoints.find((t) => t.id === touchPointId) ?? null;

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /* ---------------------------------------------------- smart quick-picks */
  const chips = useMemo(() => {
    const out: { key: string; label: string; ids: string[] }[] = [];

    // My manager — labeled by their ACTUAL role (TL / VP / Director / …)
    const manager = viewer.stakeholderId ? byId.get(viewer.stakeholderId) : undefined;
    if (manager) {
      out.push({
        key: "manager",
        label: MANAGER_LABEL[manager.role] ?? "My manager",
        ids: [manager.id],
      });
    }

    // My VP(s) — active LCVPs sharing at least one function with the viewer
    const vps = members.filter(
      (m) => m.role === "LCVP" && m.functions.some((f) => viewer.functions.includes(f))
    );
    if (vps.length > 0) {
      out.push({
        key: "vps",
        label: vps.length > 1 ? "My VPs" : "My VP",
        ids: vps.map((m) => m.id),
      });
    }

    // The LCP
    const lcp = members.find((m) => m.role === "LCP");
    if (lcp) out.push({ key: "lcp", label: "The LCP", ids: [lcp.id] });

    // My team (a TL's direct team) — adds everyone at once
    const team = viewer.teamMemberIds.filter((id) => byId.has(id));
    if (team.length > 0) out.push({ key: "team", label: "My team", ids: team });

    // drop chips that resolve to the exact same people as an earlier chip
    // (e.g. my manager IS the LCP)
    const seen = new Set<string>();
    return out.filter((c) => {
      const sig = [...c.ids].sort().join("|");
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }, [members, byId, viewer]);

  /* -------------------------------------------------------- select logic */
  const addIds = (ids: string[]) =>
    setSelected((prev) => {
      const merged = [...prev];
      for (const id of ids) if (!merged.includes(id) && byId.has(id)) merged.push(id);
      if (merged.length > MAX_PEOPLE) {
        toast.error(`Max ${MAX_PEOPLE} people per feedback.`);
        return merged.slice(0, MAX_PEOPLE);
      }
      return merged;
    });

  const toggle = (id: string) =>
    selected.includes(id)
      ? setSelected((prev) => prev.filter((x) => x !== id))
      : addIds([id]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        (m.team ?? "").toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, query]);

  /* -------------------------------------------------------------- submit */
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);

  const submit = () =>
    startTransition(async () => {
      const res = await submitLcFeedback({
        positive,
        about: aboutTouchPoint ? [] : selected,
        message,
        anonymous,
        touchPointId: aboutTouchPoint ? touchPointId : undefined,
        rating: aboutTouchPoint ? rating : null,
        attachments,
      });
      if (res.ok) {
        toast.success(
          aboutTouchPoint
            ? `Rated ${rating}/5 — thanks ⭐`
            : positive
              ? "Shout-out sent 🎉"
              : "Concern filed privately 🤫"
        );
        setSelected([]);
        setTouchPointId("");
        setMessage("");
        setAnonymous(false);
        setPositive(true);
        setRating(0);
        setQuery("");
      } else {
        toast.error(res.error);
      }
    });

  const newCount = inbox.filter((r) => r.status === "new").length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* ------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">Feedback 💙</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Appreciate someone, raise a concern, or <b>rate a touch point</b>
            you were part of. A shout-out reaches the person directly;
            concerns and session ratings go privately to the LCP and TM.
          </p>
        </div>
        {isInboxOwner ? (
          <Button variant="outline" size="sm" onClick={() => setInboxOpen(true)}>
            <Inbox className="size-4" /> Inbox ({newCount})
          </Button>
        ) : null}
      </div>

      <Card className="rise-in rise-in-1">
        <CardContent className="grid min-w-0 gap-4 pt-5">
          {/* ------------------------------------------------ who it's about */}
          <div className="grid min-w-0 gap-2">
            {touchPoints.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Label className="mr-1">What is it about?</Label>
                <div className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted p-1">
                  {([
                    { val: "people", label: "A person" },
                    { val: "touchpoint", label: "A touch point" },
                  ] as const).map((t) => (
                    <button
                      key={t.val}
                      type="button"
                      onClick={() => setTarget(t.val)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        target === t.val
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {aboutTouchPoint ? (
              <>
                <Select value={touchPointId} onValueChange={setTouchPointId}>
                  {/* min-w-0 ON THE TRIGGER (v33.59's lesson): a grid item's
                      automatic minimum size is its own min-content width, and
                      that beats w-full. This label is a whole touch point —
                      team, date and time — so on a 375px screen it forced the
                      card wider than the viewport. */}
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Pick a past touch point…" />
                  </SelectTrigger>
                  <SelectContent>
                    {touchPoints.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {chosenTouchPoint
                    ? "Goes to the people who run the LC's touch points — TM and the LCP — not to whoever booked it."
                    : "Every past touch point you were part of shows here — you don't have to have been marked present."}
                </p>
                {/* THE STARS ARE THE REVIEW (v33.33) — a note on top is
                    welcome, not owed. */}
                {chosenTouchPoint ? (
                  <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-3">
                    <Label>How was it?</Label>
                    <div
                      className="flex items-center gap-1"
                      onMouseLeave={() => setHoverStar(0)}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-label={`${n} star${n === 1 ? "" : "s"}`}
                          onMouseEnter={() => setHoverStar(n)}
                          onClick={() => setRating(n === rating ? 0 : n)}
                          className="rounded p-0.5 text-2xl leading-none transition-transform hover:scale-110"
                        >
                          <span
                            className={cn(
                              (hoverStar || rating) >= n
                                ? "text-amber-400"
                                : "text-muted-foreground/30"
                            )}
                          >
                            ★
                          </span>
                        </button>
                      ))}
                      <span className="ml-2 text-sm text-muted-foreground">
                        {STAR_WORDS[hoverStar || rating] ?? "Pick a rating"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
            <Label>Who is it about?</Label>

            {chips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => addIds(c.ids)}
                    className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    + {c.label}
                  </button>
                ))}
              </div>
            ) : null}

            {selected.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((id) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary"
                    >
                      {m.label}
                      <button
                        type="button"
                        aria-label={`Remove ${m.label}`}
                        onClick={() => toggle(id)}
                        className="rounded-full p-0.5 hover:bg-primary/20"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, team or role…"
                className="pl-9"
              />
            </div>

            <div className="max-h-56 overflow-auto rounded-lg border">
              {results.length === 0 ? (
                <p className="p-3 text-center text-sm text-muted-foreground">
                  No one matches “{query}”.
                </p>
              ) : (
                results.map((m) => {
                  const on = selected.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/60",
                        on && "bg-primary/5"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input"
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {m.role}
                        {m.team ? ` · ${m.team}` : ""}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
              </>
            )}
          </div>


          {/* ORDER MATTERS HERE (v34.3). Shout-out/Concern used to come first
              — and then hid itself the moment you picked a touch point,
              because a session is RATED, not praised or reported. So the first
              control on the form was the one that might not apply, and
              choosing a touch point made it vanish upward. Ask WHAT it is
              about first; the tone toggle follows only when a tone is the
              right question. */}
          {/* ------------------------------------------ positive/negative */}
          {/* A TOUCH POINT IS RATED, NOT PRAISED OR REPORTED (v33.33). Neither
              "shout-out" nor "concern" fits a session: "good but too long" is
              not a complaint about a person and not applause for one. */}
          <div className={cn("grid gap-2", aboutTouchPoint && "hidden")}>
            <div className="inline-flex w-fit items-center gap-1 rounded-full border bg-muted p-1">
              {([
                { val: true, label: "🎉 Shout-out" },
                { val: false, label: "😟 Concern" },
              ] as const).map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setPositive(t.val)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                    positive === t.val
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {positive
                ? "They'll get it as a notification + email."
                : "Goes to a private inbox only the LCP and TM read — never to the person."}
            </p>
          </div>

          {/* --------------------------------------------------- message */}
          <div className="grid gap-2">
            <Label>
              {aboutTouchPoint
                ? "Anything to add? (optional)"
                : positive
                  ? "What did they do? 💙"
                  : "What's the concern?"}
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              dir="auto"
              placeholder={
                aboutTouchPoint
                  ? "What worked, what didn't, what you'd change…"
                  : positive
                    ? "Tell them why they're great — they'll read this word for word…"
                    : "Be specific and fair — only the LCP and TM read this…"
              }
            />
            <FeedbackAttachments
              value={attachments}
              onChange={setAttachments}
              disabled={pending}
            />
          </div>

          {/* ------------------------------------------------- anonymous */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Send anonymously 🎭</p>
              <p className="text-xs text-muted-foreground">
                {aboutTouchPoint
                  ? "The rating counts either way — your name won't be shown with it."
                  : positive
                    ? "They'll know someone appreciated them — just not who."
                    : "Your name won't be shown with it — the mic is yours."}
              </p>
            </div>
            <Switch checked={anonymous} onCheckedChange={setAnonymous} />
          </div>

          <div>
            <Button
              onClick={submit}
              disabled={
                pending ||
                (aboutTouchPoint
                  ? !touchPointId || rating === 0
                  : selected.length === 0 || message.trim().length < 3)
              }
            >
              {pending
                ? "Sending…"
                : aboutTouchPoint
                  ? `Send the rating ${rating ? "★".repeat(rating) : "⭐"}`
                  : positive
                    ? "Send the shout-out 🎉"
                    : "File the concern 🤫"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isInboxOwner ? (
        <LcFeedbackInbox
          rows={inbox}
          people={members.map((m) => ({ id: m.id, label: m.label, role: m.role }))}
          open={inboxOpen}
          onOpenChange={setInboxOpen}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ inbox */

/** THE INBOX IS AN INBOX NOW (v33.22).
 *
 *  It used to be one flat list with a new/seen/done dropdown — everything
 *  mixed together (a shout-out beside a serious concern beside a note about
 *  Thursday's meeting), nothing to do with a row except change its state, and
 *  no way to bring in the person who could actually act.
 *
 *  Now: grouped by KIND, filtered by state, and every row can be passed on,
 *  closed, archived, or answered back to whoever wrote it. */
const KIND_TABS = [
  { key: "concern", label: "😟 Concerns" },
  { key: "session", label: "📅 Touch points" },
  { key: "shoutout", label: "🎉 Shout-outs" },
] as const;

const STATE_TABS = [
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "archived", label: "Archived" },
] as const;

function LcFeedbackInbox({
  rows,
  people,
  open,
  onOpenChange,
}: {
  rows: LcFeedbackRow[];
  /** who a piece of feedback can be passed on to — the active LC */
  people: { id: string; label: string; role: string }[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [kind, setKind] = useState<(typeof KIND_TABS)[number]["key"]>("concern");
  const [state, setState] = useState<(typeof STATE_TABS)[number]["key"]>("open");
  const [shareFor, setShareFor] = useState<LcFeedbackRow | null>(null);
  const [tellFor, setTellFor] = useState<LcFeedbackRow | null>(null);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(ok);
        router.refresh();
      }
      setPendingId(null);
    });
  };

  const inState = (r: LcFeedbackRow) =>
    state === "open" ? r.status === "new" : r.status === state;
  const shown = rows.filter((r) => r.kind === kind && inState(r));
  const countOf = (k: string) => rows.filter((r) => r.kind === k && r.status === "new").length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Feedback inbox</DialogTitle>
          </DialogHeader>

          {/* what KIND — a concern, a touch-point review and a shout-out are three
              different jobs and never belonged in one pile */}
          <div className="flex flex-wrap gap-1.5">
            {KIND_TABS.map((t) => {
              const n = countOf(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setKind(t.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    kind === t.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input hover:bg-muted"
                  )}
                >
                  {t.label}
                  {n > 0 ? (
                    <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setState(t.key)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  state === t.key ? "border-foreground/40 bg-muted font-semibold" : "border-input"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing here — quiet LC, happy LC. 💙
            </p>
          ) : (
            <div className="grid gap-3">
              {shown.map((r) => (
                <div key={r.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={r.positive ? "default" : "destructive"}>
                      {r.kind === "session"
                        ? "📅 Touch point"
                        : r.positive
                          ? "🎉 Shout-out"
                          : "😟 Concern"}
                    </Badge>
                    {/* THE SCORE, READABLE AT A GLANCE (v33.33) — the point of
                        a rating is that you can scan a column of them */}
                    {r.rating ? (
                      <span
                        className="text-sm font-semibold text-amber-500"
                        title={`${r.rating} out of 5`}
                      >
                        {"★".repeat(r.rating)}
                        <span className="text-muted-foreground/40">
                          {"★".repeat(5 - r.rating)}
                        </span>
                      </span>
                    ) : null}
                    {r.sessionLabel ? (
                      <Badge variant="outline" className="rounded-full">{r.sessionLabel}</Badge>
                    ) : (
                      r.aboutNames.map((n, i) => (
                        <Badge key={`${r.id}-${i}`} variant="secondary" className="rounded-full">
                          {n}
                        </Badge>
                      ))
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-start" dir="auto">
                    {r.message}
                  </p>
                  {r.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.attachments.map((a) => (
                        <AttachmentChip key={a.path} path={a.path} name={a.name} />
                      ))}
                    </div>
                  ) : null}
                  {r.resolution ? (
                    <p className="mt-2 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground" dir="auto">
                      <b className="text-foreground">Handled</b>
                      {r.resolvedBy ? ` by ${r.resolvedBy}` : ""}: {r.resolution}
                    </p>
                  ) : null}
                  {r.sharedWith.length > 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      📨 Shared with {r.sharedWith.join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {/* an anonymous author is shown to the break-glass admin
                        ALONE (v33.30) — labelled, because whoever reads it
                        needs to know it must not leave this screen */}
                    {r.authorAdminOnly ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        🎭 Anonymous — {r.author} (admin eyes only)
                      </span>
                    ) : (
                      r.author ?? "Anonymous 🎭"
                    )}
                    {" · "}
                    {fmtDateTime(r.created_at)}
                    {r.authorTold ? " · ✅ author told" : ""}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm" variant="outline" className="h-8 text-xs"
                      disabled={pendingId === r.id}
                      onClick={() => setShareFor(r)}
                    >
                      📨 Share
                    </Button>
                    {r.canTellAuthor ? (
                      <Button
                        size="sm" variant="outline" className="h-8 text-xs"
                        disabled={pendingId === r.id}
                        onClick={() => setTellFor(r)}
                      >
                        💬 Tell them it&apos;s done
                      </Button>
                    ) : null}
                    {r.status !== "done" ? (
                      <Button
                        size="sm" className="h-8 text-xs"
                        disabled={pendingId === r.id}
                        onClick={() =>
                          run(r.id, () => setLcFeedbackStatus(r.id, "done"), "Marked done ✅")
                        }
                      >
                        <Check className="size-3.5" /> Done
                      </Button>
                    ) : null}
                    {r.status !== "archived" ? (
                      <Button
                        size="sm" variant="ghost" className="h-8 text-xs"
                        disabled={pendingId === r.id}
                        onClick={() =>
                          run(r.id, () => setLcFeedbackStatus(r.id, "archived"), "Archived 🗄️")
                        }
                      >
                        🗄️ Archive
                      </Button>
                    ) : (
                      <Button
                        size="sm" variant="ghost" className="h-8 text-xs"
                        disabled={pendingId === r.id}
                        onClick={() =>
                          run(r.id, () => setLcFeedbackStatus(r.id, "new"), "Back in the inbox")
                        }
                      >
                        ↩️ Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ShareFeedbackDialog
        row={shareFor}
        people={people}
        onClose={() => setShareFor(null)}
        onDone={() => { setShareFor(null); router.refresh(); }}
      />
      <TellAuthorDialog
        row={tellFor}
        onClose={() => setTellFor(null)}
        onDone={() => { setTellFor(null); router.refresh(); }}
      />
    </>
  );
}

/** A 10-minute signed link to whatever the author attached. */
function AttachmentChip({ path, name }: { path: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        // open the tab BEFORE the await, or Safari blocks it as a popup
        const tab = window.open("", "_blank");
        setBusy(true);
        const res = await getFeedbackFileUrl(path);
        setBusy(false);
        if (res.ok && res.data) tab?.location.assign(res.data.url);
        else { tab?.close(); toast.error(res.ok ? "Could not open it." : res.error); }
      }}
      className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
    >
      📎 {name}
    </button>
  );
}

/** Pass a piece of feedback to whoever can act on it. The author is never
 *  named — sharing must not be a way around anonymity. */
function ShareFeedbackDialog({
  row, people, onClose, onDone,
}: {
  row: LcFeedbackRow | null;
  people: { id: string; label: string; role: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people
      .filter((p) => !needle || p.label.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [people, q]);

  return (
    <Dialog
      open={!!row}
      onOpenChange={(o) => { if (!o) { onClose(); setPicked([]); setNote(""); setQ(""); } }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this feedback</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          They get the message itself by bell and email. <b>Who wrote it is
          never shown</b> — sharing is not a way around anonymity.
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the LC…"
            className="pl-8"
          />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border">
          {list.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setPicked((cur) =>
                    on ? cur.filter((x) => x !== p.id) : [...cur, p.id].slice(0, 20)
                  )
                }
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-start text-sm last:border-b-0",
                  on ? "bg-primary/10 font-semibold" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate" dir="auto">{p.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.role}</span>
              </button>
            );
          })}
          {list.length === 0 ? (
            <p className="p-3 text-center text-sm text-muted-foreground">Nobody by that name.</p>
          ) : null}
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          dir="auto"
          placeholder="Anything you want to add (optional)…"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={picked.length === 0 || pending}
            onClick={() =>
              start(async () => {
                if (!row) return;
                const res = await shareLcFeedback(row.id, picked, note);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success(`📨 Shared with ${res.data?.shared ?? picked.length}`);
                  setPicked([]); setNote(""); setQ("");
                  onDone();
                }
              })
            }
          >
            Share
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Close the loop with whoever filed it — anonymous or not. */
function TellAuthorDialog({
  row, onClose, onDone,
}: {
  row: LcFeedbackRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) { onClose(); setNote(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tell them it&apos;s handled</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          The person who filed this gets a bell and an email saying it was
          read and acted on — and it goes to Done. Anonymous feedback works
          too: Sodio knows who wrote it even when you don&apos;t, and this
          reveals nothing to anyone.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          dir="auto"
          placeholder="What happened, in a line or two (optional)…"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!row) return;
                const res = await tellLcFeedbackAuthor(row.id, note);
                if (!res.ok) toast.error(res.error);
                else { toast.success("They know 💬"); setNote(""); onDone(); }
              })
            }
          >
            Send it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
