import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultResponseLabel } from "@/lib/im-prompt";

/**
 * THE IM PROMPT'S DEFAULT CAPTION — shared by the server (which stores it)
 * and the client preview (which shows it before anything is stored). Both
 * import the SAME function from lib/im-prompt.ts on purpose: two copies of
 * "what caption goes above the rating control" is exactly how a preview
 * quietly stops matching the real thing.
 */

describe("defaultResponseLabel", () => {
  it("captions a rating control", () => {
    expect(defaultResponseLabel("rating")).toBe("How would you rate this?");
  });

  it("captions a text control", () => {
    expect(defaultResponseLabel("text")).toBe("Your answer");
  });

  it("has no caption for none/acknowledge — there's no control to caption", () => {
    expect(defaultResponseLabel("none")).toBeNull();
    expect(defaultResponseLabel("acknowledge")).toBeNull();
  });
});

describe("the server and the preview read the SAME function", () => {
  const server = readFileSync(join(process.cwd(), "src/server/prompts.ts"), "utf8");
  const preview = readFileSync(join(process.cwd(), "src/components/crm/im-prompt-preview.tsx"), "utf8");

  it("both import defaultResponseLabel from lib/im-prompt, not a private copy", () => {
    expect(server).toMatch(/import\s*\{\s*defaultResponseLabel\s*\}\s*from\s*"@\/lib\/im-prompt"/);
    expect(preview).toMatch(/import\s*\{[^}]*defaultResponseLabel[^}]*\}\s*from\s*"@\/lib\/im-prompt"/);
  });

  it("neither file re-declares its own defaultResponseLabel", () => {
    expect(server).not.toMatch(/function defaultResponseLabel/);
    expect(preview).not.toMatch(/function defaultResponseLabel/);
  });
});

describe("the preview shares the real Stars widget", () => {
  const preview = readFileSync(
    join(process.cwd(), "src/components/crm/im-prompt-preview.tsx"), "utf8"
  );
  const pending = readFileSync(
    join(process.cwd(), "src/components/crm/pending-prompt.tsx"), "utf8"
  );

  it("imports Stars rather than re-implementing a star widget", () => {
    expect(preview).toMatch(/import\s*\{\s*Stars\s*\}\s*from\s*"\.\/pending-prompt"/);
    expect(preview).not.toMatch(/function Stars/);
  });

  it("pending-prompt.tsx actually exports it", () => {
    expect(pending).toMatch(/export function Stars/);
  });
});

describe("the preview never calls a real server action", () => {
  const preview = readFileSync(
    join(process.cwd(), "src/components/crm/im-prompt-preview.tsx"), "utf8"
  );

  it("does not import answerImPrompt or skipPrompt", () => {
    // those are the REAL actions — a preview that calls them would file a
    // fake answer against a pending_prompts row that was never created
    expect(preview).not.toMatch(/answerImPrompt|skipPrompt|rateTouchPointFromPrompt/);
    expect(preview).not.toContain('from "@/server/prompts"');
  });

  it("its buttons only toast and close, nothing else", () => {
    expect(preview).toContain("toast.info(msg)");
    expect(preview).toContain("onOpenChange(false)");
  });
});
