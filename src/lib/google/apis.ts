/** THE GOOGLE CLIENTS — one API per package (v36.1).
 *
 *  ⚠️ `googleapis` ships every Google API there is (~330) and its index loads
 *  all of them on import, so the one line `import { google } from "googleapis"`
 *  compiled into a 12 MB server chunk — YouTube, BigQuery, Android Publisher —
 *  in every function of every deployment, twice (page and route bundles). That
 *  is a large part of what filled the Vercel team's 10 GB Function Storage.
 *
 *  The per-API packages are the same generated code, four of them instead of
 *  330, and they share googleapis-common's auth. This file keeps the
 *  `google.*` shape every call site was written against, so a new Google API
 *  means adding its `@googleapis/<name>` package here — never `googleapis`. */
import { auth, gmail } from "@googleapis/gmail";
import { sheets } from "@googleapis/sheets";
import { drive } from "@googleapis/drive";
import { calendar } from "@googleapis/calendar";

export const google = { auth, gmail, sheets, drive, calendar };
export { sheets_v4 } from "@googleapis/sheets";
export { drive_v3 } from "@googleapis/drive";
