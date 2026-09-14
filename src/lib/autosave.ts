/**
 * AUTOSAVE (v36.6) — "they edit an account, they get out, and nothing happened".
 *
 * Measured before writing this: every account save that REACHED the database
 * in the last day succeeded (the Supabase edge log had 7 PATCHes, all 204).
 * The edits were being lost before they were ever sent. The account page's
 * cards only persisted on a Save button that appeared at the bottom of the card
 * once something changed — and people who type into a field, like they do in a
 * Google Sheet, then tap WhatsApp or go back to the list, never pressed it. The
 * Next-step card was worse: its Save button stayed DISABLED while a step had no
 * date, with nothing saying why, so a step typed without a date could not be
 * saved at all.
 *
 * So edits save themselves: after a short pause in typing, when a field loses
 * focus, when the tab is hidden (the WhatsApp case), and when the component
 * unmounts (navigating away inside the app). Something that CANNOT be saved yet
 * says why in words instead of silently waiting.
 *
 * This file is the framework-free core so it can be tested in node: the React
 * wrapper is `use-autosave.ts`.
 */

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "blocked"; reason: string }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; error: string };

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface AutosaveTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
}

const defaultTimers: AutosaveTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<SaveResult>;
  // (mutable: see setSave)
  /** the pause after the last change before saving (ms) */
  delay?: number;
  onStatus?: (status: AutosaveStatus) => void;
  timers?: AutosaveTimers;
}

export class AutosaveController<T> {
  private latest: T | undefined;
  /** the latest value has not been saved yet */
  private dirty = false;
  private blockedReason: string | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private current: AutosaveStatus = { kind: "idle" };
  private readonly delay: number;
  private readonly timers: AutosaveTimers;

  constructor(private readonly opts: AutosaveOptions<T>) {
    this.delay = opts.delay ?? 1000;
    this.timers = opts.timers ?? defaultTimers;
  }

  get status(): AutosaveStatus {
    return this.current;
  }

  /** true while something the member typed is not in the database yet */
  get unsaved(): boolean {
    return this.dirty || this.inFlight !== null;
  }

  /** Record a new value. `blockedReason` = it can't be saved as-is, and why. */
  change(value: T, blockedReason: string | null = null): void {
    this.latest = value;
    this.dirty = true;
    this.blockedReason = blockedReason;
    this.clearTimer();
    if (blockedReason) {
      if (!this.inFlight) this.set({ kind: "blocked", reason: blockedReason });
      return;
    }
    if (!this.inFlight) this.set({ kind: "pending" });
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run();
    }, this.delay);
  }

  /** Save right now if anything is waiting — a field lost focus, the tab is
   *  being hidden, the page is being left. Resolves when it has landed. */
  flush(): Promise<void> {
    this.clearTimer();
    return this.run();
  }

  private clearTimer() {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  private set(status: AutosaveStatus) {
    this.current = status;
    this.opts.onStatus?.(status);
  }

  /** Swap the save function (the React wrapper keeps it current). */
  setSave(save: (value: T) => Promise<SaveResult>): void {
    this.opts.save = save;
  }

  private async run(): Promise<void> {
    // one save at a time — and `flush()` resolves only once EVERYTHING pending
    // has landed, including a follow-up save started while it waited
    while (this.inFlight) await this.inFlight;
    if (!this.dirty || this.blockedReason) return;
    const value = this.latest as T;
    this.dirty = false;
    this.set({ kind: "saving" });
    const attempt = (async () => {
      let res: SaveResult;
      try {
        res = await this.opts.save(value);
      } catch (e) {
        res = { ok: false, error: e instanceof Error && e.message ? e.message : "Couldn't save — check your connection." };
      }
      if (!res.ok) {
        // keep it: a retry (or leaving the page) sends it again. Never retried
        // in a loop — a refusal from the server would just repeat.
        this.dirty = true;
        this.set({ kind: "error", error: res.error });
        return;
      }
      if (this.dirty) {
        this.set(this.blockedReason ? { kind: "blocked", reason: this.blockedReason } : { kind: "pending" });
      } else {
        this.set({ kind: "saved", at: this.timers.now() });
      }
    })();
    this.inFlight = attempt;
    try {
      await attempt;
    } finally {
      this.inFlight = null;
    }
    // changed while saving and no debounce is waiting for it → send it now
    if (this.dirty && !this.blockedReason && this.timer === null && this.current.kind !== "error") {
      return this.run();
    }
  }
}
