"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bold, Eye, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2,
  Mail, Paperclip, Quote, RotateCcw, Search, Send, Sparkles, Type, Underline,
  Users2, X, MailPlus } from "lucide-react";
import {
  draftEmailWithAi, previewComposedEmail, sendComposedEmail,
} from "@/server/actions";
import type { SentEmailRow } from "@/server/data";
import type { ComposeTemplate, LayoutOption } from "@/lib/email/compose";
import { fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "./hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const DRAFT_KEY = "sodio-email-draft";
const MAX_ATTACH = 3_200_000; // Vercel's action body cap, minus the frame

interface Attachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  size: number;
}

/** THE LC'S LETTERS (v33.24, expanded v33.25).
 *
 *  A half-written email must survive a trip to another tab — losing it is why
 *  people go back to Gmail. Everything below (recipients, subject, layout and
 *  the body itself) is mirrored into localStorage on every keystroke and
 *  restored on mount.
 */
export function EmailsView({
  sent, recents, templates, layouts, images, people, groups,
  showExpectation = false,
}: {
  sent: SentEmailRow[];
  recents: string[];
  templates: ComposeTemplate[];
  /** the Expectation-mail button (v33.37) — the old sidebar tab, now a door
   *  inside this one; gated exactly like /ogt-mail itself */
  showExpectation?: boolean;
  layouts: LayoutOption[];
  images: { key: string; label: string; url: string; width: number }[];
  people: { name: string; email: string; role: string }[];
  /** whole teams an email can be addressed to (v33.27) */
  groups: { key: string; label: string; emails: string[] }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [template, setTemplate] = useState("blank");
  const [layout, setLayout] = useState("branded");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pickerQ, setPickerQ] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAsk, setAiAsk] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  /* ---------------------------------------------- keep the half-written one */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setTo(d.to ?? []); setCc(d.cc ?? []); setBcc(d.bcc ?? []);
        setSubject(d.subject ?? ""); setLayout(d.layout ?? "branded");
        setTemplate(d.template ?? "blank");
        if (d.cc?.length) setShowCc(true);
        if (d.bcc?.length) setShowBcc(true);
        if (editor.current && d.body) editor.current.innerHTML = d.body;
      }
    } catch {
      /* a corrupt draft is not worth an error message */
    }
    setRestored(true);
  }, []);

  const save = () => {
    if (!restored) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          to, cc, bcc, subject, layout, template,
          body: editor.current?.innerHTML ?? "",
        })
      );
    } catch {
      /* private mode — the draft just won't survive the trip */
    }
  };
  useEffect(save, [to, cc, bcc, subject, layout, template, restored]); // eslint-disable-line react-hooks/exhaustive-deps

  /** THE SAME PICKER ON EVERY LINE (v33.26). To had name-completion from the
   *  membership and Cc/Bcc were bare text boxes, so copying a teammate meant
   *  remembering their address — which is exactly what this tab exists to
   *  stop. One matcher, three fields. */
  const suggest = (q: string, already: string[]) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const inLc = people
      .filter(
        (p) =>
          !already.includes(p.email) &&
          (p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle))
      )
      .slice(0, 6)
      .map((p) => ({ label: `${p.name} · ${p.role}`, email: p.email }));
    const recent = recents
      .filter((a) => a.includes(needle) && !already.includes(a) && !inLc.some((m) => m.email === a))
      .slice(0, 4)
      .map((a) => ({ label: `${a} · written before`, email: a }));
    return [...inLc, ...recent];
  };
  const matches = useMemo(
    () => suggest(pickerQ, to),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickerQ, people, recents, to]
  );
  const [ccQ, setCcQ] = useState("");
  const [bccQ, setBccQ] = useState("");

  const setList = (list: "to" | "cc" | "bcc") =>
    list === "to" ? setTo : list === "cc" ? setCc : setBcc;

  const addAddress = (raw: string, list: "to" | "cc" | "bcc") => {
    const a = raw.trim().toLowerCase().replace(/[,;]$/, "");
    if (!a) return;
    if (!EMAIL_RE.test(a)) {
      toast.error(`"${raw.trim()}" doesn't look like an email address.`);
      return;
    }
    setList(list)((cur) => (cur.includes(a) ? cur : [...cur, a]));
    if (list === "to") setPickerQ("");
  };

  const applyTemplate = (key: string) => {
    setTemplate(key);
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    setSubject(t.subject);
    if (editor.current) editor.current.innerHTML = t.body;
    // a template can CARRY its CC (v33.37 — the contract mail always copies
    // customer support): merged in, never replacing what's already there
    if (t.cc && t.cc.length > 0) {
      setCc((prev) => [...new Set([...prev, ...t.cc!])]);
      setShowCc(true);
    }
    save();
  };

  /** The editor is a contentEditable — what you type is what is sent. */
  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(cmd, false, value);
    save();
  };

  const insertHtml = (html: string) => {
    editor.current?.focus();
    document.execCommand("insertHTML", false, html);
    save();
  };

  const resetAll = () => {
    if (!window.confirm("Clear this email and start again?")) return;
    setTo([]); setCc([]); setBcc([]); setSubject(""); setTemplate("blank");
    setLayout("branded"); setAttachments([]); setAiAsk(""); setPickerQ("");
    if (editor.current) editor.current.innerHTML = "<p>Hi,</p><p></p>";
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    toast.success("Cleared — fresh page.");
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Attachment[] = [...attachments];
    for (const f of Array.from(files).slice(0, 8)) {
      const buf = await f.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      next.push({ name: f.name, mimeType: f.type || "application/octet-stream", dataBase64: b64, size: f.size });
    }
    const total = next.reduce((n, a) => n + a.size, 0);
    if (total > MAX_ATTACH) {
      toast.error("That's over ~3 MB in total — send the big ones as a link instead.");
      return;
    }
    setAttachments(next);
  };

  const submit = (draft: boolean) =>
    start(async () => {
      const res = await sendComposedEmail({
        to, cc, bcc, subject,
        body: editor.current?.innerHTML ?? "",
        template, layout: layout as "branded",
        attachments: attachments.map(({ name, mimeType, dataBase64 }) => ({
          name, mimeType, dataBase64,
        })),
        draft,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data?.draft
          ? attachments.length > 0
            ? "In your Gmail drafts with the files attached — send it from there ✍️"
            : "Saved as a draft in your Gmail ✍️"
          : `Sent to ${res.data?.to} ${res.data?.to === 1 ? "person" : "people"} 📨`
      );
      setTo([]); setCc([]); setBcc([]); setSubject(""); setAttachments([]);
      if (editor.current) editor.current.innerHTML = "<p>Hi,</p><p></p>";
      setTemplate("blank");
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      router.refresh();
    });

  const showPreview = () =>
    start(async () => {
      const res = await previewComposedEmail({
        body: editor.current?.innerHTML ?? "",
        layout,
      });
      if (!res.ok) toast.error(res.error);
      else setPreview(res.data!.html);
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
      save();
      setAiAsk("");
      setAiOpen(false);
      toast.success("Drafted — read it before you send 👀");
    });

  const chip = (a: string, list: "to" | "cc" | "bcc") => (
    <span
      key={`${list}-${a}`}
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
    >
      {a}
      <button
        type="button"
        aria-label={`Remove ${a}`}
        onClick={() => setList(list)((cur) => cur.filter((x) => x !== a))}
        className="text-primary/60 hover:text-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );

  const tool = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Hint label={label}>
      <Button size="sm" variant="ghost" className="size-8 p-0" onClick={onClick}>
        {icon}
      </Button>
    </Hint>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">Emails 📨</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Write to a partner, an EP or another LC — with the LC&apos;s look and
            your own signature. It goes out from <b>your</b> Gmail, so replies
            come back to you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showExpectation ? (
            <Button variant="outline" size="sm" asChild>
              <Link prefetch={false} href="/ogt-mail">
                <MailPlus className="size-4" /> Expectation mail
              </Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <RotateCcw className="size-4" /> Start again
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="rise-in rise-in-1">
          <CardContent className="grid gap-3 pt-5">
            {/* ------------------------------------------------ recipients */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>To</Label>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {!showCc ? (
                    <button type="button" className="hover:text-foreground" onClick={() => setShowCc(true)}>
                      + Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button type="button" className="hover:text-foreground" onClick={() => setShowBcc(true)}>
                      + Bcc
                    </button>
                  ) : null}
                </div>
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
                    if (e.key === "Enter" || e.key === "," || e.key === ";") {
                      e.preventDefault();
                      addAddress(pickerQ, "to");
                    }
                  }}
                  onBlur={() => { if (pickerQ.includes("@")) addAddress(pickerQ, "to"); }}
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
              {/* WHOLE TEAMS, NOT SIX LOOKUPS (v33.27). Addressing the EB or
                  your own team by hand is how someone gets left off. The
                  groups come from the membership, so they can't go stale —
                  and they expand into real addresses you can still edit. */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-xs text-muted-foreground">Send to a team:</span>
                {groups.slice(0, 6).map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => {
                      setTo((cur) => [...new Set([...cur, ...g.emails])]);
                      toast.success(`${g.label} — ${g.emails.length} added`);
                    }}
                    className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                  >
                    <Users2 className="mr-0.5 inline size-3" />
                    {g.label} ({g.emails.length})
                  </button>
                ))}
                {groups.length > 6 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
                        More teams…
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                      {groups.slice(6).map((g) => (
                        <DropdownMenuItem
                          key={g.key}
                          onClick={() => {
                            setTo((cur) => [...new Set([...cur, ...g.emails])]);
                            toast.success(`${g.label} — ${g.emails.length} added`);
                          }}
                        >
                          {g.label} ({g.emails.length})
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
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

            {(["cc", "bcc"] as const).map((list) => {
              const shown = list === "cc" ? showCc : showBcc;
              if (!shown) return null;
              const values = list === "cc" ? cc : bcc;
              const q = list === "cc" ? ccQ : bccQ;
              const setQ = list === "cc" ? setCcQ : setBccQ;
              const hits = suggest(q, values);
              return (
                <div key={list} className="grid gap-1.5">
                  <Label>{list === "cc" ? "Cc" : "Bcc"}</Label>
                  {values.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {values.map((a) => chip(a, list))}
                    </div>
                  ) : null}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "," || e.key === ";") {
                          e.preventDefault();
                          addAddress(q, list);
                          setQ("");
                        }
                      }}
                      onBlur={() => { if (q.includes("@")) { addAddress(q, list); setQ(""); } }}
                      placeholder="A name from the LC, or any email address…"
                    />
                    {hits.length > 0 ? (
                      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
                        {hits.map((m) => (
                          <button
                            key={m.email}
                            type="button"
                            onClick={() => { addAddress(m.email, list); setQ(""); }}
                            className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
                          >
                            {m.label}
                            <span className="block text-xs text-muted-foreground">{m.email}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {list === "bcc" ? (
                    <p className="text-xs text-muted-foreground">
                      Bcc recipients can&apos;t see each other, and nobody in To
                      or Cc sees them at all.
                    </p>
                  ) : null}
                </div>
              );
            })}

            <div className="grid gap-1.5">
              <Label>Subject</Label>
              <Input
                dir="auto"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What it's about"
                maxLength={200}
                spellCheck
              />
            </div>

            {/* ---------------------------------------------------- editor */}
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <Label className="mr-auto">The email</Label>
                {/* A SELECT WHOSE VALUE MATCHES NO ITEM RENDERS BLANK — which
                    is why this looked like an empty box (v33.26). Text size is
                    an ACTION, not a stored value, so it is a menu. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs">
                      <Type className="size-3.5" /> Size
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {[
                      { v: "2", label: "Small", cls: "text-xs" },
                      { v: "3", label: "Normal", cls: "text-sm" },
                      { v: "5", label: "Large", cls: "text-lg" },
                      { v: "6", label: "Heading", cls: "text-xl font-bold" },
                    ].map((o) => (
                      <DropdownMenuItem
                        key={o.v}
                        className={o.cls}
                        onClick={() => exec("fontSize", o.v)}
                      >
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {tool("Bold the selected text", <Bold className="size-3.5" />, () => exec("bold"))}
                {tool("Italic", <Italic className="size-3.5" />, () => exec("italic"))}
                {tool("Underline", <Underline className="size-3.5" />, () => exec("underline"))}
                {tool("Bulleted list", <List className="size-3.5" />, () => exec("insertUnorderedList"))}
                {tool("Numbered list", <ListOrdered className="size-3.5" />, () => exec("insertOrderedList"))}
                {tool("Quote", <Quote className="size-3.5" />, () =>
                  insertHtml(
                    '<blockquote style="margin:12px 0;padding:8px 16px;border-left:3px solid #037EF3;background:#f2f7fd;color:#41526b;">Quoted text</blockquote>'
                  )
                )}
                {tool("Link the selected text", <Link2 className="size-3.5" />, () => {
                  const url = window.prompt("Link to…", "https://");
                  if (url) exec("createLink", url);
                })}
                {tool("Insert an AIESEC logo", <ImageIcon className="size-3.5" />, () => setImagesOpen(true))}
                <Button
                  size="sm"
                  variant={aiOpen ? "default" : "outline"}
                  className="h-8"
                  onClick={() => setAiOpen((o) => !o)}
                >
                  <Sparkles className="size-3.5" /> Violet Man
                </Button>
              </div>

              {aiOpen ? (
                <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <Textarea
                    rows={2}
                    dir="auto"
                    spellCheck
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
                spellCheck
                dir="auto"
                onInput={save}
                onBlur={save}
                className="min-h-56 rounded-lg border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_a]:text-primary [&_a]:underline [&_blockquote]:my-3 [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: "<p>Hi,</p><p></p>" }}
              />
              <p className="text-xs text-muted-foreground">
                Your signature — name, role, WhatsApp and the LC logo — is added
                automatically underneath. Spelling is checked as you type.
              </p>
            </div>

            {/* ------------------------------------------------ attachments */}
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                  <Paperclip className="size-3.5" /> Attach
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
                />
                {attachments.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Emails with files are left in your Gmail drafts — send them from there.
                  </span>
                ) : null}
              </div>
              {attachments.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <span
                      key={a.name}
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                    >
                      📎 {a.name} · {Math.round(a.size / 1024)} KB
                      <button
                        type="button"
                        aria-label={`Remove ${a.name}`}
                        onClick={() => setAttachments((cur) => cur.filter((x) => x.name !== a.name))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={showPreview}>
                <Eye className="size-4" /> Preview
              </Button>
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
              <CardTitle className="text-base">How it looks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5">
              {layouts.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLayout(l.key)}
                  className={cn(
                    "rounded-lg border p-2.5 text-start transition-colors",
                    layout === l.key ? "border-primary bg-primary/5" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">{l.label}</p>
                  <p className="text-xs text-muted-foreground">{l.hint}</p>
                </button>
              ))}
            </CardContent>
          </Card>

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

      {/* ----------------------------------------------------- the preview */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Exactly what they&apos;ll get</DialogTitle>
          </DialogHeader>
          <iframe
            title="Email preview"
            srcDoc={preview ?? ""}
            sandbox=""
            className="h-[70vh] w-full border-0 bg-white"
          />
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------- the AIESEC logo drawer */}
      <Dialog open={imagesOpen} onOpenChange={setImagesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Drop a logo into the letter</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {images.map((img) => (
              <button
                key={img.key}
                type="button"
                onClick={() => {
                  insertHtml(
                    `<p><img src="${img.url}" alt="${img.label}" width="${img.width}" style="max-width:100%;height:auto;"></p>`
                  );
                  setImagesOpen(false);
                }}
                className="flex items-center gap-3 rounded-lg border p-2 text-start hover:bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-8 w-auto" />
                <span className="text-sm">{img.label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
