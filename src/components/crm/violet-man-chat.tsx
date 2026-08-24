"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, GripVertical, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WalkingMan } from "./walking-man";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** A saved conversation — localStorage, per user, the 8 most recent. */
interface StoredChat {
  id: string;
  title: string;
  messages: Msg[];
  at: number; // last-activity timestamp (ms)
}

const MAX_CHATS = 8;
/** Deliberately still "blueman": renaming the key would orphan every saved
 *  conversation on every member's device. Same call the LC made in v32.1,
 *  when the Elevate rename kept the sodio-* keys. Invisible to users. */
const storageKey = (email: string) => `sodio-blueman-chats:${email}`;

const OPENERS = [
  "Ahlan! I'm The Violet Man 🚶 — ask me about your accounts, your numbers, or anything AIESEC.",
  "The Violet Man has arrived 🚶💜 What are we raising today?",
  "I walk, therefore I am. Also I know your pipeline. Ask away 🚶",
];

/** Role + live-module aware question chips for a fresh chat (max 3, the
 *  viewer's PRIMARY module first: raising > signups > consideration > tm). */
function suggestionsFor(
  role: string,
  modules: { raising: boolean; signups: boolean; consideration: boolean; tm: boolean }
): string[] {
  const leader = role === "LCP" || role === "LCVP" || role === "Director";
  const out: string[] = [];
  if (modules.raising) {
    if (leader) {
      out.push(
        "How is my function's funnel this month?",
        "Who are my top performers?",
        "Which accounts are stuck after a visit?"
      );
    } else if (role === "Team Leader") {
      out.push(
        "How is my team doing this month?",
        "Which of my accounts are waiting for a next step?",
        "Give me my accounts I haven't contacted in 2 weeks"
      );
    } else {
      out.push(
        "Which of my accounts are waiting for a next step?",
        "Give me my accounts I haven't contacted in 2 weeks",
        "How do I record a deal with split opens?"
      );
    }
  }
  if (modules.signups) {
    out.push("How many unassigned sign-ups are waiting?", "What does Approved mean exactly?");
  }
  if (modules.consideration) {
    out.push("Find CVs with C# in their skills", "How do I record an IR call?");
  }
  if (modules.tm) {
    out.push("Who are the most active members this month?");
  }
  if (out.length === 0) {
    // no live module yet — keep the generic AIESEC ice-breakers
    out.push("What is EXPA?", "How do deals & slots count?", "What can you help me with?");
  }
  return out.slice(0, 3);
}

function isMsg(x: unknown): x is Msg {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

function chatTitle(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim() || "New chat";
  return first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
}

/** Read + validate the saved chats; a corrupt key self-heals (removed). */
function loadChats(key: string): StoredChat[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const chats: StoredChat[] = [];
    for (const c of parsed) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      if (typeof o.id !== "string" || !Array.isArray(o.messages)) continue;
      const messages = (o.messages as unknown[]).filter(isMsg);
      if (messages.length === 0) continue;
      chats.push({
        id: o.id,
        title: typeof o.title === "string" && o.title ? o.title : chatTitle(messages),
        messages,
        at: typeof o.at === "number" ? o.at : 0,
      });
    }
    return chats.sort((a, b) => b.at - a.at).slice(0, MAX_CHATS);
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
    return [];
  }
}

function saveChats(key: string, chats: StoredChat[]) {
  try {
    localStorage.setItem(key, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* private mode / quota — chats just won't persist */
  }
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Very small markdown-ish renderer: **bold**, bullets, line breaks, and
 *  [label](url) links — internal ones render as tappable ACTION CHIPS (the
 *  Violet Man's smart actions), external ones as normal links. */
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
              <Link prefetch={false}
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

export function VioletManChat({
  userEmail,
  role,
  modules,
}: {
  userEmail: string;
  role: string;
  modules: { raising: boolean; signups: boolean; consideration: boolean; tm: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [opener] = useState(() => OPENERS[Math.floor(Math.random() * OPENERS.length)]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // persistent chats (v26): the active chat auto-saves after every exchange
  const key = storageKey(userEmail);
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeId, setActiveId] = useState<string>(() => newId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatsRef = useRef<StoredChat[]>([]);

  // restore on mount: open with the most recent chat loaded (or fresh)
  useEffect(() => {
    const loaded = loadChats(key);
    chatsRef.current = loaded;
    setChats(loaded);
    if (loaded.length > 0) {
      setActiveId(loaded[0].id);
      setMessages(loaded[0].messages);
    }
  }, [key]);

  const updateChats = (fn: (prev: StoredChat[]) => StoredChat[]) => {
    const next = fn(chatsRef.current).slice(0, MAX_CHATS);
    chatsRef.current = next;
    setChats(next);
    saveChats(key, next);
  };

  /** Upsert the active chat with the given messages (most recent first). */
  const persist = (msgs: Msg[]) => {
    if (msgs.length === 0) return;
    const entry: StoredChat = { id: activeId, title: chatTitle(msgs), messages: msgs, at: Date.now() };
    updateChats((prev) => [entry, ...prev.filter((c) => c.id !== activeId)]);
  };

  const startNewChat = () => {
    if (busy) return; // the in-flight exchange belongs to the current chat
    setHistoryOpen(false);
    if (messages.length === 0) return; // already fresh (and already saved)
    setActiveId(newId());
    setMessages([]);
  };

  const openChat = (c: StoredChat) => {
    if (busy) return;
    setActiveId(c.id);
    setMessages(c.messages);
    setHistoryOpen(false);
  };

  const deleteChat = (id: string) => {
    if (busy) return;
    updateChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) {
      setActiveId(newId());
      setMessages([]);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // "Ask the Violet Man" callouts anywhere in the app open the chat via a
  // window event (optionally pre-filling a question into the CURRENT chat)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill;
      setOpen(true);
      if (prefill) setInput(prefill);
    };
    window.addEventListener("sodio:ask-violet-man", onOpen);
    return () => window.removeEventListener("sodio:ask-violet-man", onOpen);
  }, []);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    persist(next);
    setInput("");
    setBusy(true);
    let reply: Msg;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      reply = { role: "assistant", content: data.text || data.error || "Something broke 🫠" };
    } catch {
      reply = { role: "assistant", content: "Network hiccup — the Violet Man lost signal 📶. Try again." };
    }
    const done = [...next, reply];
    setMessages(done);
    persist(done);
    setBusy(false);
  };

  const suggestions = suggestionsFor(role, modules);

  // THE PANEL MOVES (v33.21). It parks over the bottom-right corner — which is
  // where a table's last rows and the bulk-action bar live — so reading the
  // answer meant closing the thing that gave it. Grab it by the dots.
  //
  // Moved by writing `style.translate` straight to the node, like the dialogs:
  // no state, no re-render per pointermove, nothing for the open/close
  // transition to fight. Desktop only — on a phone the panel IS the screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const panelAt = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragPanel = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    if (!window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) return;
    const box = el.getBoundingClientRect();
    const base = { ...panelAt.current };
    const startX = e.clientX;
    const startY = e.clientY;
    const M = 8; // never let it leave the viewport
    const loX = base.x - Math.max(0, box.left - M);
    const hiX = base.x + Math.max(0, window.innerWidth - box.right - M);
    const loY = base.y - Math.max(0, box.top - M);
    const hiY = base.y + Math.max(0, window.innerHeight - box.bottom - M);
    el.style.transition = "none";
    document.body.style.userSelect = "none";
    setDragging(true);
    const move = (ev: PointerEvent) => {
      panelAt.current = {
        x: Math.min(hiX, Math.max(loX, base.x + ev.clientX - startX)),
        y: Math.min(hiY, Math.max(loY, base.y + ev.clientY - startY)),
      };
      el.style.translate = `${panelAt.current.x}px ${panelAt.current.y}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.style.transition = "";
      document.body.style.userSelect = "";
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <>
      {/* floating walking-man button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="The Violet Man — Sodio's assistant"
        aria-label="Open The Violet Man assistant"
        className={cn(
          "fixed bottom-4 right-4 z-50 flex size-14 items-center justify-center rounded-full",
          "bg-primary shadow-lg shadow-primary/30 transition-transform duration-200",
          "hover:scale-110 hover:shadow-primary/50 active:scale-95",
          open && "scale-0 opacity-0"
        )}
      >
        {/* the FIGURE is 30px tall here; passing 40 to the raw image drew a
            person barely half that, adrift in its own transparent canvas */}
        <WalkingMan height={30} tone="white" alt="The Violet Man" />
      </button>

      {/* chat popup */}
      <div
        ref={panelRef}
        className={cn(
          "fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl transition-all duration-200",
          open
            ? "pointer-events-auto h-[min(32rem,calc(100dvh-6rem))] opacity-100"
            : "pointer-events-none h-0 opacity-0"
        )}
      >
        {/* header */}
        <div className="flex items-center gap-2.5 border-b bg-primary px-3 py-2.5 text-primary-foreground">
          {/* the grip is the ONLY drag origin — the same rule as the test-view
              chip, so a press meant for the header never moves the panel */}
          <div
            aria-hidden
            onPointerDown={dragPanel}
            title="Drag to move"
            className={cn(
              "-ml-1 hidden size-7 shrink-0 touch-none place-items-center rounded-md text-primary-foreground/60 transition-colors hover:bg-white/15 hover:text-primary-foreground md:grid",
              dragging ? "cursor-grabbing" : "cursor-grab"
            )}
          >
            <GripVertical className="size-4" />
          </div>
          <WalkingMan height={26} tone="white" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight">The Violet Man</p>
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

        {/* chat switcher row */}
        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2 py-1">
          <button
            type="button"
            onClick={() => setHistoryOpen((h) => !h)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              historyOpen && "bg-muted text-foreground"
            )}
          >
            🕘 History{chats.length > 0 ? ` (${chats.length})` : ""}
          </button>
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            ＋ New chat
          </button>
        </div>

        {/* recent chats list */}
        {historyOpen ? (
          <div className="max-h-44 shrink-0 overflow-y-auto border-b bg-muted/20 p-1.5">
            {chats.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No saved chats yet — they save automatically as you talk.
              </p>
            ) : (
              chats.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2 py-1",
                    c.id === activeId ? "bg-primary/10" : "hover:bg-muted/60"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openChat(c)}
                    disabled={busy}
                    className="min-w-0 flex-1 text-start disabled:opacity-50"
                  >
                    <span dir="auto" className="block truncate text-xs font-medium">
                      {c.title}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">{relTime(c.at)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete chat: ${c.title}`}
                    title="Delete chat"
                    onClick={() => deleteChat(c.id)}
                    disabled={busy}
                    className="shrink-0 rounded p-1 text-xs opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {/* messages */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3 text-sm">
          <div dir="auto" className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-start">
            {opener}
          </div>
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

        {/* suggested questions — fresh chats only, right above the input */}
        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-primary/30 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

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
            placeholder="Ask The Violet Man…"
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
