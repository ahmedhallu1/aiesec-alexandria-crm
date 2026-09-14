"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ClipboardPaste, EyeOff, MoreHorizontal, Plus, Settings2, Trash2,
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
 * THE SHEET (v36.7) — editing the bid plan the way the LC edited it in Google
 * Sheets: click a cell and type, Enter/Tab to move on, arrows to walk, Delete
 * to clear, and paste a whole block straight out of Sheets. Every commit is a
 * single-cell save; nothing waits for a Save button.
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

interface Props {
  columns: Column[];
  rows: ActivationRow[];
  onCommit: (rowId: string, key: string, value: CellValue) => void;
  onAddRow: (near?: { rowId: string; where: "above" | "below" }) => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: -1 | 1) => void;
  /** a block pasted at (row, visible column) — rows past the end are new rows */
  onPaste: (startRow: number, startCol: number, matrix: string[][]) => void;
  /** omitted = the columns are fixed (the timeline's are) */
  onColumnsChange?: (columns: Column[]) => void;
  colorOf?: (col: Column, value: CellValue | undefined) => string | undefined;
}

type ColDialog = { mode: "add" } | { mode: "edit"; key: string } | null;

export function SheetGrid({
  columns, rows, onCommit, onAddRow, onDeleteRow, onMoveRow, onPaste, onColumnsChange, colorOf,
}: Props) {
  const vis = columns.filter((c) => !c.hidden);
  const hidden = columns.filter((c) => c.hidden);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; draft: string } | null>(null);
  const [colDialog, setColDialog] = useState<ColDialog>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const committing = useRef(false);

  const clampSel = (r: number, c: number) => ({
    r: Math.max(0, Math.min(rows.length - 1, r)),
    c: Math.max(0, Math.min(vis.length - 1, c)),
  });

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
    const next = move ? clampSel(edit.r + move.dr, edit.c + move.dc) : { r: edit.r, c: edit.c };
    setEdit(null);
    setSel(next);
    requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit || !sel || rows.length === 0) return;
    const { r, c } = sel;
    const col = vis[c];
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      setSel(clampSel(r + dr, c + dc));
    };
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "c") {
      const text = cellText(col, rows[r]?.data[col.key]);
      void navigator.clipboard?.writeText(text).catch(() => {});
      return;
    }
    switch (e.key) {
      case "ArrowUp": return move(-1, 0);
      case "ArrowDown": return move(1, 0);
      case "ArrowLeft": return move(0, -1);
      case "ArrowRight": return move(0, 1);
      case "Tab": return move(0, e.shiftKey ? -1 : 1);
      case "Enter":
      case "F2":
        e.preventDefault();
        return startEdit(r, c);
      case "Escape":
        return setSel(null);
      case "Backspace":
      case "Delete":
        e.preventDefault();
        commit(r, c, col.type === "checkbox" ? false : "");
        return;
      case " ":
        if (col.type === "checkbox") {
          e.preventDefault();
          commit(r, c, !rows[r].data[col.key]);
        }
        return;
    }
    if (e.key.length === 1 && !mod && !e.altKey && TYPING.has(col.type)) {
      e.preventDefault();
      startEdit(r, c, e.key);
    }
  };

  const applyMatrix = (matrix: string[][]) => {
    if (matrix.length === 0) return;
    const start = sel ?? { r: rows.length, c: 0 };
    if (matrix.length === 1 && matrix[0].length === 1 && sel) {
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

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--cz-muted)]">
        <span>
          Click a cell and type · <b>Enter</b>/<b>Tab</b> to move on · <b>Delete</b> clears · paste a block from
          Google Sheets
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
              <th className="rownum">#</th>
              {vis.map((col) => (
                <th key={col.key}>
                  {onColumnsChange ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 hover:text-[var(--cz-cream)]"
                      onClick={() => setColDialog({ mode: "edit", key: col.key })}
                      title="Rename, retype, hide or delete this column"
                    >
                      {col.label} <Settings2 className="size-3 opacity-60" />
                    </button>
                  ) : (
                    col.label
                  )}
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
              <tr key={row.id}>
                <td className="rownum">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex w-full items-center justify-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10"
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
                </td>
                {vis.map((col, c) => {
                  const isSel = sel?.r === r && sel?.c === c;
                  const isEdit = edit?.r === r && edit?.c === c;
                  const value = row.data[col.key];
                  return (
                    <td
                      key={col.key}
                      className={cn(isSel && !isEdit && "is-sel", isEdit && "is-edit")}
                      onMouseDown={() => {
                        if (isEdit) return;
                        if (edit) finishEdit(true);
                        setSel({ r, c });
                      }}
                      onClick={() => {
                        // a second tap on the selected cell edits it (phones have no double-click)
                        if (isSel && !isEdit && col.type !== "checkbox") startEdit(r, c);
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
        where={sel ? `row ${sel.r + 1}, “${vis[sel.c]?.label}”` : "the end, as new rows"}
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
