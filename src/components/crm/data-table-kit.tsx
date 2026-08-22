"use client";

/**
 * THE UNIVERSAL TABLE KIT (v31) — one contract for EVERY data table in Sodio.
 *
 * They came from Google Sheets: a table has to be theirs — reorder the
 * columns, hide the noise, add back what they need, choose how many rows to
 * see. This file is the single place that behaviour lives, so a new table gets
 * it in three lines instead of reinventing it.
 *
 * THE CONTRACT — a table wires all three of these:
 *
 *   1. COLUMNS   `const cols = useTableColumns("accounts", ACCOUNT_COLUMNS)`
 *      → `cols.visible` is the ordered, visible column list. Render the header
 *        from it and the cells from it, in the SAME order:
 *
 *          <TableHeader><TableRow>
 *            {cols.visible.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
 *          </TableRow></TableHeader>
 *          …
 *          {cols.visible.map((c) => <TableCell key={c.key}>{cell(row, c.key)}</TableCell>)}
 *
 *      → drop `<TableSettings columns={cols} />` in the toolbar for the
 *        ⚙ Columns dialog (drag-to-reorder + ↑/↓ + show/hide + reset).
 *      → preferences persist per browser under `elevate-table:<tableId>`.
 *        A stale/corrupt key SELF-HEALS: unknown keys are dropped, columns
 *        added in a later release appear (at their defined position, honouring
 *        `defaultHidden`), `required` columns can never be hidden.
 *      → the tableId should carry whatever changes the column SET (view,
 *        function…), e.g. `signups:unassigned:OGV` — different lists, different
 *        preferences.
 *
 *   2. SORTING   client-side lists use the re-exported `useTableSort` +
 *      `SortHeader` (see ./sort-header). Server-sorted lists (accounts,
 *      sign-ups) keep their own URL-param header button — same affordance.
 *
 *   3. PAGE SIZE `<PageSizePicker value={pageSize} options={…} onChange={…} />`
 *      — server-paginated lists push the number into their URL param, in-memory
 *      lists just slice.
 *
 * NOTHING here is a permission: column preferences are cosmetic and live in the
 * browser. What a member may READ is decided server-side, as always.
 */

import { useEffect, useState } from "react";
import {
  Check, ChevronDown, ChevronUp, Filter, GripVertical, RotateCcw, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "./hint";
import { SortHeader, useTableSort } from "./sort-header";
import { TableHead } from "@/components/ui/table";

// one import gives a table everything it needs
export { SortHeader, useTableSort };
export type { SortAccessor, SortDir } from "./sort-header";

/** One column a table CAN show. `required` columns are always visible (the
 *  identity column, the row's own actions); `defaultHidden` ones ship off and
 *  are one checkbox away. */
export interface TableColumn {
  key: string;
  label: string;
  required?: boolean;
  defaultHidden?: boolean;
}

/** What `useTableColumns` hands back — pass the whole object to TableSettings. */
export interface TableColumnsApi {
  /** ordered + visible — the render list */
  visible: TableColumn[];
  /** ordered, hidden included — the settings list */
  ordered: TableColumn[];
  hiddenKeys: string[];
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  /** nudge one column one slot up (-1) or down (1) — keyboard/touch reorder */
  move: (key: string, dir: -1 | 1) => void;
  /** drop `key` at `index` of the ordered list — drag & drop */
  moveTo: (key: string, index: number) => void;
  reset: () => void;
  /** hand-set column widths, and the setters behind the drag handle (v33.11) */
  widths: Record<string, number>;
  setWidth: (key: string, px: number) => void;
  clearWidth: (key: string) => void;
  /** the member changed something (enables "Reset to default") */
  dirty: boolean;
}

interface Prefs {
  order: string[];
  hidden: string[];
  /** hand-set column widths in px, by key (v33.11). Absent = size to content,
   *  which is the right default — a member only touches the one column whose
   *  width is actually in their way. */
  widths?: Record<string, number>;
}

const KEY_PREFIX = "elevate-table:";

function defaults(all: TableColumn[]): Prefs {
  return {
    order: all.map((c) => c.key),
    hidden: all.filter((c) => c.defaultHidden && !c.required).map((c) => c.key),
  };
}

/** Merge what's stored with what the code defines TODAY. Never throws:
 *  columns that no longer exist are dropped, columns that didn't exist when
 *  the member last touched the dialog are inserted at their defined position
 *  (hidden if that's their default), required columns are forced visible. */
function reconcile(stored: Prefs, all: TableColumn[]): Prefs {
  const known = new Set(all.map((c) => c.key));
  const order = stored.order.filter((k, i) => known.has(k) && stored.order.indexOf(k) === i);
  const placed = new Set(order);
  all.forEach((c, i) => {
    if (placed.has(c.key)) return;
    order.splice(Math.min(i, order.length), 0, c.key); // new column, near home
    placed.add(c.key);
  });
  const knewAbout = new Set(stored.order);
  const hidden = new Set(stored.hidden.filter((k) => known.has(k) && knewAbout.has(k)));
  for (const c of all) {
    if (!knewAbout.has(c.key) && c.defaultHidden) hidden.add(c.key);
    if (c.required) hidden.delete(c.key);
  }
  return { order, hidden: [...hidden] };
}

function parse(raw: string): Prefs | null {
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return null;
    const { order, hidden } = p as { order?: unknown; hidden?: unknown };
    if (!Array.isArray(order) || !order.every((x) => typeof x === "string")) return null;
    if (!Array.isArray(hidden) || !hidden.every((x) => typeof x === "string")) return null;
    return { order: order as string[], hidden: hidden as string[] };
  } catch {
    return null;
  }
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Per-table column preferences (order + visibility), persisted per browser.
 * SSR-safe: the first render is always the DEFAULT set, the stored preference
 * lands in an effect (same pattern as the sidebar's "Arrange tabs").
 */
export function useTableColumns(tableId: string, all: TableColumn[]): TableColumnsApi {
  const storageKey = `${KEY_PREFIX}${tableId}`;
  // the id travels WITH the prefs: switching table (a different view, a
  // different function) must never render the previous table's layout
  const [state, setState] = useState<{ id: string; prefs: Prefs } | null>(null);
  const stored = state && state.id === tableId ? state.prefs : null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${KEY_PREFIX}${tableId}`);
      if (!raw) return;
      const parsed = parse(raw);
      if (parsed) setState({ id: tableId, prefs: parsed });
      else localStorage.removeItem(`${KEY_PREFIX}${tableId}`); // self-heal
    } catch {
      /* private mode / poisoned key — defaults are fine */
    }
  }, [tableId]);

  const base = defaults(all);
  const prefs = stored ? reconcile(stored, all) : base;
  const byKey = new Map(all.map((c) => [c.key, c]));
  const hiddenSet = new Set(prefs.hidden);
  const ordered = prefs.order
    .map((k) => byKey.get(k))
    .filter((c): c is TableColumn => !!c);
  const visible = ordered.filter((c) => !hiddenSet.has(c.key));

  const write = (next: Prefs) => {
    setState({ id: tableId, prefs: next });
    try {
      localStorage.setItem(storageKey, JSON.stringify({ v: 1, ...next }));
    } catch {
      /* private mode — the choice just won't survive the tab */
    }
  };

  /** MIN/MAX so a column can never be dragged to nothing or off the screen. */
  const MIN_W = 60;
  const MAX_W = 640;
  const setWidth = (key: string, px: number) =>
    write({
      ...prefs,
      widths: {
        ...(prefs.widths ?? {}),
        [key]: Math.round(Math.max(MIN_W, Math.min(MAX_W, px))),
      },
    });
  const clearWidth = (key: string) => {
    const widths = { ...(prefs.widths ?? {}) };
    delete widths[key];
    write({ ...prefs, widths });
  };

  const toggle = (key: string) => {
    const col = byKey.get(key);
    if (!col || col.required) return;
    const hidden = new Set(prefs.hidden);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    write({ ...prefs, hidden: [...hidden] });
  };

  const moveTo = (key: string, index: number) => {
    const from = prefs.order.indexOf(key);
    const to = Math.max(0, Math.min(prefs.order.length - 1, index));
    if (from < 0 || from === to) return;
    const order = [...prefs.order];
    order.splice(from, 1);
    order.splice(to, 0, key);
    write({ ...prefs, order });
  };

  const move = (key: string, dir: -1 | 1) => moveTo(key, prefs.order.indexOf(key) + dir);

  const reset = () => {
    setState(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* noop */
    }
  };

  const dirty =
    !!stored &&
    (!same(prefs.order, base.order) ||
      !same([...prefs.hidden].sort(), [...base.hidden].sort()));

  return {
    visible,
    widths: prefs.widths ?? {},
    setWidth,
    clearWidth,
    ordered,
    hiddenKeys: [...hiddenSet],
    isVisible: (key) => !hiddenSet.has(key),
    toggle,
    move,
    moveTo,
    reset,
    dirty,
  };
}

/** Square checkbox — the accounts list's SelectDot, at settings size. */
function CheckBox({
  checked, disabled, onToggle, label,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:border-primary/60",
        disabled && "opacity-50"
      )}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </button>
  );
}

/**
 * The ⚙ Columns control: drag a column to reorder it (or use ↑/↓ — touch and
 * keyboard friendly), tick to show/hide, one button back to default.
 */
export function TableSettings({
  columns, className, buttonLabel = "Columns", title = "Columns",
}: {
  columns: TableColumnsApi;
  className?: string;
  buttonLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const hiddenCount = columns.ordered.length - columns.visible.length;

  const drop = (key: string, index: number) => {
    if (key && key !== columns.ordered[index]?.key) columns.moveTo(key, index);
    setDragKey(null);
    setOverKey(null);
  };

  return (
    <>
      <Hint label="Your table, your way — reorder the columns, hide the ones you don't use, bring back the ones you do">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9", className)}
          onClick={() => setOpen(true)}
        >
          <Settings2 className="size-4" /> {buttonLabel}
          {hiddenCount > 0 ? (
            <Badge variant="secondary" className="ml-0.5 px-1.5 text-[10px]">
              {columns.visible.length}/{columns.ordered.length}
            </Badge>
          ) : null}
        </Button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>⚙ {title}</DialogTitle>
            <DialogDescription>
              Drag a row (or use ↑ ↓) to reorder the columns, untick the ones
              you don&apos;t need. Saved in this browser, just for you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            {columns.ordered.map((c, i) => {
              const visible = columns.isVisible(c.key);
              return (
                <div
                  key={c.key}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(c.key);
                    e.dataTransfer.effectAllowed = "move";
                    try {
                      e.dataTransfer.setData("text/plain", c.key);
                    } catch {
                      /* some browsers refuse — the state carries it */
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overKey !== c.key) setOverKey(c.key);
                  }}
                  onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    let key = dragKey;
                    if (!key) {
                      try {
                        key = e.dataTransfer.getData("text/plain") || null;
                      } catch {
                        key = null;
                      }
                    }
                    if (key) drop(key, i);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 transition-colors",
                    dragKey === c.key && "opacity-50",
                    overKey === c.key && dragKey !== c.key && "border-primary bg-primary/5"
                  )}
                >
                  <GripVertical
                    aria-hidden
                    className="size-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
                  />
                  <CheckBox
                    checked={visible}
                    disabled={!!c.required}
                    onToggle={() => columns.toggle(c.key)}
                    label={`${visible ? "Hide" : "Show"} ${c.label}`}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      !visible && "text-muted-foreground"
                    )}
                  >
                    {c.label || <span className="text-muted-foreground">(actions)</span>}
                    {c.required ? (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        always on
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Move ${c.label} left`}
                      disabled={i === 0}
                      onClick={() => columns.move(c.key, -1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Move ${c.label} right`}
                      disabled={i === columns.ordered.length - 1}
                      onClick={() => columns.move(c.key, 1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!columns.dirty}
              onClick={columns.reset}
            >
              <RotateCcw className="size-3.5" /> Reset to default
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rows-per-page select — the accounts list's original idiom, now everyone's. */
export function PageSizePicker({
  value, options, onChange, className, label = "Rows per page",
}: {
  value: number;
  options: number[];
  onChange: (size: number) => void;
  className?: string;
  label?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger
        className={cn("h-7 w-auto min-w-16 text-xs", className)}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} / page
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================================ column filters

/** Splits a multi-select filter value ("IGV,IGT") into its picks. One place,
 *  because the client filters and the server queries must agree exactly on
 *  what a filter value MEANS — a mismatch shows the wrong rows silently. */
export function multi(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export interface ColumnFilterOption {
  value: string;
  label: string;
}

/**
 * The FILTER BUTTON that lives next to a column's name — the Google Sheets
 * affordance (v32.3).
 *
 * The rule this encodes: **if an attribute is a column, you filter it from the
 * column.** A chip bar above the table for things the eye can already see is
 * duplicated UI — you read "Status" in the header, so that is where you narrow
 * it. The filter bar keeps only what ISN'T a column: free-text search, date
 * ranges, and cross-cutting toggles like Archived.
 *
 * Deliberately dumb: it owns no state and knows nothing about URLs. The table
 * passes the current value and gets a new one back, so a server-paginated list
 * pushes it into a URL param and an in-memory list filters locally — same
 * component either way.
 */
/** THE MOBILE TWIN OF `ColumnFilter` (v33.50 — moved here from accounts-view,
 *  where it was private and every other list had to go without).
 *
 *  A funnel icon lives on a column HEADER and says which column it filters by
 *  sitting on it. A phone shows cards, not headers, so the same filter has to
 *  carry its own name: this renders a labelled chip ("Industry", "Industry:
 *  Software", "Industry: 3") with the identical multi-select menu underneath.
 *  Wrap a row of them in `<div className="contents md:hidden">` next to the
 *  desktop table and the two stay in sync — one URL param, two affordances. */
export function FilterSelect({
  value, placeholder, options, onChange,
}: {
  value: string;
  placeholder: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const picked = multi(value);
  const labelOf = (v: string) => options.find(([ov]) => ov === v)?.[1] ?? v;
  const summary =
    picked.length === 0
      ? placeholder
      : picked.length === 1
        ? `${placeholder}: ${labelOf(picked[0])}`
        : `${placeholder}: ${picked.length}`;
  const toggle = (v: string) =>
    onChange((picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v]).join(","));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 w-auto min-w-28 justify-between font-normal", picked.length > 0 && "border-primary/60")}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={picked.length === 0}
          onCheckedChange={() => onChange("")}
        >
          {placeholder}: all
        </DropdownMenuCheckboxItem>
        {options.map(([v, label]) => (
          <DropdownMenuCheckboxItem
            key={v}
            checked={picked.includes(v)}
            onCheckedChange={() => toggle(v)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="truncate" dir="auto">{label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A DATE COLUMN FILTERS BY RANGE (v34.7).
 *
 *  Every other column got its funnel in v33.3 — "if it is a column, you filter
 *  it from the column" — but the date columns were left out, because a date is
 *  not a pick-list. The funnel opens a from → to pair instead, which is what
 *  anyone looking at a date column actually wants.
 *
 *  Both ends are optional: from alone is "since", to alone is "until". */
export function DateRangeFilter({
  label,
  from,
  to,
  onChange,
  max,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  /** clamp — accounts cannot be created in the future, calls can */
  max?: string;
}) {
  const active = !!from || !!to;
  const summary = from && to ? `${from} → ${to}` : from ? `since ${from}` : to ? `until ${to}` : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${label}: ${summary} — change` : `Filter by ${label}`}
          title={active ? `${label}: ${summary}` : `Filter by ${label}`}
          className={cn(
            "relative inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
          )}
        >
          <Filter className={cn("size-3", active && "fill-current")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-2">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 px-1 text-xs">
          <span>{label}</span>
          {active ? (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onChange({ from: "", to: "" })}
            >
              Clear
            </button>
          ) : null}
        </DropdownMenuLabel>
        {/* the menu must not close on the first click INSIDE a date input —
            Radix treats it as a selection otherwise */}
        <div className="grid gap-2 px-1 pb-1" onKeyDown={(e) => e.stopPropagation()}>
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              max={to || max}
              onChange={(e) => onChange({ from: e.target.value, to })}
              onSelect={(e) => e.stopPropagation()}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={max}
              onChange={(e) => onChange({ from, to: e.target.value })}
              onSelect={(e) => e.stopPropagation()}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ColumnFilter({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  /** the column's name, for the accessible label and the empty state */
  label: string;
  /** "" = no filter. Several picks are comma-joined ("IGV,IGT") — see `multi` */
  value: string;
  options: ColumnFilterOption[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  const picked = multi(value);
  const active = picked.length > 0;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const summary = active
    ? picked.length === 1
      ? labelOf(picked[0])
      : `${picked.length} selected`
    : "";

  // MULTI-SELECT (v33.3): ticking adds, unticking removes, and the menu stays
  // open so several picks are one visit instead of one-per-trip. Order is
  // preserved so the URL is stable and shareable.
  const toggle = (v: string) =>
    onChange(
      (picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v]).join(",")
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${label}: ${summary} — change filter` : `Filter by ${label}`}
          title={active ? `${label}: ${picked.map(labelOf).join(", ")}` : `Filter by ${label}`}
          className={cn(
            "relative inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
          )}
        >
          <Filter className={cn("size-3", active && "fill-current")} />
          {picked.length > 1 ? (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground ring-1 ring-background">
              {picked.length}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 text-xs">
          <span>{label}</span>
          {active ? (
            <button
              type="button"
              className="text-[11px] font-medium text-primary hover:underline"
              onClick={() => onChange("")}
            >
              Clear
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={!active} onCheckedChange={() => onChange("")}>
          {allLabel}
        </DropdownMenuCheckboxItem>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={picked.includes(o.value)}
            onCheckedChange={() => toggle(o.value)}
            onSelect={(e) => e.preventDefault()} // keep the menu open for the next pick
          >
            <span className="truncate" dir="auto">{o.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** RESIZABLE COLUMNS — THE GENERAL RULE (v33.14).
 *
 *  Every table built on `useTableColumns` gets this, not a chosen few: drag
 *  the right edge of any header, double-click to reset. Widths live beside
 *  order and visibility, per table per browser.
 *
 *  IT SHRINKS PAST THE CONTENT on purpose. The first version could only grow
 *  a column, because `width` under `table-layout: auto` is a suggestion the
 *  browser overrides to fit the longest cell. `<ResizableHead>` pins the width
 *  with min/max AND truncates the cell, so a column of long company names can
 *  be squeezed to nothing useful if that is what you want on screen — the full
 *  text is still there on hover and in the row.
 *
 *  The drag writes to the DOM and commits on release: a React state update per
 *  pointermove would re-render the whole table on every pixel.
 */
export function ColumnResizer({
  onCommit,
  onReset,
  current,
}: {
  onCommit: (px: number) => void;
  onReset: () => void;
  current?: number;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      title="Drag to resize · double-click to reset"
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const th = (e.target as HTMLElement).closest("th") as HTMLElement | null;
        if (!th) return;
        const startX = e.clientX;
        const startW = current ?? th.getBoundingClientRect().width;
        let next = startW;
        const setW = (px: number) => {
          th.style.width = `${px}px`;
          th.style.minWidth = `${px}px`;
          th.style.maxWidth = `${px}px`;
        };
        const move = (ev: PointerEvent) => {
          next = Math.max(48, Math.min(900, startW + (ev.clientX - startX)));
          setW(next);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          onCommit(next);
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className="absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none select-none md:block hover:bg-primary/40"
    />
  );
}

/** A header cell that carries the width and the handle — the one thing every
 *  table needs in order to be resizable. Wrap your <TableHead> content in it
 *  (or use it INSTEAD of TableHead) and pass the columns api. */
export function ResizableHead({
  colKey,
  cols,
  className,
  children,
}: {
  colKey: string;
  cols: TableColumnsApi;
  className?: string;
  children: React.ReactNode;
}) {
  const w = cols.widths[colKey];
  return (
    <TableHead
      className={cn("relative", w && "overflow-hidden", className)}
      style={
        w ? { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` } : undefined
      }
    >
      <span className={cn("block", w && "truncate")}>{children}</span>
      <ColumnResizer
        current={w}
        onCommit={(px) => cols.setWidth(colKey, px)}
        onReset={() => cols.clearWidth(colKey)}
      />
    </TableHead>
  );
}

/** The matching body cell: honours a hand-set width by truncating rather than
 *  forcing the column back open. */
export function resizableCellStyle(
  cols: TableColumnsApi,
  colKey: string
): { className: string; style?: React.CSSProperties } {
  const w = cols.widths[colKey];
  return w
    ? {
        className: "truncate",
        style: { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` },
      }
    : { className: "" };
}

/** A column header that carries BOTH affordances: click the name to sort,
 *  click the funnel to filter. Used by the server-paginated lists, which sort
 *  through URL params rather than `useTableSort`. */
export function FilterableHead({
  children,
  className,
  filter,
}: {
  /** usually the sort button the table already renders */
  children: React.ReactNode;
  className?: string;
  /** omit for a column that can be sorted but not filtered */
  filter?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="min-w-0">{children}</span>
      {filter}
    </div>
  );
}
