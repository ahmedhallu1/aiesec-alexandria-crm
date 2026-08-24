/** THE IM PROMPT'S OWN SMALL RULES — pure, shared by the server action and
 *  the client preview (v34.9), so the two can never quietly disagree about
 *  what a member will actually see. */

export type ImPromptResponseKind = "none" | "acknowledge" | "rating" | "text";

/** The question shown above the control when the author didn't write one.
 *  Only "rating" and "text" have a control to caption at all. */
export function defaultResponseLabel(kind: ImPromptResponseKind): string | null {
  if (kind === "rating") return "How would you rate this?";
  if (kind === "text") return "Your answer";
  return null;
}
