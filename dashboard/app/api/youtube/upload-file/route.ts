// Manual upload: take a video file straight from the user's browser (multipart form-data)
// and publish it to the active YouTube account via Data API v3 videos.insert. The file is
// streamed (not buffered whole in memory) so larger mp4s work.
import { Readable } from "stream";
import { google } from "googleapis";
import { authedClientForActive, youtubeConfigured } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!youtubeConfigured()) {
    return Response.json(
      { error: "YouTube OAuth not configured (set GOOGLE_CLIENT_ID/SECRET)." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "a non-empty video file is required" }, { status: 400 });
  }

  let auth: Awaited<ReturnType<typeof authedClientForActive>>;
  try {
    auth = await authedClientForActive();
  } catch (e) {
    if (String((e as Error)?.message) === "reauth_required") {
      return Response.json(
        { error: "This account's session expired. Reconnect it (top-right) and retry." },
        { status: 401 },
      );
    }
    throw e;
  }
  if (!auth) {
    return Response.json(
      { error: "No YouTube account connected. Connect one first." },
      { status: 401 },
    );
  }

  const title =
    (form.get("title") as string) || file.name || "ClipPilot upload";
  const description =
    (form.get("description") as string) || "Uploaded via ClipPilot.";
  const privacy = (form.get("privacy") as string) || "private";
  const tagsRaw = (form.get("tags") as string) || "";
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  try {
    // Convert the browser file's web stream into a Node Readable for googleapis.
    const body = Readable.fromWeb(file.stream() as never);
    const yt = google.youtube({ version: "v3", auth: auth.client });
    const res = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title: title.slice(0, 100), description, tags },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      },
      media: { mimeType: file.type || "video/mp4", body },
    });

    const videoId = res.data.id || "";
    return Response.json({
      ok: true,
      video_id: videoId,
      watch_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      channel: auth.account.channel_title,
      privacy,
      file_name: file.name,
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/youtubeSignupRequired|not.*enabled.*YouTube/i.test(msg)) {
      return Response.json(
        {
          error:
            "This Google account has no YouTube channel yet. Create one at youtube.com " +
            "(sign in → Create a channel), then reconnect and try again.",
        },
        { status: 409 },
      );
    }
    return Response.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
