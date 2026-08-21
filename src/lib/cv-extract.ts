import "server-only";

/** CV auto-analysis (v26 — Consideration module). Sends the uploaded CV to
 *  Gemini 2.5 Flash (same REST pattern as /api/assistant) and extracts the
 *  structured fields the CV pool lists and The Violet Man searches:
 *  name / phone / email / best-match industry / skills / summary / full text.
 *
 *  PDF + images go as inline_data; text-ish files (txt/md/html/csv…) as plain
 *  text; anything else (docx…) is "unsupported" — the row stays manual. */

export const CV_INDUSTRIES = [
  "Marketing",
  "IT/Software",
  "Engineering",
  "Education",
  "Healthcare",
  "Law",
  "Finance",
  "Business",
  "Design",
  "Other",
] as const;

export interface CvExtractedFields {
  person_name: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  skills: string | null;
  summary: string | null;
  full_text: string | null;
}

export type CvExtraction =
  | { status: "done"; fields: CvExtractedFields }
  | { status: "failed"; error: string }
  | { status: "unsupported" };

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const TEXTUAL_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/rtf",
]);

function isTextual(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXTUAL_MIMES.has(mimeType);
}

const PROMPT = `You are reading ONE person's CV/resume. Extract this exact JSON object (null for anything not present):
{
  "person_name": "the person's full name",
  "phone": "their phone number WITH country code if visible (e.g. +201234567890)",
  "email": "their email address",
  "industry": "the SINGLE best match for their professional field from EXACTLY this list: ${CV_INDUSTRIES.join(", ")}",
  "skills": "comma-separated list of their concrete skills/technologies (e.g. C#, ERP, AutoCAD, digital marketing)",
  "summary": "a 2-sentence plain-English summary of who they are and what they do",
  "full_text": "the CV's FULL plain text content, transcribed"
}
Return ONLY the JSON object.`;

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Snap the model's industry guess onto the official pick-list. */
function matchIndustry(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const n = norm(raw);
  for (const ind of CV_INDUSTRIES) {
    if (norm(ind) === n || norm(ind).includes(n) || n.includes(norm(ind))) return ind;
  }
  // common aliases the model may emit anyway
  if (/(software|tech|developer|programming|data)/.test(raw.toLowerCase())) return "IT/Software";
  if (/(medical|medicine|pharma|nurs)/.test(raw.toLowerCase())) return "Healthcare";
  if (/(legal)/.test(raw.toLowerCase())) return "Law";
  if (/(account|bank|audit)/.test(raw.toLowerCase())) return "Finance";
  return "Other";
}

export async function extractCv(input: {
  mimeType: string;
  dataBase64?: string;
  text?: string;
}): Promise<CvExtraction> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { status: "failed", error: "GEMINI_API_KEY is not configured." };

  const mime = (input.mimeType || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const inline = mime === "application/pdf" || mime.startsWith("image/");
  const textual = input.text != null || isTextual(mime);
  if (!inline && !textual) return { status: "unsupported" };

  // build the user parts: the prompt + the CV (inline bytes or plain text)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text: PROMPT }];
  if (inline) {
    if (!input.dataBase64) return { status: "failed", error: "No file data to analyze." };
    parts.push({ inline_data: { mime_type: mime, data: input.dataBase64 } });
  } else {
    const text =
      input.text ??
      (input.dataBase64 ? Buffer.from(input.dataBase64, "base64").toString("utf-8") : "");
    if (!text.trim()) return { status: "failed", error: "The file is empty." };
    parts.push({ text: `--- CV CONTENT ---\n${text.slice(0, 100_000)}` });
  }

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[cv-extract] Gemini error", res.status, detail.slice(0, 300));
      return {
        status: "failed",
        error:
          res.status === 429
            ? "The AI hit its free-tier limit — re-run the extraction in a minute."
            : `The AI analysis failed (HTTP ${res.status}).`,
      };
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!raw) return { status: "failed", error: "The AI returned nothing — try re-running." };

    // responseMimeType makes this JSON, but strip stray code fences defensively
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return { status: "failed", error: "The AI answer was not valid JSON — try re-running." };
    }

    return {
      status: "done",
      fields: {
        person_name: clamp(parsed.person_name, 200),
        phone: clamp(parsed.phone, 40),
        email: clamp(parsed.email, 200),
        industry: matchIndustry(parsed.industry),
        skills: clamp(parsed.skills, 2000),
        summary: clamp(parsed.summary, 1000),
        full_text: clamp(parsed.full_text, 60_000),
      },
    };
  } catch (e) {
    console.error("[cv-extract] request failed:", e);
    return { status: "failed", error: "Could not reach the AI — check the connection and re-run." };
  }
}
