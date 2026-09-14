"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ClipboardPaste, Copy, Eraser, EyeOff, MoreHorizontal, PaintBucket, Plus, Settings2, Trash2,
} from "lucide-react";
import {
  COLUMN_TYPES, cellText, columnKey, fmtDay, parseTsv, sanitizeCell, toTsv,
  type ActivationRow, type CellValue, type Column, type ColumnType,
} from "@/lib/activation/model";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * THE SHEET — editing the bid plan the way the LC edited it in Google Sheets:
 * click a cell and type, Enter/Tab to move on, arrows to walk, paste a whole
 * block straight out of Sheets. Every commit saves on its own; nothing waits
 * for a Save button.
 *
 * BULK EDITING (v36.8), the Sheets gestures people already have in their
 * hands: drag across cells (or Shift+click, Shift+arrows) to select a RANGE;
 * Delete clears it, ⌘/Ctrl+D fills down, ⌘/Ctrl+R fills right, ⌘/Ctrl+C copies
 * it as a block, and pasting ONE value into a range fills every cell. A bar
 * above the grid does the same with buttons, plus "Set all to…". Tick rows
 * on the left to delete many at once (with Undo). A range is saved as ONE
 * request, and every cell is still checked against its column.
 */

const TYPE_LABEL: Record<ColumnType, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  date: "Date",
  select: "Pick-list",
  checkbox: "Checkbox",
};
const TYPING = new Set<ColumnType>(["text", "longtext", "number"]);

type Update = { rowId: string; patch: Record<string, CellValue> };

interface Props {
  columns: Column[];
  rows: ActivationRow[];
  onCommit: (rowId: string, key: string, value: CellValue) => void;
  /** many cells in one save — a range cleared, filled or set */
  onSetMany?: (updates: Update[]) => void;
  onAddRow: (near?: { rowId: string; where: "above" | "below" }) => void;
  onDeleteRow: (rowId: string) => void;
  onDeleteRows?: (rowIds: string[]) => void;
  onMoveRow: (rowId: string, direction: -1 | 1) => void;
  /** a block pasted at (row, visible column) — rows past the end are new rows */
  onPaste: (startRow: number, startCol: number, matrix: string[][]) => void;
  /** omitted = the columns are fixed (the timeline's are) */
  onColumnsChange?: (columns: Column[]) => void;
  colorOf?: (col: Column, value: CellValue | undefined) => string | undefined;
}

type ColDialog = { mode: "add" } | { mode: "edit"; key: string } | null;
type Pos = { r: number; c: number };

export function SheetGrid({
  columns, rows, onCommit, onSetMany, onAddRow, onDeleteRow, onDeleteRows, onMoveRow, onPaste, onColumnsChange, colorOf,
}: Props) {
  const vis = columns.filter((c) => !c.hidden);
  const hidden = columns.filter((c) => c.hidden);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Pos | null>(null);
  /** the far corner of a range; null = just the one cell */
  const [ext, setExt] = useState<Pos | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; draft: string } | null>(null);
  const [colDialog, setColDialog] = useState<ColDialog>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [setAll, setSetAll] = useState("");
  const committing = useRef(false);
  const dragging = useRef(false);

  // a drag ends wherever the mouse is let go, inside the grid or not
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const clampPos = (r: number, c: number): Pos => ({
    r: Math.max(0, Math.min(rows.length - 1, r)),
    c: Math.max(0, Math.min(vis.length - 1, c)),
  });

  // the selected range, as bounds (inclusive)
  const range =
    sel && rows.length && vis.length
      ? {
          r0: Math.min(sel.r, (ext ?? sel).r),
          r1: Math.min(rows.length - 1, Math.max(sel.r, (ext ?? sel).r)),
          c0: Math.min(sel.c, (ext ?? sel).c),
          c1: Math.min(vis.length - 1, Math.max(sel.c, (ext ?? sel).c)),
        }
      : null;
  const rangeCells = range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;
  const inRange = (r: number, c: number) =>
    !!range && rangeCells > 1 && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const pickedRows = rows.filter((r) => picked.has(r.id));

  const commit = (r: number, c: number, raw: unknown): boolean => {
    const col = vis[c];
    const row = rows[r];
    if (!col || !row) return false;
    const res = sanitizeCell(col, raw);
    if (!res.ok) {
      toast.error(`${col.label}: ${res.error}`);
      return false;
    }
    const current = row.data[col.key] ?? (col.type === "checkbox" ? false : "");
    if (res.value === current) return true;
    onCommit(row.id, col.key, res.value);
    return true;
  };

  /** Many cells, one save. Values that don't fit their column are left
   *  alone and counted, never coerced. */
  const commitMany = (cells: { r: number; c: number; raw: unknown }[]) => {
    const byRow = new Map<string, Record<string, CellValue>>();
    let refused = 0;
    for (const { r, c, raw } of cells) {
      const col = vis[c];
      const row = rows[r];
      if (!col || !row) continue;
      const res = sanitizeCell(col, raw);
      if (!res.ok) {
        refused++;
        continue;
      }
      const current = row.data[col.key] ?? (col.type === "checkbox" ? false : "");
      if (res.value === current) continue;
      byRow.set(row.id, { ...(byRow.get(row.id) ?? {}), [col.key]: res.value });
    }
    const updates: Update[] = [...byRow].map(([rowId, patch]) => ({ rowId, patch }));
    if (updates.length) {
      if (onSetMany) onSetMany(updates);
      else for (const u of updates) for (const [k, v] of Object.entries(u.patch)) onCommit(u.rowId, k, v);
    }
    if (refused) toast.error(`${refused} cell${refused === 1 ? "" : "s"} didn't fit ${refused === 1 ? "its" : "their"} column and ${refused === 1 ? "was" : "were"} left as ${refused === 1 ? "it was" : "they were"}.`);
    if (!updates.length && !refused) toast("Nothing to change — those cells already say that.");
  };

  const eachInRange = (fn: (r: number, c: number) => unknown) => {
    if (!range) return [];
    const out: { r: number; c: number; raw: unknown }[] = [];
    for (let r = range.r0; r <= range.r1; r++)
      for (let c = range.c0; c <= range.c1; c++) out.push({ r, c, raw: fn(r, c) });
    return out;
  };
  const clearRange = () => commitMany(eachInRange((_, c) => (vis[c].type === "checkbox" ? false : "")));
  const fillDown = () => {
    if (!range || range.r1 === range.r0) return toast("Select two or more rows of a column to fill down.");
    commitMany(eachInRange((_, c) => rows[range.r0].data[vis[c].key] ?? ""));
  };
  const fillRight = () => {
    if (!range || range.c1 === range.c0) return toast("Select two or more columns of a row to fill right.");
    commitMany(eachInRange((r) => rows[r].data[vis[range.c0].key] ?? ""));
  };
  const setRangeTo = (value: string) => commitMany(eachInRange(() => value));
  const copyRange = () => {
    if (!range) return;
    const matrix: string[][] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const line: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) line.push(cellText(vis[c], rows[r]?.data[vis[c].key]));
      matrix.push(line);
    }
    void navigator.clipboard
      ?.writeText(toTsv(matrix))
      .then(() => toast.success(`Copied ${rangeCells} cell${rangeCells === 1 ? "" : "s"} — paste them into Google Sheets`))
      .catch(() => toast.error("Your browser blocked the clipboard."));
  };

  const startEdit = (r: number, c: number, seed?: string) => {
    const col = vis[c];
    const row = rows[r];
    if (!col || !row) return;
    if (col.type === "checkbox") {
      commit(r, c, !row.data[col.key]);
      return;
    }
    committing.current = false;
    const value = row.data[col.key];
    setSel({ r, c });
    setExt(null);
    setEdit({ r, c, draft: seed ?? (value === null || value === undefined ? "" : String(value)) });
  };

  const finishEdit = (save: boolean, move?: { dr: number; dc: number }) => {
    if (!edit || committing.current) return;
    committing.current = true;
    const ok = save ? commit(edit.r, edit.c, edit.draft) : true;
    if (!ok) {
      committing.current = false;
      return; // keep the editor open on a refused value
    }
    const next = move ? clampPos(edit.r + move.dr, edit.c + move.dc) : { r: edit.r, c: edit.c };
    setEdit(null);
    setSel(next);
    setExt(null);
    requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit || !sel || rows.length === 0) return;
    const { r, c } = sel;
    const col = vis[c];
    const mod = e.metaKey || e.ctrlKey;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      if (e.shiftKey) {
        const from = ext ?? sel;
        setExt(clampPos(from.r + dr, from.c + dc));
      } else {
        setSel(clampPos(r + dr, c + dc));
        setExt(null);
      }
    };
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        return copyRange();
      }
      if (k === "d") {
        e.preventDefault();
        return fillDown();
      }
      if (k === "r") {
        e.preventDefault();
        return fillRight();
      }
      if (k === "a") {
        e.preventDefault();
        setSel({ r: 0, c: 0 });
        setExt({ r: rows.length - 1, c: vis.length - 1 });
        return;
      }
      return;
    }
    switch (e.key) {
      case "ArrowUp": return move(-1, 0);
      case "ArrowDown": return move(1, 0);
      case "ArrowLeft": return move(0, -1);
      case "ArrowRight": return move(0, 1);
      case "Tab":
        e.preventDefault();
        setSel(clampPos(r, c + (e.shiftKey ? -1 : 1)));
        setExt(null);
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        return startEdit(r, c);
      case "Escape":
        setExt(null);
        return setSel(null);
      case "Backspace":
      case "Delete":
        e.preventDefault();
        if (rangeCells > 1) return clearRange();
        commit(r, c, col.type === "checkbox" ? false : "");
        return;
      case " ":
        if (col.type === "checkbox") {
          e.preventDefault();
          if (rangeCells > 1) {
            const on = !rows[range!.r0].data[vis[range!.c0].key];
            return commitMany(eachInRange((_, cc) => (vis[cc].type === "checkbox" ? on : undefined)).filter((x) => x.raw !== undefined));
          }
          commit(r, c, !rows[r].data[col.key]);
        }
        return;
    }
    if (e.key.length === 1 && !e.altKey && TYPING.has(col.type)) {
      e.preventDefault();
      startEdit(r, c, e.key);
    }
  };

  const applyMatrix = (matrix: string[][]) => {
    if (matrix.length === 0) return;
    const single = matrix.length === 1 && matrix[0].length === 1;
    // one value into a selected range fills every cell of it — like Sheets
    if (single && rangeCells > 1) return setRangeTo(matrix[0][0]);
    const start = range ? { r: range.r0, c: range.c0 } : { r: rows.length, c: 0 };
    if (single && sel) {
      commit(sel.r, sel.c, matrix[0][0]);
      return;
    }
    onPaste(start.r, start.c, matrix);
  };

  const onPasteEvent = (e: ClipboardEvent<HTMLDivElement>) => {
    if (edit) return; // the cell editor takes its own paste
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    applyMatrix(parseTsv(text));
  };

  const copyAll = () => {
    const matrix = [vis.map((c) => c.label), ...rows.map((r) => vis.map((c) => cellText(c, r.data[c.key])))];
    void navigator.clipboard
      ?.writeText(toTsv(matrix))
      .then(() => toast.success("Copied — paste it into Google Sheets"))
      .catch(() => toast.error("Your browser blocked the clipboard."));
  };

  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allPicked = rows.length > 0 && pickedRows.length === rows.length;
  const deletePicked = () => {
    if (!pickedRows.length) return;
    if (!window.confirm(`Delete ${pickedRows.length} row${pickedRows.length === 1 ? "" : "s"}? You can undo it right after.`)) return;
    const ids = pickedRows.map((r) => r.id);
    if (onDeleteRows) onDeleteRows(ids);
    else ids.forEach(onDeleteRow);
    setPicked(new Set());
    setSel(null);
    setExt(null);
  };

  const rangeCol = range && range.c0 === range.c1 ? vis[range.c0] : null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--cz-muted)]">
        <span>
          Click a cell and type · <b>drag</b> or <b>Shift+click</b> to select many · <b>Delete</b> clears ·{" "}
          <b>⌘/Ctrl+D</b> fills down · paste one value into a selection to fill it
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className="circus-btn ghost !px-3 !py-1.5 !text-xs" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste className="size-3.5" /> Paste from Sheets
          </button>
          <button type="button" className="circus-btn ghost !px-3 !py-1.5 !text-xs" onClick={copyAll}>
            Copy as sheet
          </button>
        </span>
      </div>

      {rangeCells > 1 || pickedRows.length > 0 ? (
        <div className="sticky top-16 z-[5] flex flex-wrap items-center gap-2 rounded-2xl bg-[#1e1230]/95 px-3 py-2 text-xs text-[var(--cz-cream)] shadow-lg ring-1 ring-[var(--cz-gold)]/40 backdrop-blur">
          {rangeCells > 1 ? (
            <>
              <b className="text-[var(--cz-gold)]">{rangeCells} cells</b>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRangeTo(setAll);
                  setSetAll("");
                }}
              >
                {rangeCol?.type === "select" ? (
                  <select
                    value={setAll}
                    onChange={(e) => setSetAll(e.target.value)}
                    className="h-7 rounded-md bg-white/10 px-2 text-[var(--cz-cream)] outline-none [color-scheme:dark]"
                  >
                    <option value="">Set all to…</option>
                    {(rangeCol.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {rangeCol.labels?.[o] ?? o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={setAll}
                    onChange={(e) => setSetAll(e.target.value)}
                    placeholder="Set all to…"
                    type={rangeCol?.type === "date" ? "date" : rangeCol?.type === "number" ? "number" : "text"}
                    className="h-7 w-40 rounded-md bg-white/10 px-2 text-[var(--cz-cream)] outline-none [color-scheme:dark]"
                  />
                )}
                <button type="submit" className="rounded-md bg-[var(--cz-gold)] px-2.5 py-1 font-bold text-[#2a0710]">
                  Set
                </button>
              </form>
              <button type="button" onClick={fillDown} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10">
                <PaintBucket className="size-3.5" /> Fill down
              </button>
              <button type="button" onClick={clearRange} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10">
                <Eraser className="size-3.5" /> Clear
              </button>
              <button type="button" onClick={copyRange} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10">
                <Copy className="size-3.5" /> Copy
              </button>
            </>
          ) : null}
          {pickedRows.length > 0 ? (
            <>
              <b className="text-[#ff8a98]">
                {pickedRows.length} row{pickedRows.length === 1 ? "" : "s"} ticked
              </b>
              <button
                type="button"
                onClick={deletePicked}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[#ff8a98] hover:bg-[#ff8a98]/10"
              >
                <Trash2 className="size-3.5" /> Delete them
              </button>
              <button type="button" onClick={() => setPicked(new Set())} className="rounded-md px-2 py-1 hover:bg-white/10">
                Untick
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        ref={wrapRef}
        tabIndex={0}
        className="sheet-wrap"
        onKeyDown={onKeyDown}
        onPaste={onPasteEvent}
        aria-label="Editable sheet"
      >
        <table className="sheet">
          <thead>
            <tr>
              <th className="rownum">
                <input
                  type="checkbox"
                  aria-label="Tick every row"
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="size-3.5 cursor-pointer accent-[var(--cz-gold)]"
                />
              </th>
              {vis.map((col, c) => (
                <th key={col.key}>
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      className="hover:text-[var(--cz-cream)]"
                      title="Select the whole column"
                      onClick={() => {
                        if (!rows.length) return;
                        setSel({ r: 0, c });
                        setExt({ r: rows.length - 1, c });
                        wrapRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {col.label}
                    </button>
                    {onColumnsChange ? (
                      <button
                        type="button"
                        className="opacity-60 hover:text-[var(--cz-cream)] hover:opacity-100"
                        onClick={() => setColDialog({ mode: "edit", key: col.key })}
                        title="Rename, retype, hide or delete this column"
                        aria-label={`${col.label} settings`}
                      >
                        <Settings2 className="size-3" />
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
              {onColumnsChange ? (
                <th className="!min-w-0">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-[var(--cz-cream)]"
                    onClick={() => setColDialog({ mode: "add" })}
                  >
                    <Plus className="size-3.5" /> Column
                  </button>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id} className={cn(picked.has(row.id) && "row-picked")}>
                <td className="rownum">
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      aria-label={`Tick row ${r + 1}`}
                      checked={picked.has(row.id)}
                      onChange={() => togglePick(row.id)}
                      className="size-3.5 cursor-pointer accent-[var(--cz-gold)]"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10"
                          aria-label={`Row ${r + 1} actions`}
                        >
                          {r + 1} <MoreHorizontal className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => onAddRow({ rowId: row.id, where: "above" })}>
                          <Plus className="size-4" /> Insert row above
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAddRow({ rowId: row.id, where: "below" })}>
                          <Plus className="size-4" /> Insert row below
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={r === 0} onSelect={() => onMoveRow(row.id, -1)}>
                          <ArrowUp className="size-4" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={r === rows.length - 1} onSelect={() => onMoveRow(row.id, 1)}>
                          <ArrowDown className="size-4" /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteRow(row.id)}>
                          <Trash2 className="size-4" /> Delete row
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </td>
                {vis.map((col, c) => {
                  const isSel = sel?.r === r && sel?.c === c;
                  const isEdit = edit?.r === r && edit?.c === c;
                  const value = row.data[col.key];
                  return (
                    <td
                      key={col.key}
                      className={cn(isSel && !isEdit && "is-sel", isEdit && "is-edit", !isEdit && inRange(r, c) && "in-range")}
                      onMouseDown={(e) => {
                        if (isEdit) return;
                        if (edit) finishEdit(true);
                        if (e.shiftKey && sel) {
                          e.preventDefault();
                          setExt({ r, c });
                          return;
                        }
                        dragging.current = true;
                        setSel({ r, c });
                        setExt(null);
                      }}
                      onMouseEnter={() => {
                        if (dragging.current && sel) setExt({ r, c });
                      }}
                      onClick={(e) => {
                        // a second tap on the selected cell edits it (phones have no double-click)
                        if (!e.shiftKey && isSel && !ext && !isEdit && col.type !== "checkbox") startEdit(r, c);
                      }}
                      onDoubleClick={() => !isEdit && startEdit(r, c)}
                    >
                      {isEdit && edit ? (
                        <CellEditor
                          col={col}
                          draft={edit.draft}
                          setDraft={(draft) => setEdit({ ...edit, draft })}
                          finish={finishEdit}
                          commitNow={(v) => {
                            committing.current = true;
                            commit(r, c, v);
                            setEdit(null);
                            requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));
                          }}
                        />
                      ) : (
                        <CellView col={col} value={value} color={colorOf?.(col, value)} onToggle={() => commit(r, c, !value)} />
                      )}
                    </td>
                  );
                })}
                {onColumnsChange ? <td className="!min-w-0" /> : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="rownum" />
                <td colSpan={vis.length + (onColumnsChange ? 1 : 0)} className="py-6 text-center text-[var(--cz-muted)]">
                  Nothing here yet — add a row, or paste a block from Google Sheets.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="circus-btn !px-4 !py-2 !text-xs" onClick={() => onAddRow()}>
          <Plus className="size-4" /> Add row
        </button>
        <span className="text-xs text-[var(--cz-muted)]">{rows.length} rows</span>
        {hidden.length > 0 && onColumnsChange ? (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--cz-muted)]">
            <EyeOff className="size-3.5" /> Hidden:
            {hidden.map((h) => (
              <button
                key={h.key}
                type="button"
                className="circus-chip hover:brightness-125"
                onClick={() => onColumnsChange(columns.map((c) => (c.key === h.key ? { ...c, hidden: false } : c)))}
                title="Show this column again"
              >
                {h.label}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      {onColumnsChange ? (
        <ColumnDialog
          state={colDialog}
          columns={columns}
          onClose={() => setColDialog(null)}
          onChange={(next) => {
            onColumnsChange(next);
            setColDialog(null);
          }}
        />
      ) : null}
      <PasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        where={
          rangeCells > 1
            ? `your ${rangeCells} selected cells (one value fills them all)`
            : sel
              ? `row ${sel.r + 1}, “${vis[sel.c]?.label}”`
              : "the end, as new rows"
        }
        onApply={(text) => {
          applyMatrix(parseTsv(text));
          setPasteOpen(false);
        }}
      />
    </div>
  );
}

function CellView({
  col, value, color, onToggle,
}: { col: Column; value: CellValue | undefined; color?: string; onToggle: () => void }) {
  if (col.type === "checkbox")
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={!!value}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "grid size-5 place-items-center rounded border text-[11px] font-black transition",
          value ? "border-[var(--cz-gold)] bg-[var(--cz-gold)] text-[#2a0710]" : "border-white/30 hover:border-[var(--cz-gold)]"
        )}
      >
        {value ? "✓" : ""}
      </button>
    );
  const text = cellText(col, value);
  if (!text) return <span className="text-white/20">—</span>;
  if (col.type === "select")
    return (
      <span className="circus-chip" style={color ? ({ "--chip": color } as React.CSSProperties) : undefined}>
        {text}
      </span>
    );
  if (col.type === "date") return <span className="font-mono text-[12px]">{fmtDay(String(value))}</span>;
  if (col.type === "longtext") return <span className="line-clamp-3 whitespace-pre-line" dir="auto">{text}</span>;
  return <span className="line-clamp-2" dir="auto">{text}</span>;
}

function CellEditor({
  col, draft, setDraft, finish, commitNow,
}: {
  col: Column;
  draft: string;
  setDraft: (v: string) => void;
  finish: (save: boolean, move?: { dr: number; dc: number }) => void;
  commitNow: (v: string) => void;
}) {
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      finish(true, { dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (e.key === "Enter" && (col.type !== "longtext" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true, { dr: 1, dc: 0 });
    }
  };
  if (col.type === "select")
    return (
      <select
        autoFocus
        className="cell-input"
        value={draft}
        onChange={(e) => commitNow(e.target.value)}
        onBlur={() => finish(false)}
        onKeyDown={keys}
      >
        <option value="">—</option>
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>
            {col.labels?.[o] ?? o}
          </option>
        ))}
      </select>
    );
  if (col.type === "longtext")
    return (
      <textarea
        autoFocus
        className="cell-input"
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={keys}
        placeholder="Ctrl/⌘ + Enter to save"
      />
    );
  return (
    <input
      autoFocus
      className="cell-input"
      dir="auto"
      type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={keys}
    />
  );
}

function ColumnDialog({
  state, columns, onClose, onChange,
}: {
  state: ColDialog;
  columns: Column[];
  onClose: () => void;
  onChange: (next: Column[]) => void;
}) {
  const current = state?.mode === "edit" ? columns.find((c) => c.key === state.key) : undefined;
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {state ? (
          <ColumnForm
            key={state.mode === "edit" ? state.key : "add"}
            mode={state.mode}
            current={current}
            columns={columns}
            onChange={onChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ColumnForm({
  mode, current, columns, onChange,
}: {
  mode: "add" | "edit";
  current?: Column;
  columns: Column[];
  onChange: (next: Column[]) => void;
}) {
  const [label, setLabel] = useState(current?.label ?? "");
  const [type, setType] = useState<ColumnType>(current?.type ?? "text");
  const [options, setOptions] = useState((current?.options ?? []).join("\n"));
  const [hidden, setHidden] = useState(!!current?.hidden);
  const index = current ? columns.findIndex((c) => c.key === current.key) : -1;

  const build = (): Column | null => {
    const l = label.trim();
    if (!l) {
      toast.error("Give the column a name.");
      return null;
    }
    const opts = options.split("\n").map((o) => o.trim()).filter(Boolean);
    return {
      key: current?.key ?? columnKey(l, columns.map((c) => c.key)),
      label: l,
      type,
      ...(type === "select" ? { options: opts, ...(current?.labels ? { labels: current.labels } : {}) } : {}),
      ...(hidden ? { hidden: true } : {}),
    };
  };
  const move = (d: -1 | 1) => {
    const j = index + d;
    if (index < 0 || j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "Add a column" : `Column: ${current?.label}`}</DialogTitle>
        <DialogDescription>
          {mode === "add"
            ? "Every row gets this column. It shows on the page right away."
            : "Changing the type keeps what's already typed in it."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>Name</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label>Type</Label>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as ColumnType)}
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {type === "select" ? (
          <div className="grid gap-1.5">
            <Label>Choices (one per line)</Label>
            <Textarea rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
          </div>
        ) : null}
        {mode === "edit" ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            Hide this column <Switch checked={hidden} onCheckedChange={setHidden} />
          </label>
        ) : null}
      </div>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        {mode === "edit" ? (
          <div className="flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => move(-1)} disabled={index <= 0}>
              ← Left
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => move(1)} disabled={index >= columns.length - 1}>
              Right →
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={columns.length <= 1}
              onClick={() => {
                if (!current) return;
                if (!window.confirm(`Delete the “${current.label}” column? What's typed in it stays saved — add a column with the same name to bring it back.`)) return;
                onChange(columns.filter((c) => c.key !== current.key));
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        ) : (
          <span />
        )}
        <Button
          type="button"
          onClick={() => {
            const col = build();
            if (!col) return;
            onChange(mode === "add" ? [...columns, col] : columns.map((c) => (c.key === col.key ? col : c)));
          }}
        >
          {mode === "add" ? "Add column" : "Save column"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PasteDialog({
  open, onOpenChange, where, onApply,
}: { open: boolean; onOpenChange: (o: boolean) => void; where: string; onApply: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setText("");
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste from Google Sheets</DialogTitle>
          <DialogDescription>
            Copy cells in Sheets (⌘/Ctrl + C) and paste them here. They fill in from {where}; extra lines become new rows.
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here…" autoFocus />
        <DialogFooter>
          <Button type="button" disabled={!text.trim()} onClick={() => onApply(text)}>
            Fill the sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
