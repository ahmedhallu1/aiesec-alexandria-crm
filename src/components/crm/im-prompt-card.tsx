"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye, Megaphone, Send } from "lucide-react";
import { createImPrompt } from "@/server/prompts";
import { LC_FUNCTIONS, MEMBER_ROLES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ImPromptPreviewDialog } from "./im-prompt-preview";

/** SAY SOMETHING TO THE LC, AND OPTIONALLY HEAR BACK.
 *
 *  The IM director needs a way to put something in front of people the next
 *  time they open Sodio — a heads-up, a rule change, a question — without it
 *  being one more email nobody reads. It rides the same blocking prompt the
 *  attendance ladder uses, so it cannot be scrolled past.
 *
 *  Everything about it is the author's choice: who sees it, whether anything
 *  comes back (a rating, a sentence, or just "got it"), and whether it can be
 *  waved away at all. */
const RESPONSES = [
  { v: "none", label: "Nothing — just tell them" },
  { v: "acknowledge", label: "Make them confirm they've read it" },
  { v: "rating", label: "Ask for a 1–5 rating" },
  { v: "text", label: "Ask them to write something" },
] as const;

const AUDIENCES = [
  { v: "all", label: "Everyone in the LC" },
  { v: "function", label: "Certain functions" },
  { v: "role", label: "Certain roles" },
] as const;

export function ImPromptCard() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [responseKind, setResponseKind] = useState<(typeof RESPONSES)[number]["v"]>("none");
  const [responseLabel, setResponseLabel] = useState("");
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["v"]>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [dismissible, setDismissible] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [pending, start] = useTransition();

  const options: string[] =
    audience === "function" ? [...LC_FUNCTIONS] : audience === "role" ? [...MEMBER_ROLES] : [];

  const send = () =>
    start(async () => {
      const res = await createImPrompt({
        title, body, responseKind,
        responseLabel: responseLabel || null,
        audience,
        audienceValues: audience === "all" ? [] : picked,
        dismissible,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Sent to ${res.sentTo} ${res.sentTo === 1 ? "person" : "people"}.`);
      setTitle(""); setBody(""); setResponseLabel(""); setPicked([]);
      setResponseKind("none"); setAudience("all"); setDismissible(true);
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" /> Say something to the LC
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          They meet it the next time they open Sodio — as a dialog, not an email. Use it when
          something must actually land.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* ONE required field. Everything under it is optional — a heads-up is
            usually one sentence, and three boxes for one sentence is how a
            feature stops being used (v34.8). */}
        <div className="grid gap-1.5">
          <Label className="text-xs">What you want to say *</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. “Peak review is on Sunday”"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">
            More detail
            <span className="ml-1 font-normal text-muted-foreground">
              — optional, skip it if the line above says it all
            </span>
          </Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Anything they need beyond the headline…"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">Who sees it</Label>
          <Select value={audience} onValueChange={(v) => { setAudience(v as typeof audience); setPicked([]); }}>
            <SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUDIENCES.map((a) => (
                <SelectItem key={a.v} value={a.v}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {options.map((o) => {
                const on = picked.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== o) : [...p, o]))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      on ? "border-transparent bg-primary text-primary-foreground"
                         : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">What comes back</Label>
          <Select value={responseKind} onValueChange={(v) => setResponseKind(v as typeof responseKind)}>
            <SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESPONSES.map((r) => (
                <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {responseKind === "rating" || responseKind === "text" ? (
            <Input
              value={responseLabel}
              onChange={(e) => setResponseLabel(e.target.value)}
              placeholder={
                responseKind === "rating"
                  ? "Optional question above the stars — default: “How would you rate this?”"
                  : "Optional question above the box — default: “Your answer”"
              }
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <Label className="text-xs">
            They can skip it
            <span className="block font-normal text-muted-foreground">
              Off means it keeps coming back until they answer. Use sparingly.
            </span>
          </Label>
          <Switch checked={dismissible} onCheckedChange={setDismissible} />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setPreviewing(true)}
            disabled={title.trim().length < 2}
          >
            <Eye className="size-4" /> Preview
          </Button>
          <Button className="flex-1" onClick={send} disabled={pending || title.trim().length < 2}>
            <Send className="size-4" /> Send it
          </Button>
        </div>
      </CardContent>

      {/* SHOW ME HOW IT LOOKS (v34.9). The composer wrote a title, an optional
          body and picked a response kind blind — this renders the exact
          dialog an LC member meets, sharing the real Stars widget and the
          real fallback copy, so nothing here can drift from the real thing. */}
      <ImPromptPreviewDialog
        open={previewing}
        onOpenChange={setPreviewing}
        title={title}
        body={body}
        responseKind={responseKind}
        responseLabel={responseLabel}
        dismissible={dismissible}
      />
    </Card>
  );
}
