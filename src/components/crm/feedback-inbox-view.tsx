"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Check, Copy, Heart, Inbox, RotateCcw } from "lucide-react";
import { setFeedbackStatus, thankFeedback } from "@/server/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "./hint";

export interface FeedbackItem {
  id: string;
  type: string;
  /** the type-dependent pick-list value (v21) — null on older rows */
  category?: string | null;
  message: string;
  page: string | null;
  status: string;
  anonymous: boolean;
  created_at: string;
  member: { name: string; email: string } | null;
}

const FILTERS = [
  { key: "new", label: "🆕 New" },
  { key: "done", label: "✅ Done" },
  { key: "archived", label: "🗄️ Archived" },
  { key: "all", label: "All" },
] as const;

export function FeedbackInboxView({ items }: { items: FeedbackItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("new");
  const [thankTarget, setThankTarget] = useState<FeedbackItem | null>(null);
  const [pending, start] = useTransition();

  const visible = items.filter((f) =>
    filter === "all" ? true : (f.status || "new") === filter
  );

  const setStatus = (id: string, status: "new" | "done" | "archived", label: string) =>
    start(async () => {
      const res = await setFeedbackStatus(id, status);
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else toast.error(res.error);
    });

  const thank = () => {
    if (!thankTarget) return;
    start(async () => {
      const res = await thankFeedback(thankTarget.id);
      if (res.ok) {
        toast.success("💙 Thank-you sent — bell notification + email");
        setThankTarget(null);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const copyEmail = async (email: string) => {
    await navigator.clipboard.writeText(email);
    toast.success(`${email} copied — go say something nice`);
  };

  return (
    <div className="space-y-4">
      {/* status filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground hover:border-primary/50"
            )}
          >
            {f.label}
            <span className="ml-1 opacity-70">
              {items.filter((i) => (f.key === "all" ? true : (i.status || "new") === f.key)).length}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Inbox className="size-8" />
            <p className="text-sm">
              {filter === "new"
                ? "Inbox zero! Either Sodio is perfect or everyone's on a visit 🏃"
                : "Nothing here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        visible.map((f) => {
          const who = f.anonymous
            ? "Anonymous 🎭"
            : f.member?.name || "Unknown";
          return (
            <Card key={f.id} className="py-0">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={f.type === "Bug" ? "destructive" : "outline"}>
                    {f.type === "Bug" ? "🐞 Bug" : f.type === "Enhancement" ? "✨ Enhancement" : "💬 Other"}
                  </Badge>
                  {f.category ? (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {f.category}
                    </Badge>
                  ) : null}
                  <span className="text-sm font-semibold">{who}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                  {(f.status || "new") !== "new" ? (
                    <Badge
                      className={cn(
                        "border-transparent text-[10px]",
                        f.status === "done"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {f.status}
                    </Badge>
                  ) : null}
                </div>

                <p dir="auto" className="whitespace-pre-wrap text-start text-sm">{f.message}</p>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {!f.anonymous && f.member ? (
                    <>
                      <Hint label="Applied their feedback? Send a thank-you (bell notification + email)">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-gv hover:text-gv"
                          disabled={pending}
                          onClick={() => setThankTarget(f)}
                        >
                          <Heart className="size-3.5" /> Thank
                        </Button>
                      </Hint>
                      <Hint label="Copy their email to write them directly">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => copyEmail(f.member!.email)}
                        >
                          <Copy className="size-3.5" /> Copy email
                        </Button>
                      </Hint>
                    </>
                  ) : null}
                  {(f.status || "new") !== "done" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-success hover:text-success"
                      disabled={pending}
                      onClick={() => setStatus(f.id, "done", "Marked done ✅")}
                    >
                      <Check className="size-3.5" /> Done
                    </Button>
                  ) : null}
                  {(f.status || "new") !== "archived" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setStatus(f.id, "archived", "Archived 🗄️")}
                    >
                      <Archive className="size-3.5" /> Archive
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setStatus(f.id, "new", "Back to New")}
                    >
                      <RotateCcw className="size-3.5" /> Restore
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* thank-you confirmation */}
      <Dialog open={!!thankTarget} onOpenChange={(o) => !o && setThankTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>💙 Send the thank-you?</DialogTitle>
            <DialogDescription>
              <b>{thankTarget?.member?.name}</b> gets a
              bell notification next time they open Sodio AND a branded email —
              telling them their feedback was applied.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setThankTarget(null)}>
              Not yet
            </Button>
            <Button onClick={thank} disabled={pending}>
              {pending ? "Sending…" : "Yes, thank them"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
