import { describe, it, expect } from "vitest";
import { sanitizeEditedEmailHtml } from "@/lib/email/edited-html";

/** A proposal edited in its preview goes out as the member edited it — minus
 *  anything a mail client could act on (v36.4). */
describe("sanitizeEditedEmailHtml", () => {
  it("keeps the letter as written", () => {
    const html = '<p style="color:#0A2540">Hello <b>Deli Techno</b> — <a href="https://aiesec.org">aiesec.org</a></p>';
    expect(sanitizeEditedEmailHtml(html)).toBe(html);
  });

  it("drops scripts, frames and forms with what's inside them", () => {
    const out = sanitizeEditedEmailHtml(
      '<p>ok</p><script>alert(1)</script><iframe src="x"></iframe><form action="/x"><input name="a"></form><p>end</p>'
    );
    expect(out).toBe("<p>ok</p><p>end</p>");
  });

  it("drops event handlers and javascript: links", () => {
    const out = sanitizeEditedEmailHtml(
      `<a href="javascript:alert(1)" onclick="x()">a</a><img src="a.png" onerror='y()'>`
    );
    expect(out).not.toMatch(/onclick|onerror|javascript:/i);
    expect(out).toContain('href="#"');
    expect(out).toContain('src="a.png"');
  });

  it("drops the editor's own markers", () => {
    expect(sanitizeEditedEmailHtml('<body contenteditable="true"><p>x</p></body>')).toBe("<body><p>x</p></body>");
  });
});
