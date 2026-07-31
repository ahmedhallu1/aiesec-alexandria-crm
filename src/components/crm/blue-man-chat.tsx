"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const OPENERS = [
  "Ahlan! I'm The Blue Man 🚶 — ask me about your accounts, your numbers, or anything AIESEC.",
  "The Blue Man has arrived 🚶💙 What are we raising today?",
  "I walk, therefore I am. Also I know your pipeline. Ask away 🚶",
];

const SUGGESTIONS = [
  "How am I doing this month?",
  "Which accounts need a next step?",
  "What is EXPA?",
  "How do deals & slots count?",
];

/** Very small markdown-ish renderer: **bold**, bullets, line breaks, and
 *  [label](url) links — internal ones render as tappable ACTION CHIPS (the
 *  Blue Man's smart actions), external ones as normal links. */
function renderLite(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line
      // the URL part tolerates ONE level of parentheses (slugs like
      // /accounts/abc-(egypt) survive) — matched non-greedily to the final )
      .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g)
      .map((chunk, j) => {
        if (chunk.startsWith("**") && chunk.endsWith("**")) {
          return <b key={j}>{chunk.slice(2, -2)}</b>;
        }
        const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/.exec(chunk);
        if (link) {
          const [, label, url] = link;
          // "/x" only — "//host" and "/\host" are protocol-relative EXTERNAL
          // urls in disguise (open-redirect vector via prompt injection)
          if (url.startsWith("/") && !/^\/[\\/]/.test(url)) {
            return (
              <Link
                key={j}
                href={url}
                className="mx-0.5 my-0.5 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {label} <ArrowUpRight className="size-3" />
              </Link>
            );
          }
          if (/^https?:\/\//.test(url)) {
            return (
              <a
                key={j}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-2"
              >
                {label}
              </a>
            );
          }
          return <span key={j}>{label}</span>;
        }
        return <span key={j}>{chunk}</span>;
      });
    const isBullet = /^\s*[-•*]\s+/.test(line);
    return (
      // dir="auto": each line's base direction follows its first strong
      // character, so Arabic reads RTL and English LTR — even mixed in one
      // reply — instead of one direction breaking the other
      <p key={i} dir="auto" className={cn("min-h-[1em] text-start", isBullet && "ps-3")}>
        {parts}
      </p>
    );
  });
}

export function BlueManChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [opener] = useState(() => OPENERS[Math.floor(Math.random() * OPENERS.length)]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // "Ask the Blue Man" callouts anywhere in the app open the chat via a
  // window event (optionally pre-filling a question)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill;
      setOpen(true);
      if (prefill) setInput(prefill);
    };
    window.addEventListener("sodio:ask-blue-man", onOpen);
    return () => window.removeEventListener("sodio:ask-blue-man", onOpen);
  }, []);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.text || data.error || "Something broke 🫠" },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network hiccup — the Blue Man lost signal 📶. Try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* floating walking-man button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="The Blue Man — Sodio's assistant"
        aria-label="Open The Blue Man assistant"
        className={cn(
          "fixed bottom-4 right-4 z-50 flex size-14 items-center justify-center rounded-full",
          "bg-primary shadow-lg shadow-primary/30 transition-transform duration-200",
          "hover:scale-110 hover:shadow-primary/50 active:scale-95",
          open && "scale-0 opacity-0"
        )}
      >
        <Image
          src="/brand/walk.png"
          alt="The Blue Man"
          width={40}
          height={40}
          unoptimized
          className="brightness-0 invert"
        />
      </button>

      {/* chat popup */}
      <div
        className={cn(
          "fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl transition-all duration-200",
          open
            ? "pointer-events-auto h-[min(32rem,calc(100dvh-6rem))] opacity-100"
            : "pointer-events-none h-0 opacity-0"
        )}
      >
        {/* header */}
        <div className="flex items-center gap-2.5 border-b bg-primary px-3 py-2.5 text-primary-foreground">
          <Image
            src="/brand/walk.png"
            alt=""
            width={28}
            height={28}
            unoptimized
            className="brightness-0 invert"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight">The Blue Man</p>
            <p className="text-[11px] leading-tight opacity-80">
              Sodio&apos;s assistant · knows your data + AIESEC
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* messages */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3 text-sm">
          <div dir="auto" className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-start">
            {opener}
          </div>
          {messages.length === 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-primary/30 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              dir="auto"
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-start",
                m.role === "user"
                  ? "ml-auto rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-tl-sm bg-muted"
              )}
            >
              {m.role === "assistant" ? renderLite(m.content) : m.content}
            </div>
          ))}
          {busy ? (
            <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> walking to the answer…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <form
          className="flex items-end gap-1.5 border-t p-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask The Blue Man…"
            className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" size="icon" className="size-9 shrink-0" disabled={busy || !input.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
