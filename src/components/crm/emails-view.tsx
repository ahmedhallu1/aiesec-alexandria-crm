"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bold, Italic, Link2, List, Loader2, Mail, Search, Send, Sparkles, X,
} from "lucide-react";
import { draftEmailWithAi, sendComposedEmail } from "@/server/actions";
import type { SentEmailRow } from "@/server/data";
import type { ComposeTemplate } from "@/lib/email/compose";
import { fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** THE LC'S LETTERS (v33.24).
 *
 *  Members have always written to partners, EPs and other entities — from
 *  Gmail, from a blank page, every time. So every letter looks different, half
 *  go out with no signature, and the LC has no idea who has already been
 *  contacted. This is the same act with the LC's clothes on: a starting point,
 *  a real signature built from the membership row, the Blue Man to help with
 *  the words, and a record of what went where.
 *
 *  It sends through the member's OWN Gmail — the reply comes back to them and
 *  it lands in their Sent folder. Sodio is the stationery, not the sender.
 */
export function EmailsView({
  sent, recents, templates, people,
}: {
  sent: SentEmailRow[];
  recents: string[];
  templates: ComposeTemplate[];
  people: { name: string; email: string; role: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const editor = useRef<HTMLDivElement>(null);

  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [template, setTemplate] = useState("blank");
  const [pickerQ, setPickerQ] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAsk, setAiAsk] = useState("");

  const matches = useMemo(() => {
    const q = pickerQ.trim().toLowerCase();
    if (!q) return [];
    const inLc = people
      .filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ label: `${p.name} · ${p.role}`, email: p.email }));
    const recent = recents
      .filter((a) => a.includes(q) && !inLc.some((m) => m.email === a))
      .slice(0, 4)
      .map((a) => ({ label: `${a} · written before`, email: a }));
    return [...inLc, ...recent];
  }, [pickerQ, people, recents]);

  const addAddress = (raw: string, list: "to" | "cc") => {
    const a = raw.trim().toLowerCase();
    if (!a) return;
    if (!EMAIL_RE.test(a)) {
      toast.error(`"${raw.trim()}" doesn't look like an email address.`);
      return;
    }
    const set = list === "to" ? setTo : setCc;
    set((cur) => (cur.includes(a) ? cur : [...cur, a]));
    setPickerQ("");
  };

  const applyTemplate = (key: string) => {
    setTemplate(key);
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    setSubject(t.subject);
    if (editor.current) editor.current.innerHTML = t.body;
  };

  /** The editor is a contentEditable — the same shape the expectation-mail
   *  review step uses, so the member sees exactly what will be sent. */
  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const submit = (draft: boolean) =>
    start(async () => {
      const body = editor.current?.innerHTML ?? "";
      const res = await sendComposedEmail({
        to, cc, subject, body, template, draft,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        draft
          ? "Saved as a draft in your Gmail ✍️"
          : `Sent to ${res.data?.to} ${res.data?.to === 1 ? "person" : "people"} 📨`
      );
      setTo([]); setCc([]); setSubject("");
      if (editor.current) editor.current.innerHTML = "<p>Hi,</p><p></p>";
      setTemplate("blank");
      router.refresh();
    });

  const askAi = () =>
    startAi(async () => {
      const res = await draftEmailWithAi({
        instruction: aiAsk,
        current: editor.current?.innerText?.trim() ? editor.current.innerHTML : null,
        subject,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (editor.current && res.data) editor.current.innerHTML = res.data.html;
      setAiAsk("");
      setAiOpen(false);
      toast.success("Drafted — read it before you send 👀");
    });

  const chip = (a: string, list: "to" | "cc") => (
    <span
      key={a}
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
    >
      {a}
      <button
        type="button"
        aria-label={`Remove ${a}`}
        onClick={() =>
          (list === "to" ? setTo : setCc)((cur) => cur.filter((x) => x !== a))
        }
        className="text-primary/60 hover:text-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );

  return (
    <div className="space-y-5">
      <div className="rise-in">
        <h1 className="text-2xl font-bold">Emails 📨</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Write to a partner, an EP or another LC — with the LC&apos;s look and
          your own signature. It goes out from <b>your</b> Gmail, so replies
          come back to you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="rise-in rise-in-1">
          <CardContent className="grid gap-3 pt-5">
            {/* ------------------------------------------------ recipients */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>To</Label>
                {!showCc ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCc(true)}
                  >
                    + Cc
                  </button>
                ) : null}
              </div>
              {to.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">{to.map((a) => chip(a, "to"))}</div>
              ) : null}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={pickerQ}
                  onChange={(e) => setPickerQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addAddress(pickerQ, "to");
                    }
                  }}
                  placeholder="Type a name from the LC, or any email address…"
                />
                {matches.length > 0 ? (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
                    {matches.map((m) => (
                      <button
                        key={m.email}
                        type="button"
                        onClick={() => addAddress(m.email, "to")}
                        className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
                      >
                        {m.label}
                        <span className="block text-xs text-muted-foreground">{m.email}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {recents.length > 0 && to.length === 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">Recent:</span>
                  {recents.slice(0, 5).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => addAddress(a, "to")}
                      className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                    >
                      {a}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {showCc ? (
              <div className="grid gap-1.5">
                <Label>Cc</Label>
                {cc.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">{cc.map((a) => chip(a, "cc"))}</div>
                ) : null}
                <Input
                  placeholder="Add an address and press Enter"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAddress((e.target as HTMLInputElement).value, "cc");
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label>Subject</Label>
              <Input
                dir="auto"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What it's about"
                maxLength={200}
              />
            </div>

            {/* ---------------------------------------------------- editor */}
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="mr-auto">The email</Label>
                <Button size="sm" variant="ghost" className="size-8 p-0" onClick={() => exec("bold")}>
                  <Bold className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="size-8 p-0" onClick={() => exec("italic")}>
                  <Italic className="size-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost" className="size-8 p-0"
                  onClick={() => exec("insertUnorderedList")}
                >
                  <List className="size-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost" className="size-8 p-0"
                  onClick={() => {
                    const url = window.prompt("Link to…", "https://");
                    if (url) exec("createLink", url);
                  }}
                >
                  <Link2 className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={aiOpen ? "default" : "outline"}
                  className="h-8"
                  onClick={() => setAiOpen((o) => !o)}
                >
                  <Sparkles className="size-3.5" /> Blue Man
                </Button>
              </div>

              {aiOpen ? (
                <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <Textarea
                    rows={2}
                    dir="auto"
                    value={aiAsk}
                    onChange={(e) => setAiAsk(e.target.value)}
                    placeholder="Write a first approach to a language school about hosting an IGV volunteer… — or: make what I wrote shorter and warmer"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      It rewrites what&apos;s in the editor if there is anything there. Always read it before sending.
                    </p>
                    <Button size="sm" disabled={aiPending || aiAsk.trim().length < 3} onClick={askAi}>
                      {aiPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      Write it
                    </Button>
                  </div>
                </div>
              ) : null}

              <div
                ref={editor}
                contentEditable
                suppressContentEditableWarning
                dir="auto"
                className="min-h-56 rounded-lg border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: "<p>Hi,</p><p></p>" }}
              />
              <p className="text-xs text-muted-foreground">
                Your signature — name, role, WhatsApp and the LC logo — is added
                automatically underneath.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={pending || to.length === 0 || subject.trim().length < 2}
                onClick={() => submit(true)}
              >
                Save as draft
              </Button>
              <Button
                disabled={pending || to.length === 0 || subject.trim().length < 2}
                onClick={() => submit(false)}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send it
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* --------------------------------------------------- side column */}
        <div className="grid gap-4">
          <Card className="rise-in rise-in-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Start from</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => applyTemplate(t.key)}
                  className={cn(
                    "rounded-lg border p-2.5 text-start transition-colors",
                    template === t.key ? "border-primary bg-primary/5" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.hint}</p>
                </button>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Placeholders like <code>{"{{name}}"}</code> and{" "}
                <code>{"{{company}}"}</code> are yours to replace.
              </p>
            </CardContent>
          </Card>

          <Card className="rise-in rise-in-3">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="size-4" /> What you&apos;ve sent
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {sent.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing yet — the first one is the hard one.
                </p>
              ) : (
                sent.slice(0, 12).map((e) => (
                  <div key={e.id} className="rounded-lg border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 break-words text-sm font-medium" dir="auto">
                        {e.subject}
                      </p>
                      {e.status === "draft" ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">Draft</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {e.to.join(", ")} · {fmtDateTime(e.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
