import { NextResponse } from "next/server";
import { getViewer } from "@/server/data";
import { BLUE_MAN_SYSTEM_PROMPT, buildAssistantContext } from "@/lib/assistant";

export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The Blue Man 🚶 — Gemini (free tier) with Google Search grounding.
 *  Context is rebuilt per request and scoped by the viewer's RBAC. */
export async function POST(req: Request) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return NextResponse.json({ error: "Sign in first 🙂" }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "The Blue Man is missing his GEMINI_API_KEY. Tell the IM director." },
      { status: 500 }
    );
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Say something first 😄" }, { status: 400 });
  }

  const context = await buildAssistantContext(viewer);

  const body = {
    system_instruction: {
      parts: [{ text: `${BLUE_MAN_SYSTEM_PROMPT}\n\n${context}` }],
    },
    contents: messages.slice(-12).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 4000) }],
    })),
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[blue-man] Gemini error", res.status, detail.slice(0, 500));
    return NextResponse.json(
      {
        error:
          res.status === 429
            ? "The Blue Man walked too much today (free-tier limit). Try again in a minute 🚶💨"
            : "The Blue Man tripped over a cable. Try again.",
      },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() || "…I blanked. Ask me again? 🚶";

  return NextResponse.json({ text });
}
