/** IS THIS A STORAGE KEY WE COULD HAVE ISSUED? (v37.7)
 *
 *  Every "sign me a link" / "record my upload" action takes a key the BROWSER
 *  hands back, and the only checks were `startsWith(<prefix>)` or an
 *  unanchored regex. storage-js puts the key into the request URL as-is and
 *  `fetch` collapses dot-segments, so "<own-prefix>/../../contracts/<key>"
 *  passed the prefix check and signed an object in ANOTHER bucket.
 *
 *  Keys we issue are plain segments (ids, a timestamp, a sanitised name), so
 *  a dot-segment, an empty segment, a leading slash, a backslash, a
 *  percent-escape, `?`/`#` or a control character means we did not issue it,
 *  and it is refused before it reaches Storage. */
export function isSafeStorageKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (/[\\%?#\u0000-\u001f\u007f]/.test(key)) return false;
  return key.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}
