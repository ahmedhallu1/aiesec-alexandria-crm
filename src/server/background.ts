import "server-only";
import { after } from "next/server";

/** A FIRE-AND-FORGET THAT IS ALLOWED TO FINISH (v37.14).
 *
 *  A dozen actions start an email and return without awaiting it, on purpose:
 *  nobody should wait on Gmail to see "Saved". But on Vercel the function can
 *  be frozen the moment the response is sent, and a promise nothing is waiting
 *  on is exactly the work that gets cut off — the email then goes out minutes
 *  later when the instance happens to thaw, or never. `after()` hands the SAME
 *  already-running promise to the platform's waitUntil, so the timing is
 *  unchanged and the function stays alive until it settles.
 *
 *  The task must carry its own `.catch` (every call site logs its failure in
 *  its own words). Outside a request — a script, a test — `after` throws; the
 *  promise still runs, which is all those callers ever had. */
export function keepAlive(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    /* no request scope to extend — nothing to do */
  }
}
