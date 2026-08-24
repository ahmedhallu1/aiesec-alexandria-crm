"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Loader2, Megaphone, Send } from "lucide-react";
import { toast } from "sonner";
import {
  getMyNotifications,
  listBroadcastTargets,
  markNotificationsRead,
  sendBroadcast,
  type NotificationRow,
} from "@/server/actions";
import { fmtDateTime, LC_FUNCTIONS, MEMBER_ROLES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** SHORT ENOUGH TO SCAN (v33.43). A full "Aug 12, 2026, 7:30 PM" on every row
 *  turned the panel into a wall of dates; what anyone reads is "how fresh is
 *  this". The exact time stays on the row's `title` attribute. */
function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

const KIND_ICON: Record<string, string> = {
  welcome: "🎉",
  reset: "🔑",
  visit: "🗓️",
  visit_announcement: "📢",
  followup: "📝",
  thanks: "💜",
  broadcast: "📣",
  lc_feedback: "💜",
  report: "📊",
  info: "🔔",
};

/** The bell: latest notifications in a popup; EB members can broadcast. */
export function NotificationsBell({
  canBroadcast,
  className,
}: {
  canBroadcast: boolean;
  /** lets the caller size the trigger (the sidebar footer stretches it) */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    const res = await getMyNotifications();
    if (res.ok && res.data) {
      setItems(res.data.items);
      setUnread(res.data.unread);
    } else {
      setItems([]);
    }
  };

  // badge count on mount (light call, no polling) — state is only set inside
  // the promise callback, never synchronously in the effect body
  useEffect(() => {
    getMyNotifications().then((res) => {
      if (res.ok && res.data) {
        setItems(res.data.items);
        setUnread(res.data.unread);
      } else {
        setItems([]);
      }
    });
  }, []);

  const openPopup = async () => {
    setOpen(true);
    await load();
    if (unread > 0) {
      markNotificationsRead().then(() => setUnread(0));
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Notifications"
        className={cn(
          "relative text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          className
        )}
        onClick={openPopup}
      >
        {/* the badge hangs off the BELL, not off the button (v33.6). The
            sidebar footer stretches this trigger to a full segment, and a
            badge pinned to the button's corner then floated far away from the
            icon it belongs to. */}
        <span className="relative inline-flex">
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -right-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="notif-panel max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="size-5 text-primary" /> Notifications
            </DialogTitle>
            <DialogDescription>
              Newest first. Tap one to open what it&apos;s about.
            </DialogDescription>
          </DialogHeader>

          {items === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              All quiet… suspiciously quiet 🤫
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((n) => {
                const go = n.link
                  ? () => { setOpen(false); router.push(n.link!); }
                  : undefined;
                return (
                  <div
                    key={n.id}
                    role={go ? "button" : undefined}
                    tabIndex={go ? 0 : undefined}
                    onClick={go}
                    onKeyDown={go ? (e) => { if (e.key === "Enter") go(); } : undefined}
                    className={cn(
                      "rounded-lg border p-2.5 text-sm",
                      !n.read_at && "border-primary/40 bg-primary/5",
                      go && "cursor-pointer transition-colors hover:border-primary hover:bg-primary/10"
                    )}
                  >
                    <p className="flex items-start gap-1.5 font-medium">
                      <span className="shrink-0">{KIND_ICON[n.kind] ?? "🔔"}</span>
                      <span className="min-w-0 flex-1 break-words" dir="auto">{n.title}</span>
                      <span
                        className="shrink-0 text-xs font-normal text-muted-foreground/70"
                        title={fmtDateTime(n.created_at)}
                      >
                        {relativeWhen(n.created_at)}
                      </span>
                      {go ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                    </p>
                    {/* the detail lives on the page this opens — two lines is
                        a summary, ten is a wall (v33.43) */}
                    {n.body ? (
                      <p className="mt-0.5 line-clamp-2 pl-6 text-xs text-muted-foreground" dir="auto">
                        {n.body}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {canBroadcast ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setComposeOpen(true); }}>
                <Megaphone className="size-4" /> Send a message
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {canBroadcast ? (
        <BroadcastDialog open={composeOpen} onOpenChange={setComposeOpen} />
      ) : null}
    </>
  );
}

function BroadcastDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "functions" | "roles" | "members">("all");
  const [fns, setFns] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<{ id: string; label: string; role: string }[]>([]);
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open && audience === "members" && targets.length === 0) {
      listBroadcastTargets().then((res) => {
        if (res.ok && res.data) setTargets(res.data);
      });
    }
  }, [open, audience, targets.length]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = () =>
    start(async () => {
      const res = await sendBroadcast({
        title, body, audience,
        functions: fns, roles, memberIds, alsoEmail,
      });
      if (res.ok) {
        toast.success(`📣 Delivered to ${res.data?.recipients} member${res.data?.recipients === 1 ? "" : "s"}`);
        setTitle(""); setBody(""); setFns([]); setRoles([]); setMemberIds([]);
        onOpenChange(false);
      } else toast.error(res.error);
    });

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-muted text-muted-foreground hover:border-primary/50"
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" /> Message the LC
          </DialogTitle>
          <DialogDescription>
            Lands in the bell of everyone you pick — optionally as an email too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Peak week starts Monday 🚀" />
          </div>
          <div className="grid gap-1.5">
            <Label>Message *</Label>
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Send to</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="functions">By function</SelectItem>
                <SelectItem value="roles">By role</SelectItem>
                <SelectItem value="members">Pick members</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {audience === "functions" ? (
            <div className="flex flex-wrap gap-1.5">
              {LC_FUNCTIONS.map((f) => (
                <button key={f} type="button" className={chip(fns.includes(f))} onClick={() => toggle(fns, setFns, f)}>
                  {f}
                </button>
              ))}
            </div>
          ) : null}
          {audience === "roles" ? (
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_ROLES.map((r) => (
                <button key={r} type="button" className={chip(roles.includes(r))} onClick={() => toggle(roles, setRoles, r)}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}
          {audience === "members" ? (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
              {targets.length === 0 ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : (
                targets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={chip(memberIds.includes(t.id))}
                    onClick={() => toggle(memberIds, setMemberIds, t.id)}
                  >
                    {t.label}
                  </button>
                ))
              )}
            </div>
          ) : null}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Also send as email</p>
              <p className="text-xs text-muted-foreground">BCC from the IM mailbox</p>
            </div>
            <Switch checked={alsoEmail} onCheckedChange={setAlsoEmail} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={
              pending || title.trim().length < 2 || body.trim().length < 2 ||
              (audience === "functions" && fns.length === 0) ||
              (audience === "roles" && roles.length === 0) ||
              (audience === "members" && memberIds.length === 0)
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
