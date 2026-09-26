"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Inbox, Loader2, RefreshCw, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import { closeImPrompt, loadImPromptResults, type ImPromptResult } from "@/server/im-prompt-results";
import { ExportButton } from "./export-button";

const KIND_LABEL: Record<ImPromptResult["responseKind"], string> = {
  none: "Announcement",
  acknowledge: "Acknowledge",
  rating: "1–5 rating",
  text: "Written answer",
};

/**
 * THE ANSWERS TO "SAY SOMETHING TO THE LC" (v37.3) — every prompt sent, newest
 * first: how many it reached, answered, skipped and are still waiting on, the
 * ratings (average + spread) or the written answers, and a way to stop it.
 */
export function ImPromptResults() {
  const [data, setData] = useState<ImPromptResult[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [closing, startClose] = useTransition();

  const load = useCallback(
    () =>
      startLoad(async () => {
        try {
          const r = await loadImPromptResults();
          if (r.ok) {
            setData(r.data);
            setOpen((o) => o ?? r.data[0]?.id ?? null);
          } else toast.error(r.error);
        } catch {
          toast.error("Couldn't load the answers — try again.");
        }
      }),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const close = (p: ImPromptResult) =>
    startClose(async () => {
      const r = await closeImPrompt(p.id);
      if (r.ok) {
        toast.success(`Closed — taken off ${r.closed} screen${r.closed === 1 ? "" : "s"}.`);
        load();
      } else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Inbox className="size-4 text-primary" /> What the LC answered
          <span className="ml-auto flex items-center gap-2">
            <ExportButton kind="im_prompts" sheetsHint={["Prompts", "Answers"]} />
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          data.map((p) => {
            const isOpen = open === p.id;
            const pct = p.sent ? Math.round((p.answered / p.sent) * 100) : 0;
            const maxBar = Math.max(1, ...p.ratingCounts);
            return (
              <div key={p.id} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : p.id)}
                  className="flex w-full flex-wrap items-center gap-2 p-3 text-left hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold" dir="auto">{p.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(p.createdAt)} · {KIND_LABEL[p.responseKind]}
                      {p.createdBy ? ` · by ${p.createdBy}` : ""}
                    </span>
                  </span>
                  {p.avgRating != null ? (
                    <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      <Star className="size-3 fill-current" /> {p.avgRating}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{p.answered}/{p.sent} answered</Badge>
                  {!p.active ? <Badge variant="secondary">closed</Badge> : null}
                  {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>

                {isOpen ? (
                  <div className="space-y-3 border-t p-3">
                    {p.body ? <p className="whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">{p.body}</p> : null}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">Sent to {p.sent}</Badge>
                      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">{p.answered} answered ({pct}%)</Badge>
                      <Badge variant="outline">{p.skipped} skipped</Badge>
                      <Badge variant="outline">{p.waiting} still waiting</Badge>
                    </div>

                    {p.responseKind === "rating" && p.ratingCounts.some((n) => n > 0) ? (
                      <div className="grid gap-1">
                        {[5, 4, 3, 2, 1].map((star) => (
                          <div key={star} className="flex items-center gap-2 text-xs">
                            <span className="w-6 tabular-nums">{star}★</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-amber-500" style={{ width: `${(p.ratingCounts[star - 1] / maxBar) * 100}%` }} />
                            </div>
                            <span className="w-6 text-right tabular-nums">{p.ratingCounts[star - 1]}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {p.responses.length > 0 ? (
                      <ul className="grid max-h-80 gap-1 overflow-y-auto">
                        {p.responses.map((r, i) => (
                          <li key={i} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
                            <span className="font-medium" dir="auto">{r.name}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {r.role} · {fmtDateTime(r.at)}
                            </span>
                            <span className="ml-2">
                              {r.skipped ? (
                                <Badge variant="outline" className="text-[10px]">skipped</Badge>
                              ) : r.rating != null ? (
                                <span className="text-amber-600">{"★".repeat(r.rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - r.rating)}</span></span>
                              ) : r.acknowledged && !r.text ? (
                                <Badge variant="secondary" className="text-[10px]">acknowledged</Badge>
                              ) : null}
                            </span>
                            {r.text ? <p className="mt-0.5 whitespace-pre-wrap" dir="auto">{r.text}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No answers yet.</p>
                    )}

                    {p.waitingPeople.length > 0 ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          Still waiting on {p.waitingPeople.length}
                        </summary>
                        <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                          {p.waitingPeople.map((w) => w.name).join(", ")}
                        </p>
                      </details>
                    ) : null}

                    {p.active && p.waiting > 0 ? (
                      <Button variant="outline" size="sm" disabled={closing} onClick={() => close(p)}>
                        Close it — take it off the {p.waiting} screen{p.waiting === 1 ? "" : "s"} still waiting
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
