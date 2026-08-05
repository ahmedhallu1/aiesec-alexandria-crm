import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";

/** THE CHANGE SET — one server-action call, one id.
 *
 *  Every journal row and the audit entry written during that call share it,
 *  which is the entire mechanism behind Undo on /admin: "replay exactly this
 *  action's writes, in reverse".
 *
 *  IT LIVES IN ITS OWN LEAF MODULE ON PURPOSE (v33.10). It used to sit in
 *  sandbox.ts, which `actions.ts` imports statically and `data.ts` imported
 *  DYNAMICALLY — two module instances in the server bundle, so React's
 *  per-request `cache()` memoised twice and handed out two different ids. The
 *  audit row and its journal rows were stamped with different change sets, so
 *  they never matched and every Undo button was permanently disabled: 544
 *  audit change-sets, 324 journal change-sets, ZERO overlap.
 *
 *  Nothing imports this except to get the id, so there is no path back to a
 *  second copy. */
export const currentChangeSet = cache((): string => randomUUID());
