"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowRight, Lock, Search, Settings2, X } from "lucide-react";
import { saveMySetting } from "@/server/actions";
import {
  SECTION_META, searchSettings, visibleSettings,
  type MemberSettings, type SettingEntry, type SettingSection, type SettingsContext,
} from "@/lib/member-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** MY SETTINGS — one panel, searchable (v34.8).
 *
 *  Everything a member can change about their own Sodio was scattered: the
 *  phone on one card, the theme in the sidebar footer, the mobile list style
 *  in a control above the accounts table, and the email volume nowhere at all
 *  because there was no way to opt out of anything.
 *
 *  Two decisions worth stating:
 *
 *  · **Search is the interface.** A settings page long enough to be thorough
 *    is too long to scan, so the box is the first thing on it, it matches
 *    Arabic and English, and it searches the DESCRIPTIONS too — people look
 *    for "too many emails", not for "visit announcements".
 *
 *  · **Nothing is duplicated.** Where a control already exists (the phone,
 *    the password, the avatar, the function defaults), the row TAKES YOU
 *    THERE and highlights it, rather than building a second editor over the
 *    same field for the two to drift apart.
 */

const SECTION_ORDER: SettingSection[] = [
  "account", "email", "notifications", "appearance", "function", "help",
];

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

  const toggle = (key: keyof MemberSettings, next: boolean) => {
    // optimistic: the switch has to move under the finger, and a failed save
    // puts it back rather than leaving a lie on screen
    const before = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    setSaving(key);
    start(async () => {
      const res = await saveMySetting(key, next);
      setSaving(null);
      if (!res.ok) {
        setValues((v) => ({ ...v, [key]: before }));
        toast.error(res.error);
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
            placeholder="Search settings — “email”, “password”, “dark”, “اشعارات”…"
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
              <div className="flex items-baseline gap-2 pt-1">
                <h3 className="text-sm font-semibold">
                  <span aria-hidden>{meta.icon}</span> {meta.label}
                </h3>
                {!searching ? (
                  <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                ) : null}
              </div>
              <div className="divide-y rounded-lg border">
                {rows.map((e) => (
                  <SettingRow
                    key={e.id}
                    entry={e}
                    values={values}
                    saving={saving}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SettingRow({
  entry, values, saving, onToggle,
}: {
  entry: SettingEntry;
  values: MemberSettings;
  saving: string | null;
  onToggle: (k: keyof MemberSettings, v: boolean) => void;
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
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
      </div>
      <div className="shrink-0">
        {k.type === "toggle" ? (
          <Switch
            checked={values[k.key]}
            disabled={saving === k.key}
            onCheckedChange={(v) => onToggle(k.key, v)}
            aria-label={entry.label}
          />
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

/** Scroll to the card that really owns this field and flash it, so the jump
 *  lands somewhere the eye can find. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
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
