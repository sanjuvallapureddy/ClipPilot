// Speech-to-text fallback for the copilot chat mic. Browsers without a reliable Web
// Speech API (Firefox, Brave, many Electron webviews) POST a recorded audio blob here;
// we transcribe it with OpenAI and return { text }. Mirrors the graceful key handling in
// app/api/copilotkit/route.ts — no key is ever hardcoded.
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// whisper-1 is the broadly-available transcription model. OPENAI_MODEL (a chat model) is
// intentionally NOT reused here; transcription needs an audio model.
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Transcription unavailable — OPENAI_API_KEY is not set on the server." },
      { status: 503 },
    );
  }

  let file: Blob | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (entry instanceof Blob) file = entry;
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "No audio received." }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Normalize the browser Blob into an Uploadable the SDK accepts on every runtime.
    const type = file.type || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
    const upload = await toFile(Buffer.from(await file.arrayBuffer()), `speech.${ext}`, { type });

    const result = await openai.audio.transcriptions.create({
      file: upload,
      model: TRANSCRIBE_MODEL,
    });

    const text = typeof (result as { text?: unknown }).text === "string" ? (result as { text: string }).text : "";
    return Response.json({ text: text.trim() });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    return Response.json({ error: `Transcription failed: ${msg}` }, { status: 502 });
  }
}
