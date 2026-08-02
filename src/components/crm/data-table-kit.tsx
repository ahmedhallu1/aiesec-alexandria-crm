"use client";

/**
 * THE UNIVERSAL TABLE KIT (v31) — one contract for EVERY data table in Elevate.
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
import { Check, ChevronDown, ChevronUp, GripVertical, RotateCcw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Hint } from "./hint";
import { SortHeader, useTableSort } from "./sort-header";

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
  /** the member changed something (enables "Reset to default") */
  dirty: boolean;
}

interface Prefs {
  order: string[];
  hidden: string[];
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

  const toggle = (key: string) => {
    const col = byKey.get(key);
    if (!col || col.required) return;
    const hidden = new Set(prefs.hidden);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    write({ order: prefs.order, hidden: [...hidden] });
  };

  const moveTo = (key: string, index: number) => {
    const from = prefs.order.indexOf(key);
    const to = Math.max(0, Math.min(prefs.order.length - 1, index));
    if (from < 0 || from === to) return;
    const order = [...prefs.order];
    order.splice(from, 1);
    order.splice(to, 0, key);
    write({ order, hidden: prefs.hidden });
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
