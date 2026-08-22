import { asciiDigits } from "@/lib/types";

/** WRONG DATA IN THE RIGHT-LOOKING BOX.
 *
 *  The membership editor is four short text fields in a column, and people
 *  paste into the wrong one — an @aiesec.net address landed in NAME, which
 *  then became that member's display name everywhere: the leaderboards, the
 *  Responsible column, every email that greets them by first name.
 *
 *  `name` only ever required two characters, so nothing objected. These are
 *  the shape checks the fields always needed. They are deliberately about
 *  SHAPE, not identity — we refuse what cannot be a name, and say why, rather
 *  than guessing at what a real name looks like (this LC's names are Arabic,
 *  English, hyphenated, and occasionally one word). */

/** Anything with an @ between two non-space runs is somebody's address. */
export function looksLikeEmail(v: string): boolean {
  return /\S@\S/.test(v);
}

/** Mostly digits — a phone number, an EP id, a row number. */
export function looksLikePhone(v: string): boolean {
  const s = asciiDigits(v.trim());
  const digits = (s.match(/\d/g) ?? []).length;
  if (digits < 5) return false;
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  return digits > letters;
}

/** A real name has letters in it. Handles Arabic as readily as Latin. */
export function hasLetters(v: string, min = 2): boolean {
  return (v.match(/\p{L}/gu) ?? []).length >= min;
}

/** null = fine. A string = the reason to show the person who typed it. */
export function memberNameProblem(raw: string): string | null {
  const v = raw.trim();
  if (v.length < 2) return "Name is required.";
  if (looksLikeEmail(v))
    return "That's an email address, not a name — put it in the AIESEC Mail field.";
  if (looksLikePhone(v))
    return "That's a phone number, not a name — put it in the Phone field.";
  if (!hasLetters(v))
    return "A name needs letters in it.";
  if (/^https?:\/\//i.test(v)) return "That's a link, not a name.";
  return null;
}

/** The main email is the member's AIESEC identity; the backup is a personal
 *  inbox. Neither should hold the other's value, and neither should hold a
 *  phone number. */
export function memberEmailProblem(raw: string | null | undefined, label: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (looksLikePhone(v))
    return `That's a phone number, not ${label} — put it in the Phone field.`;
  if (!looksLikeEmail(v)) return `${label} doesn't look like an email address.`;
  return null;
}
