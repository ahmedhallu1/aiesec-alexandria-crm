/** A PROPOSAL EDITED IN ITS PREVIEW (v36.4).
 *
 *  The preview is the real letter, made editable in place, and what the
 *  member typed into it is what goes out. It goes out from THEIR OWN Gmail, so
 *  this isn't a trust boundary for other members — it is a guard against the
 *  editor carrying anything a mail client might act on: scripts, frames,
 *  forms, event handlers, `javascript:` links, and the editing flag itself.
 *  Pure, so the tests pin it. */

const DANGEROUS = "script|iframe|frame|frameset|object|embed|applet|form|input|button|textarea|select|base";

export function sanitizeEditedEmailHtml(html: string): string {
  return (
    html
      // the element and everything inside it, then any stray opener/closer
      .replace(new RegExp(`<(${DANGEROUS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\/?(${DANGEROUS})\\b[^>]*>`, "gi"), "")
      // on*="…" handlers, whatever the quoting
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // javascript:/vbscript:/data:text/html in links and sources
      .replace(/\b(href|src|action)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
      // the editor's own markers
      .replace(/\scontenteditable\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\sdesignmode\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  );
}
