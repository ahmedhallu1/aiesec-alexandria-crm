"use client";

import "./circus.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Check, Copy, ExternalLink, Eye, Loader2, Lock, Pencil, Plus, Trash2, TriangleAlert,
} from "lucide-react";
import {
  addActivationRow, deleteActivationRow, deleteActivationRows, getActivationDelta, getActivationPlan, moveActivationRow,
  pasteActivationCells, restoreActivationRow, setActivationCells, updateActivationSection,
  addActivationSection, deleteActivationSection, moveActivationSection,
} from "@/server/activation-actions";
import {
  addDays, daysBetween, fmtDay, mergeDelta, positionBetween, rowsOf, sanitizeCell,
  type ActivationPlan, type ActivationRow, type ActivationSection, type CellValue, type Column,
} from "@/lib/activation/model";
import { CORE_SECTION_IDS } from "@/lib/activation/seed";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BoardContext, type BoardApi, useBoard } from "./context";
import { playfair, rye } from "./fonts";
import { useReveal, Valance } from "./fx";
import { Hero, type HeroStats } from "./hero";
import { SheetGrid } from "./sheet-grid";
import { TimelineAct, type CheckpointMark } from "./timeline";
import { ChecklistView, CheckpointsView, PeopleView, PlainView, RolesView, RunbookView, teamColor } from "./views";

/**
 * THE ACTIVATE 26' BOARD — the whole bid, one page, two audiences.
 *
 * Inside Sodio (`/activation`, MMs and above since v36.8) the board flips to
 * EDIT and changes anything the way the Google Sheet it came from did; outside
 * it (`/activate26`) the same page is a read-only showbill. State lives here
 * and every change is optimistic: it shows immediately and saves behind it. A
 * save the server refuses reloads the plan from the server rather than leaving
 * the screen showing something that isn't true. While someone edits, the page
 * polls for the others' changes every 15 s (only while the tab is visible).
 */

type Res = { ok: boolean; error?: string };
const POLL_MS = 15_000;
const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)
      );

export function ActivationBoard({
  initial, editable, publicUrl, embedded,
}: {
  initial: ActivationPlan;
  editable: boolean;
  publicUrl: string;
  embedded: boolean;
}) {
  const [plan, setPlan] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(0);
  const [trouble, setTrouble] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const planRef = useRef(plan);
  const busy = useRef(new Map<string, number>());
  useReveal(rootRef);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const reload = useCallback(async () => {
    const res = await getActivationPlan();
    if (res.ok && res.data) {
      setPlan(res.data);
      setTrouble(false);
    }
  }, []);

  /** Run one save; the keys are protected from the poll until it lands. */
  const run = useCallback(
    async (keys: string[], call: () => Promise<Res>): Promise<boolean> => {
      keys.forEach((k) => busy.current.set(k, (busy.current.get(k) ?? 0) + 1));
      setSaving((n) => n + 1);
      try {
        const res = await call();
        if (!res.ok) {
          toast.error(res.error ?? "Couldn't save that.");
          await reload();
          return false;
        }
        return true;
      } catch (e) {
        // said out loud in the console too — "nothing happened" is exactly
        // the report a swallowed error produces (v36.8, the add-section case)
        console.error("[activation] save failed", e);
        setTrouble(true);
        toast.error("Couldn't reach Sodio — that change may not be saved. Check your connection, or reload the page.");
        return false;
      } finally {
        keys.forEach((k) => {
          const n = (busy.current.get(k) ?? 1) - 1;
          if (n <= 0) busy.current.delete(k);
          else busy.current.set(k, n);
        });
        setSaving((n) => n - 1);
      }
    },
    [reload]
  );

  const patchRow = (rowId: string, patch: Record<string, CellValue>) =>
    setPlan((p) => ({ ...p, rows: p.rows.map((r) => (r.id === rowId ? { ...r, data: { ...r.data, ...patch } } : r)) }));

  const api: BoardApi = useMemo(
    () => ({
      editable,
      editing: editable && editing,
      publicView: initial.publicView,
      setCells: (rowId, patch) => {
        patchRow(rowId, patch);
        void run([rowId], () => setActivationCells(rowId, patch));
      },
      setMany: (sectionId, updates) => {
        if (!updates.length) return;
        setPlan((p) => ({
          ...p,
          rows: p.rows.map((r) => {
            const u = updates.find((x) => x.rowId === r.id);
            return u ? { ...r, data: { ...r.data, ...u.patch } } : r;
          }),
        }));
        const cells = updates.reduce((n, u) => n + Object.keys(u.patch).length, 0);
        void run(
          updates.map((u) => u.rowId),
          () => pasteActivationCells(sectionId, updates, [])
        ).then((ok) => {
          if (ok) toast.success(`Updated ${cells} cell${cells === 1 ? "" : "s"}`);
        });
      },
      addRow: (sectionId, data = {}, near) => {
        const list = rowsOf(planRef.current, sectionId);
        let position = positionBetween(list[list.length - 1]?.position, null);
        if (near) {
          const i = list.findIndex((r) => r.id === near.rowId);
          if (i >= 0)
            position =
              near.where === "above"
                ? positionBetween(list[i - 1]?.position, list[i].position)
                : positionBetween(list[i].position, list[i + 1]?.position);
        }
        const id = uuid();
        const row: ActivationRow = {
          id, section_id: sectionId, position, data, updated_at: new Date().toISOString(), updated_by_name: null,
        };
        setPlan((p) => ({ ...p, rows: [...p.rows, row] }));
        void run([id], () => addActivationRow(sectionId, { id, position, data }));
        return id;
      },
      deleteRow: (rowId) => {
        const row = planRef.current.rows.find((r) => r.id === rowId);
        if (!row) return;
        setPlan((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== rowId) }));
        // (v37.8) say "deleted" only once the server agreed (as deleteRows does); a
        // rejected delete reloads the row, and Undo must never append it twice
        void run([rowId], () => deleteActivationRow(rowId)).then((ok) => {
          if (!ok) return;
          toast("Row deleted", {
            action: {
              label: "Undo",
              onClick: () => {
                setPlan((p) => ({ ...p, rows: [...p.rows.filter((r) => r.id !== rowId), row] }));
                void run([rowId], () => restoreActivationRow(rowId));
              },
            },
          });
        });
      },
      deleteRows: (rowIds) => {
        const ids = new Set(rowIds);
        const gone = planRef.current.rows.filter((r) => ids.has(r.id));
        if (!gone.length) return;
        setPlan((p) => ({ ...p, rows: p.rows.filter((r) => !ids.has(r.id)) }));
        void run([...ids], () => deleteActivationRows([...ids])).then((ok) => {
          if (!ok) return;
          toast(`${gone.length} row${gone.length === 1 ? "" : "s"} deleted`, {
            action: {
              label: "Undo",
              onClick: () => {
                setPlan((p) => ({ ...p, rows: [...p.rows.filter((r) => !ids.has(r.id)), ...gone] }));
                void run([...ids], () => deleteActivationRows([...ids], true));
              },
            },
          });
        });
      },
      moveRow: (rowId, direction) => {
        const row = planRef.current.rows.find((r) => r.id === rowId);
        if (!row) return;
        const list = rowsOf(planRef.current, row.section_id);
        const i = list.findIndex((r) => r.id === rowId);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= list.length) return;
        const position =
          direction < 0
            ? positionBetween(list[j - 1]?.position, list[j].position)
            : positionBetween(list[j].position, list[j + 1]?.position);
        setPlan((p) => ({ ...p, rows: p.rows.map((r) => (r.id === rowId ? { ...r, position } : r)) }));
        void run([rowId], () => moveActivationRow(rowId, position));
      },
      paste: (sectionId, startRow, startCol, matrix, columns) => {
        const vis = columns.filter((c) => !c.hidden);
        const list = rowsOf(planRef.current, sectionId);
        const updates: { rowId: string; patch: Record<string, CellValue> }[] = [];
        const newRows: { id: string; position: number; data: Record<string, CellValue> }[] = [];
        let skipped = 0;
        let cells = 0;
        let last = list[list.length - 1]?.position ?? 0;
        matrix.forEach((line, i) => {
          const data: Record<string, CellValue> = {};
          line.forEach((raw, j) => {
            const col: Column | undefined = vis[startCol + j];
            if (!col) return;
            const res = sanitizeCell(col, raw);
            if (!res.ok) {
              skipped++;
              return;
            }
            data[col.key] = res.value;
            cells++;
          });
          if (!Object.keys(data).length) return;
          const target = list[startRow + i];
          if (target) updates.push({ rowId: target.id, patch: data });
          else {
            last = positionBetween(last, null);
            newRows.push({ id: uuid(), position: last, data });
          }
        });
        if (!updates.length && !newRows.length) {
          toast.error("Nothing in that paste fits these columns.");
          return;
        }
        setPlan((p) => ({
          ...p,
          rows: [
            ...p.rows.map((r) => {
              const u = updates.find((x) => x.rowId === r.id);
              return u ? { ...r, data: { ...r.data, ...u.patch } } : r;
            }),
            ...newRows.map((n) => ({
              id: n.id, section_id: sectionId, position: n.position, data: n.data,
              updated_at: new Date().toISOString(), updated_by_name: null,
            })),
          ],
        }));
        void run([...updates.map((u) => u.rowId), ...newRows.map((n) => n.id)], () =>
          pasteActivationCells(sectionId, updates, newRows)
        ).then((ok) => {
          if (ok)
            toast.success(
              `Pasted ${cells} cell${cells === 1 ? "" : "s"}${newRows.length ? ` · ${newRows.length} new row${newRows.length === 1 ? "" : "s"}` : ""}${
                skipped ? ` · ${skipped} skipped (didn't fit the column)` : ""
              }`
            );
        });
      },
      updateSection: async (sectionId, patch) => {
        setPlan((p) => ({
          ...p,
          sections: p.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
                  ...(patch.hidden_public !== undefined ? { hidden_public: patch.hidden_public } : {}),
                  config: { ...s.config, ...(patch.config ?? {}) },
                }
              : s
          ),
        }));
        return run([sectionId], () => updateActivationSection(sectionId, patch));
      },
      moveSection: async (sectionId, direction) => {
        if (await run([sectionId], () => moveActivationSection(sectionId, direction))) await reload();
      },
      deleteSection: async (sectionId) => {
        if (await run([sectionId], () => deleteActivationSection(sectionId))) await reload();
      },
      addSection: async (title) => {
        let id: string | null = null;
        const ok = await run(["__sections"], async () => {
          const res = await addActivationSection(title);
          if (res.ok) id = res.data?.id ?? null;
          return res;
        });
        if (!ok) return false;
        await reload();
        toast.success(`“${title}” is on the page — it opens as a sheet, add rows or paste from Google Sheets.`);
        // take them to it: a new act lands at the very bottom of a long page
        window.setTimeout(() => {
          if (id) document.getElementById(`act-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
        return true;
      },
    }),
    [editable, editing, initial.publicView, run, reload]
  );

  // other editors' changes, while this one edits
  useEffect(() => {
    if (!editable || !editing) return;
    let stopped = false;
    const pull = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const res = await getActivationDelta(planRef.current.syncedAt).catch(() => null);
      if (!res || !res.ok || !res.data || stopped) return;
      const delta = res.data;
      setPlan((p) => mergeDelta(p, delta, new Set(busy.current.keys())));
    };
    const t = window.setInterval(pull, POLL_MS);
    const onVisible = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [editable, editing]);

  // leaving with a save in flight asks first
  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  // read in render as a plain boolean — `api` carries functions that touch refs
  const editMode = editable && editing;
  const sections = plan.sections;
  const hero = sections.find((s) => s.kind === "hero");
  const acts = sections.filter((s) => s.kind !== "hero");
  const byView = (view: string) => sections.find((s) => s.config.view === view);
  const heroCfg = hero?.config.hero;

  const stats: HeroStats = useMemo(() => {
    const roles = byView("roles");
    const roleRows = roles ? rowsOf(plan, roles.id) : [];
    const cast = byView("people");
    const cps = byView("checkpoints");
    const teamsters = roleRows.reduce((n, r) => n + (Number(r.data.teamsters) || 0), 0);
    return {
      roadDays: heroCfg ? Math.max(0, daysBetween(heroCfg.bidDay, heroCfg.day0)) : 0,
      checkpoints: cps ? rowsOf(plan, cps.id).length : 0,
      departments: roleRows.filter((r) => r.data.tier === "OCVP").length,
      teamsters,
      ocSize: teamsters + roleRows.filter((r) => ["OCVP", "President", "Coach"].includes(String(r.data.tier))).length,
      capacity: cast?.config.capacity ?? (cast ? rowsOf(plan, cast.id).length : 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, heroCfg]);

  const marks: CheckpointMark[] = useMemo(() => {
    const cps = byView("checkpoints");
    if (!cps) return [];
    const teams = (cps.config.columns ?? []).filter((c) => !["name", "date"].includes(c.key));
    return rowsOf(plan, cps.id)
      .filter((r) => typeof r.data.date === "string" && r.data.date)
      .map((r) => ({
        id: r.id,
        name: String(r.data.name ?? "Checkpoint"),
        date: String(r.data.date),
        detail: teams.map((t) => ({ label: t.label, text: String(r.data[t.key] ?? ""), color: teamColor(t.key) })),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // the act nav follows the scroll
  const [activeAct, setActiveAct] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActiveAct(hit.target.id.replace(/^act-/, ""));
      },
      { rootMargin: "-35% 0px -55% 0px" }
    );
    rootRef.current?.querySelectorAll("[data-act]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [acts.length]);

  const navItems = acts.filter((s, i) => i === 0 || s.config.act !== acts[i - 1].config.act || !s.config.act);
  const actOf = (id: string) => {
    const s = acts.find((x) => x.id === id);
    return s?.config.act ? acts.find((x) => x.config.act === s.config.act)?.id : id;
  };

  return (
    <BoardContext.Provider value={api}>
      <div
        ref={rootRef}
        className={cn(
          "circus",
          rye.variable,
          playfair.variable,
          embedded ? "-mx-2 rounded-[28px] md:mx-0" : "min-h-dvh",
          editable && "pb-24"
        )}
      >
        <div className="circus-stars" aria-hidden />
        <div className="circus-spot left" aria-hidden />
        <div className="circus-spot right" aria-hidden />
        <Valance />

        {editMode ? (
          <div className="mx-auto mt-4 flex max-w-3xl items-start gap-2 rounded-2xl bg-[var(--cz-crimson)]/15 px-4 py-3 text-sm ring-1 ring-[var(--cz-crimson)]/50">
            <Pencil className="mt-0.5 size-4 shrink-0 text-[var(--cz-gold)]" />
            <span>
              <b>Edit mode.</b> Every change saves as you make it and everyone sees it. Tables open as sheets — drag
              across cells to edit many at once; the road is dragged. Flip to <b>View</b> at the bottom to see exactly
              what the public sees.
            </span>
          </div>
        ) : null}

        {hero ? <Hero section={hero} stats={stats} firstActId={acts[0]?.id ?? null} /> : null}

        {navItems.length > 1 ? (
          <nav className={cn("circus-nav", embedded ? "top-[calc(4.4rem+env(safe-area-inset-top))] md:top-3" : "top-3")}>
            {navItems.map((s) => (
              <a key={s.id} href={`#act-${s.id}`} className={cn(activeAct && actOf(activeAct) === s.id && "is-active")}>
                {s.config.emoji ? `${s.config.emoji} ` : ""}
                {s.config.act ? `${s.config.act} · ` : ""}
                {s.title}
              </a>
            ))}
          </nav>
        ) : null}

        {acts.map((s, i) => (
          <div key={s.id}>
            {i > 0 ? (
              <div className="circus-intermission" aria-hidden>
                ✦ ✦ ✦
              </div>
            ) : null}
            <SectionAct
              section={s}
              rows={rowsOf(plan, s.id)}
              marks={marks}
              day0={heroCfg?.day0 ?? null}
              first={i === 0}
              last={i === acts.length - 1}
            />
          </div>
        ))}

        {editMode ? <AddSection onOpen={() => setAddOpen(true)} /> : null}

        <Finale day0={heroCfg?.day0 ?? null} days={heroCfg?.showDays ?? 4} venue={heroCfg?.venue ?? ""} />

        {editable ? (
          <Dock
            editing={editing}
            setEditing={setEditing}
            saving={saving}
            trouble={trouble}
            onReload={() => void reload()}
            onAddSection={() => setAddOpen(true)}
            publicUrl={publicUrl}
          />
        ) : null}
        {editMode ? <AddSectionDialog open={addOpen} onOpenChange={setAddOpen} /> : null}
      </div>
    </BoardContext.Provider>
  );
}

function SectionAct({
  section, rows, marks, day0, first, last,
}: {
  section: ActivationSection;
  rows: ActivationRow[];
  marks: CheckpointMark[];
  day0: string | null;
  first: boolean;
  last: boolean;
}) {
  const api = useBoard();
  const custom = !(CORE_SECTION_IDS as readonly string[]).includes(section.id);
  const view = section.config.view ?? "plain";
  const columns = section.config.columns ?? [];

  return (
    <section id={`act-${section.id}`} data-act className="circus-section">
      <div className="circus-stage">
        <div className="mx-auto max-w-3xl text-center">
          {section.config.act ? (
            <p className="circus-act-label" data-reveal>
              {section.config.act}
            </p>
          ) : null}
          {api.editing ? (
            <div className="mt-3 grid gap-2">
              <InlineText
                value={section.title}
                className="circus-h2 text-center"
                label="Section title"
                onSave={(title) => void api.updateSection(section.id, { title })}
              />
              <InlineText
                value={section.subtitle}
                className="circus-sub text-center"
                label="Section subtitle"
                placeholder="A line under the title…"
                onSave={(subtitle) => void api.updateSection(section.id, { subtitle })}
              />
            </div>
          ) : (
            <>
              <h2 className="circus-h2 mt-3" data-reveal style={{ "--d": "80ms" } as CSSProperties}>
                {section.config.emoji ? <span className="not-italic">{section.config.emoji} </span> : null}
                {section.title}
              </h2>
              {section.subtitle ? (
                <p className="circus-sub mt-3" data-reveal style={{ "--d": "160ms" } as CSSProperties}>
                  {section.subtitle}
                </p>
              ) : null}
            </>
          )}
          {!api.editing && api.editable && section.hidden_public ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--cz-gold)]">
              <Lock className="size-3.5" /> Only Sodio members see this act
            </p>
          ) : null}
        </div>

        {api.editing ? <SectionTools section={section} custom={custom} first={first} last={last} /> : null}

        <div className="mt-10">
          {section.kind === "timeline" ? (
            <TimelineAct section={section} rows={rows} checkpoints={marks} />
          ) : api.editing ? (
            <SheetGrid
              columns={columns}
              rows={rows}
              onCommit={(rowId, key, value) => api.setCells(rowId, { [key]: value })}
              onSetMany={(updates) => api.setMany(section.id, updates)}
              onAddRow={(near) => api.addRow(section.id, {}, near)}
              onDeleteRow={api.deleteRow}
              onDeleteRows={api.deleteRows}
              onMoveRow={api.moveRow}
              onPaste={(r, c, m) => api.paste(section.id, r, c, m, columns)}
              onColumnsChange={(next) => void api.updateSection(section.id, { config: { columns: next } })}
              colorOf={(col, v) => (["team", "backup_team"].includes(col.key) ? teamColor(v) : undefined)}
            />
          ) : view === "checkpoints" ? (
            <CheckpointsView section={section} rows={rows} />
          ) : view === "roles" ? (
            <RolesView section={section} rows={rows} />
          ) : view === "people" ? (
            <PeopleView section={section} rows={rows} />
          ) : view === "checklist" ? (
            <ChecklistView section={section} rows={rows} />
          ) : view === "runbook" ? (
            <RunbookView section={section} rows={rows} day0={day0} />
          ) : (
            <PlainView section={section} rows={rows} />
          )}
        </div>
      </div>
    </section>
  );
}

function InlineText({
  value, onSave, className, label, placeholder,
}: { value: string; onSave: (v: string) => void; className?: string; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // (v37.8) Escape = cancel. setDraft(value) is queued but blur() runs at once,
  // so onBlur still saw the EDITED draft in its closure and saved it for everyone
  const cancelled = useRef(false);
  const shown = focused ? draft : value;
  return (
    <input
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft.trim() !== value.trim() && (draft.trim() || label !== "Section title")) onSave(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "w-full rounded-xl border border-dashed border-[var(--cz-gold)]/40 bg-white/[0.03] px-3 py-1.5 outline-none transition focus:border-[var(--cz-gold)] focus:bg-white/[0.06]",
        className
      )}
    />
  );
}

const pill = "flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-[var(--cz-line)]";

function SectionTools({
  section, custom, first, last,
}: { section: ActivationSection; custom: boolean; first: boolean; last: boolean }) {
  const api = useBoard();
  const days = section.config.columns?.find((c) => c.key === "day")?.options ?? [];
  return (
    <div className="mx-auto mt-5 flex max-w-4xl flex-wrap items-center justify-center gap-2 text-xs">
      <label className={pill}>
        <Switch
          checked={!section.hidden_public}
          onCheckedChange={(v) => void api.updateSection(section.id, { hidden_public: !v })}
        />
        On the public page
      </label>
      {section.config.view === "people" ? (
        <>
          <label className={pill}>
            List title
            <input
              key={section.config.listTitle ?? "Mapping"} // (v37.8) remount when the stored value changes (rollback / another editor)
              defaultValue={section.config.listTitle ?? "Mapping"}
              onBlur={(e) => {
                const v = e.target.value.trim() || "Mapping";
                if (v !== (section.config.listTitle ?? "Mapping"))
                  void api.updateSection(section.id, { config: { listTitle: v } });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-32 rounded bg-white/10 px-1.5 py-0.5 text-[var(--cz-cream)] outline-none"
            />
          </label>
          <label className={pill}>
            <Switch
              checked={!!section.config.namesPublic}
              onCheckedChange={(v) => void api.updateSection(section.id, { config: { namesPublic: v } })}
            />
            Show names publicly
          </label>
          <label className={pill}>
            LC capacity
            <input
              key={String(section.config.capacity ?? 0)}
              type="number"
              min={0}
              defaultValue={section.config.capacity ?? 0}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0 && n !== section.config.capacity)
                  void api.updateSection(section.id, { config: { capacity: n } });
              }}
              className="w-16 rounded bg-white/10 px-1.5 py-0.5 text-[var(--cz-cream)] outline-none"
            />
          </label>
        </>
      ) : null}
      {section.config.view === "runbook"
        ? days.map((day) => (
            <label key={day} className={pill}>
              {day}:
              <input
                key={section.config.dayNotes?.[day] ?? ""}
                defaultValue={section.config.dayNotes?.[day] ?? ""}
                placeholder="a line for this day"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === (section.config.dayNotes?.[day] ?? "")) return;
                  void api.updateSection(section.id, {
                    config: { dayNotes: { ...(section.config.dayNotes ?? {}), [day]: v } },
                  });
                }}
                className="w-40 rounded bg-white/10 px-1.5 py-0.5 text-[var(--cz-cream)] outline-none"
              />
            </label>
          ))
        : null}
      <span className="inline-flex overflow-hidden rounded-full ring-1 ring-[var(--cz-line)]">
        <button
          type="button"
          disabled={first}
          onClick={() => void api.moveSection(section.id, -1)}
          className="px-2.5 py-1.5 hover:bg-white/10 disabled:opacity-30"
          title="Move this act up"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => void api.moveSection(section.id, 1)}
          className="px-2.5 py-1.5 hover:bg-white/10 disabled:opacity-30"
          title="Move this act down"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </span>
      {custom ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[#ff8a98] ring-1 ring-[#ff8a98]/40 hover:bg-[#ff8a98]/10"
          onClick={() => {
            if (window.confirm(`Delete “${section.title}” and everything in it? This can't be undone.`))
              void api.deleteSection(section.id);
          }}
        >
          <Trash2 className="size-3.5" /> Delete section
        </button>
      ) : null}
    </div>
  );
}

/** The end of the acts in edit mode: one clear button into the add dialog —
 *  the same dialog the dock's "+ Section" opens, so there are two doors in
 *  and neither can sit under the other. */
function AddSection({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="circus-section">
      <button
        type="button"
        onClick={onOpen}
        className="mx-auto flex w-full max-w-xl flex-col items-center gap-1 rounded-[26px] border-2 border-dashed border-[var(--cz-gold)]/40 bg-white/[0.03] px-6 py-7 text-center transition hover:border-[var(--cz-gold)] hover:bg-white/[0.06]"
      >
        <Plus className="size-6 text-[var(--cz-gold)]" />
        <span className="circus-serif text-xl font-bold italic text-[var(--cz-cream)]">Add a new section</span>
        <span className="text-xs text-[var(--cz-muted)]">Budget, partners, agenda… it opens as a sheet you can fill or paste into</span>
      </button>
    </div>
  );
}

function AddSectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <AddSectionForm onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function AddSectionForm({ onDone }: { onDone: () => void }) {
  const api = useBoard();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await api.addSection(t);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a new section</DialogTitle>
        <DialogDescription>
          It lands at the end of the page with three columns (Item · Owner · Notes) — rename them, add more, or paste a
          block straight from Google Sheets.
        </DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        value={title}
        maxLength={160}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="e.g. Budget, Partners, Agenda"
      />
      <DialogFooter>
        <Button disabled={!title.trim() || busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add section
        </Button>
      </DialogFooter>
    </>
  );
}

function Finale({ day0, days, venue }: { day0: string | null; days: number; venue: string }) {
  return (
    <footer className="relative mt-16 overflow-hidden rounded-b-[inherit]">
      <div className="circus-finale-poster px-6 pb-16 pt-44 text-center sm:pb-24 sm:pt-64">
        <p className="circus-eyebrow !text-[var(--cz-cream)]">Curtain call</p>
        <p className="circus-display mt-3 text-4xl text-[var(--cz-gold)] drop-shadow-[0_4px_0_#4a0a15] sm:text-6xl" data-reveal>
          See you under the big top
        </p>
        {day0 ? (
          <p className="circus-serif mt-4 text-lg italic text-[var(--cz-cream)]">
            {fmtDay(day0)} – {fmtDay(addDays(day0, Math.max(1, days) - 1))} · {venue || "Alexandria"}
          </p>
        ) : null}
        <p className="mt-10 text-xs text-white/70">AIESEC in Alexandria · the bid to host Activate 26&apos; · kept live in Sodio</p>
      </div>
    </footer>
  );
}

function Dock({
  editing, setEditing, saving, trouble, onReload, onAddSection, publicUrl,
}: {
  editing: boolean;
  setEditing: (v: boolean) => void;
  saving: number;
  trouble: boolean;
  onReload: () => void;
  onAddSection: () => void;
  publicUrl: string;
}) {
  return (
    <div className="circus-dock" role="toolbar" aria-label="Bid page controls">
      <div className="seg">
        <button type="button" className={cn(!editing && "is-on")} onClick={() => setEditing(false)}>
          <Eye className="size-4" /> View
        </button>
        <button type="button" className={cn(editing && "is-on")} onClick={() => setEditing(true)}>
          <Pencil className="size-4" /> Edit
        </button>
      </div>
      {editing ? (
        <button type="button" onClick={onAddSection} title="Add a new section to the page">
          <Plus className="size-4" /> <span className="hidden sm:inline">Section</span>
        </button>
      ) : null}
      {/* (v37.8) shown on phones too (icon only below sm): with no status there, a failed save
          left optimistic edits on screen and no way to reload from the server */}
      <span className="inline-flex items-center gap-1.5 px-1 text-xs sm:px-2" aria-live="polite">
        {saving > 0 ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> <span className="hidden sm:inline">Saving…</span>
          </>
        ) : trouble ? (
          <button type="button" onClick={onReload} className="!p-0 text-[#ff8a98]" aria-label="Reload from the server">
            <TriangleAlert className="size-3.5" /> <span className="hidden sm:inline">Reload</span>
          </button>
        ) : (
          <>
            <Check className="size-3.5 text-[var(--cz-gold)]" /> <span className="hidden sm:inline">All saved</span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(publicUrl)
            .then(() => toast.success("Public link copied — anyone can view it, nobody outside Sodio can edit."))
            .catch(() => toast.error("Your browser blocked the clipboard."))
        }
        title="Copy the public, view-only link"
      >
        <Copy className="size-4" /> <span className="hidden sm:inline">Public link</span>
      </button>
      <a href={publicUrl} target="_blank" rel="noreferrer" title="Open the public page">
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
}
