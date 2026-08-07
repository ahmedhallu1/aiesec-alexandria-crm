"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Inbox, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import type { AttendedTouchPointOption, LcFeedbackRow } from "@/server/data";
import { submitLcFeedback, setLcFeedbackStatus } from "@/server/actions";
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
        attachments,
      });
      if (res.ok) {
        toast.success(positive ? "Shout-out sent 🎉" : "Concern filed privately 🤫");
        setSelected([]);
        setTouchPointId("");
        setMessage("");
        setAnonymous(false);
        setPositive(true);
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
            Appreciate someone — or a touch point you were part of — or raise a
            concern. Positive notes reach the person (or the organiser)
            directly; concerns go privately to the LCP and TM.
          </p>
        </div>
        {isInboxOwner ? (
          <Button variant="outline" size="sm" onClick={() => setInboxOpen(true)}>
            <Inbox className="size-4" /> Inbox ({newCount})
          </Button>
        ) : null}
      </div>

      <Card className="rise-in rise-in-1">
        <CardContent className="grid gap-4 pt-5">
          {/* ------------------------------------------ positive/negative */}
          <div className="grid gap-2">
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

          {/* ------------------------------------------------ who it's about */}
          <div className="grid gap-2">
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
                  <SelectTrigger className="w-full">
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
                    ? "Goes to the people who run the LC's sessions — TM, the LCP and F&L — not to whoever booked it."
                    : "Every past session you were part of shows here — you don't have to have been marked present."}
                </p>
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

          {/* --------------------------------------------------- message */}
          <div className="grid gap-2">
            <Label>
              {aboutTouchPoint
                ? positive
                  ? "What made it great? 💙"
                  : "What went wrong there?"
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
                positive
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
                {positive
                  ? "They'll know someone appreciated them — just not who."
                  : "No one will see your name, the mic is yours."}
              </p>
            </div>
            <Switch checked={anonymous} onCheckedChange={setAnonymous} />
          </div>

          <div>
            <Button
              onClick={submit}
              disabled={
                pending ||
                (aboutTouchPoint ? !touchPointId : selected.length === 0) ||
                message.trim().length < 3
              }
            >
              {pending
                ? "Sending…"
                : positive
                  ? "Send the shout-out 🎉"
                  : "File the concern 🤫"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isInboxOwner ? (
        <LcFeedbackInbox rows={inbox} open={inboxOpen} onOpenChange={setInboxOpen} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ inbox */

function LcFeedbackInbox({
  rows,
  open,
  onOpenChange,
}: {
  rows: LcFeedbackRow[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const setStatus = (id: string, status: LcFeedbackRow["status"]) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await setLcFeedbackStatus(id, status);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
      setPendingId(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Feedback inbox</DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing here yet — quiet LC, happy LC. 💙
          </p>
        ) : (
          <div className="grid gap-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={r.positive ? "default" : "destructive"}>
                    {r.positive ? "🎉 Shout-out" : "😟 Concern"}
                  </Badge>
                  {r.aboutNames.map((n, i) => (
                    <Badge key={`${r.id}-${i}`} variant="secondary" className="rounded-full">
                      {n}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-start" dir="auto">
                  {r.message}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {r.author ?? "Anonymous 🎭"} · {fmtDateTime(r.created_at)}
                  </p>
                  <Select
                    value={r.status}
                    onValueChange={(v) => setStatus(r.id, v as LcFeedbackRow["status"])}
                    disabled={pendingId === r.id}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="seen">Seen</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
