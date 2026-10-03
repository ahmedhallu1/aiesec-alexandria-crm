"use client";

import { Fragment, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowRight, Bell, Lock, Mail, Search, Settings2, X } from "lucide-react";
import { saveMyNotifyPref } from "@/server/actions";
import {
  NOTIFY_GROUP_LABEL, NOTIFY_TOPICS, SECTION_META, searchSettings, visibleSettings, wants,
  type MemberSettings, type NotifyChannel, type NotifyTopic, type SettingEntry,
  type SettingSection, type SettingsContext,
} from "@/lib/member-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PushToggle } from "@/components/crm/push-toggle";
import { cn } from "@/lib/utils";

/** MY SETTINGS — one page, searchable (v34.8; its own page since v36.2).
 *
 *  Everything a member can change about their own Sodio was scattered: the
 *  phone on one card, the theme in the sidebar footer, the mobile list style
 *  in a control above the accounts table — and the email volume nowhere.
 *
 *  Three decisions worth stating:
 *
 *  · **Search is the interface.** A settings page long enough to be thorough
 *    is too long to scan, so the box is the first thing on it, it matches
 *    Arabic and English, and it searches the DESCRIPTIONS too — people look
 *    for "too many emails", not for "visit announcements".
 *
 *  · **Every message is a row with two switches** (v36.2): Email and App. Any
 *    of the four combinations is a valid answer, and the two "all" buttons
 *    are there for the person who simply wants quiet.
 *
 *  · **Nothing is duplicated.** Where a control already exists (the phone,
 *    the password, the avatar, the function defaults), the row TAKES YOU
 *    THERE and highlights it, rather than building a second editor over the
 *    same field for the two to drift apart.
 */

const SECTION_ORDER: SettingSection[] = [
  "notifications", "account", "appearance", "function", "help",
];

const CHANNEL_LABEL: Record<NotifyChannel, string> = { email: "Email", bell: "App" };

type OnNotify = (topic: NotifyTopic | "all", channel: NotifyChannel, next: boolean) => void;

export function SettingsPanel({
  settings, context,
}: {
  settings: MemberSettings;
  context: SettingsContext;
}) {
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<MemberSettings>(settings);
  const [saving, setSaving] = useState<string | null>(null);
  const [, start] = useTransition();

  const entries = useMemo(() => visibleSettings(context), [context]);
  const hits = useMemo(() => searchSettings(entries, query), [entries, query]);
  const searching = query.trim().length > 0;

  const grouped = useMemo(() => {
    const m = new Map<SettingSection, SettingEntry[]>();
    for (const e of hits) m.set(e.section, [...(m.get(e.section) ?? []), e]);
    return m;
  }, [hits]);

  // the topics this person can actually receive — what the "all" buttons count
  const myTopics = useMemo(
    () => entries.flatMap((e) => (e.kind.type === "notify" ? [e.kind.topic] : [])),
    [entries]
  );

  const setNotify: OnNotify = (topic, channel, next) => {
    // optimistic: the switch has to move under the finger, and a failed save
    // puts it back rather than leaving a lie on screen
    const before = values;
    setValues((v) => {
      const notify = { ...v.notify };
      for (const t of NOTIFY_TOPICS) {
        const hit = topic === "all" ? t.channels.includes(channel) : t.id === topic;
        if (hit) notify[t.id] = { ...notify[t.id], [channel]: next };
      }
      return { ...v, notify };
    });
    setSaving(`${topic}:${channel}`);
    start(async () => {
      const res = await saveMyNotifyPref(topic, channel, next);
      setSaving(null);
      if (!res.ok) {
        // (v37.8) put back ONLY the switches this call moved — restoring the
        // whole snapshot also undid other switches flipped while it was in
        // flight (they had saved fine)
        setValues((v) => {
          const notify = { ...v.notify };
          for (const t of NOTIFY_TOPICS) {
            const hit = topic === "all" ? t.channels.includes(channel) : t.id === topic;
            if (hit) notify[t.id] = { ...notify[t.id], [channel]: before.notify[t.id]?.[channel] };
          }
          return { ...v, notify };
        });
        toast.error(res.error);
      } else if (topic === "all") {
        const what = channel === "email" ? "email" : "app notification";
        toast.success(next ? `Every ${what} is on.` : `Every ${what} is off.`);
      }
    });
  };

  return (
    <Card id="profile-settings" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="size-4 text-primary" /> Settings
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Everything that is yours to change. Switches save as you flip them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings — “visit emails”, “password”, “dark”, “اشعارات”…"
            className="pl-9 pr-9"
            aria-label="Search settings"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {searching && hits.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            Nothing matches “{query}”. If it&apos;s your name, role, function or team,
            those come from the Membership sheet — the IM team changes those.
          </p>
        ) : null}

        {SECTION_ORDER.map((section) => {
          const rows = grouped.get(section);
          if (!rows || rows.length === 0) return null;
          const meta = SECTION_META[section];
          return (
            <div key={section} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2 pt-1">
                <h3 className="text-sm font-semibold">
                  <span aria-hidden>{meta.icon}</span> {meta.label}
                </h3>
                {!searching ? (
                  <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                ) : null}
              </div>
              {section === "notifications" && !searching && myTopics.length > 0 ? (
                <AllSwitches values={values} topics={myTopics} saving={saving} onNotify={setNotify} />
              ) : null}
              <div className="divide-y rounded-lg border">
                {rows.map((e, i) => (
                  <Fragment key={e.id}>
                    {e.group && e.group !== rows[i - 1]?.group ? (
                      <p className="bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {NOTIFY_GROUP_LABEL[e.group]}
                      </p>
                    ) : null}
                    <SettingRow entry={e} values={values} saving={saving} onNotify={setNotify} />
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** "Everything off" in two taps, for the person who just wants quiet — and a
 *  count, so it is obvious what the switches below add up to. */
function AllSwitches({
  values, topics, saving, onNotify,
}: {
  values: MemberSettings;
  topics: NotifyTopic[];
  saving: string | null;
  onNotify: OnNotify;
}) {
  const busy = saving?.startsWith("all:") ?? false;
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {(["email", "bell"] as const).map((c) => {
        const offered = topics.filter((t) => NOTIFY_TOPICS.find((m) => m.id === t)?.channels.includes(c));
        const on = offered.filter((t) => wants(values, t, c)).length;
        return (
          <div key={c} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
            {c === "email" ? <Mail className="size-3.5" /> : <Bell className="size-3.5" />}
            <span className="text-muted-foreground">
              {CHANNEL_LABEL[c]}: <span className="font-medium text-foreground">{on}</span> of {offered.length} on
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={busy || on === offered.length}
              onClick={() => onNotify("all", c, true)}
            >
              All on
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={busy || on === 0}
              onClick={() => onNotify("all", c, false)}
            >
              All off
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function SettingRow({
  entry, values, saving, onNotify,
}: {
  entry: SettingEntry;
  values: MemberSettings;
  saving: string | null;
  onNotify: OnNotify;
}) {
  const k = entry.kind;
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {entry.label}
          {k.type === "localChoice" || k.type === "theme" ? (
            <Badge variant="outline" className="text-[10px] font-normal">
              this browser
            </Badge>
          ) : null}
          {k.type === "push" ? (
            <Badge variant="outline" className="text-[10px] font-normal">
              this device
            </Badge>
          ) : null}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
      </div>
      <div className="shrink-0">
        {k.type === "notify" ? (
          <NotifySwitches
            topic={k.topic}
            label={entry.label}
            values={values}
            saving={saving}
            onNotify={onNotify}
          />
        ) : k.type === "push" ? (
          <PushToggle label={entry.label} />
        ) : k.type === "theme" ? (
          <ThemePicker />
        ) : k.type === "localChoice" ? (
          <LocalChoice
            storageKey={k.storageKey}
            options={k.options}
            fallback={k.fallback}
            label={entry.label}
          />
        ) : k.type === "jump" ? (
          <Button variant="outline" size="sm" onClick={() => jumpTo(k.target)}>
            {k.cta} <ArrowRight className="size-3.5" />
          </Button>
        ) : k.type === "external" ? (
          <Button variant="outline" size="sm" asChild>
            <a href={k.href}>{k.cta} <ArrowRight className="size-3.5" /></a>
          </Button>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            title={k.reason}
          >
            <Lock className="size-3" /> Always on
          </span>
        )}
      </div>
    </div>
  );
}

/** The two switches of one topic. A channel the topic never sends on shows a
 *  dash instead of a switch — a switch that does nothing is worse than none. */
function NotifySwitches({
  topic, label, values, saving, onNotify,
}: {
  topic: NotifyTopic;
  label: string;
  values: MemberSettings;
  saving: string | null;
  onNotify: OnNotify;
}) {
  const channels = NOTIFY_TOPICS.find((t) => t.id === topic)?.channels ?? [];
  const busyAll = saving?.startsWith("all:") ?? false;
  return (
    <div className="flex items-center gap-4">
      {(["email", "bell"] as const).map((c) =>
        channels.includes(c) ? (
          <label key={c} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            {c === "email" ? <Mail className="size-3.5" /> : <Bell className="size-3.5" />}
            {CHANNEL_LABEL[c]}
            <Switch
              checked={wants(values, topic, c)}
              disabled={busyAll || saving === `${topic}:${c}`}
              onCheckedChange={(v) => onNotify(topic, c, v)}
              aria-label={`${label} — ${c === "email" ? "email" : "app notification"}`}
            />
          </label>
        ) : (
          <span
            key={c}
            className="inline-flex w-[76px] justify-center text-xs text-muted-foreground/50"
            title={`Sodio never sends this one by ${c === "email" ? "email" : "app notification"}`}
          >
            —
          </span>
        )
      )}
    </div>
  );
}

/** Scroll to the card that really owns this field and flash it, so the jump
 *  lands somewhere the eye can find. Those cards live on the profile, so from
 *  the settings page the jump is a navigation to the same anchor. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    window.location.href = `/profile#${id}`;
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-xl");
  window.setTimeout(
    () => el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-xl"),
    2200
  );
}

const emptySubscribe = () => () => {};

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  // true after hydration only — next-themes has no idea what the real theme
  // is on the server, so rendering its value before mount is a guaranteed
  // mismatch. Same `useSyncExternalStore` trick the sidebar toggle uses.
  const ready = useSyncExternalStore(emptySubscribe, () => true, () => false);
  return (
    <Select value={ready ? theme ?? "system" : "system"} onValueChange={setTheme}>
      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="system">Follow device</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** A preference that lives in THIS browser, read from the SAME key the
 *  feature itself reads — so the panel and the control it mirrors can never
 *  disagree. localStorage is an external store, so it is subscribed to rather
 *  than copied into state: a change made in the accounts view (or another
 *  tab) shows up here without a reload. */
function useLocalPref(storageKey: string, fallback: string): [string, (v: string) => void] {
  const subscribe = (onChange: () => void) => {
    const handler = (e: StorageEvent) => {
      if (e.key === null || e.key === storageKey) onChange();
    };
    window.addEventListener("storage", handler);
    window.addEventListener(LOCAL_PREF_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(LOCAL_PREF_EVENT, onChange);
    };
  };
  const read = () => {
    try {
      return localStorage.getItem(storageKey) ?? fallback;
    } catch {
      return fallback; // private mode — the fallback is the honest answer
    }
  };
  // the server has no localStorage, so it renders the fallback and hydration
  // corrects it; anything else is a mismatch
  const value = useSyncExternalStore(subscribe, read, () => fallback);

  const set = (v: string) => {
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      toast.error("This browser won't let Sodio remember that.");
      return;
    }
    // `storage` only fires in OTHER tabs, so this tab tells itself
    window.dispatchEvent(new Event(LOCAL_PREF_EVENT));
    toast.success("Saved for this browser.");
  };
  return [value, set];
}

const LOCAL_PREF_EVENT = "sodio:local-pref";

function LocalChoice({
  storageKey, options, fallback, label,
}: {
  storageKey: string;
  options: { value: string; label: string }[];
  fallback: string;
  label: string;
}) {
  const [raw, set] = useLocalPref(storageKey, fallback);
  // a key holding something the list doesn't offer must not blank the control
  const value = options.some((o) => o.value === raw) ? raw : fallback;

  return (
    <Select value={value} onValueChange={set}>
      <SelectTrigger className={cn("h-8 w-32")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
