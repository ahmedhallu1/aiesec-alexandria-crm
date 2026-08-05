/** Who a touch point reads as being booked BY.
 *
 *  An LC-wide touch point is TM's, whoever happened to click the button: the
 *  person is acting as the function, and naming them makes an LC session look
 *  like one member's idea. Team and function points keep the real name —
 *  there the person IS the authority, and knowing who called the meeting is
 *  the useful part. (v33.5)
 */
export function bookedBy(tp: { scope?: string | null; ownerName?: string | null }): string {
  return tp.scope === "lc" ? "TM" : (tp.ownerName ?? "—");
}
