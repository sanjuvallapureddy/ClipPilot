// Upload a clip's video file directly to the active YouTube account (resumable upload via
// the official client). Updates the clip's results:{id} hash to posted on success.
//
// Which file gets uploaded, in priority order:
//   1. an explicit `video_path` in the request body
//   2. the clip's rendered 9:16 short (results.clip_url) if it's a real local file
//   3. the ingested source video at media/{video_id}.mp4 (full episode)
// The vertical clip cutting/reframing itself stays in OpenShorts (golden rule) — this
// route only publishes whatever real file already exists.
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { redis, resultKey } from "@/lib/redis";
import { authedClientForActive, youtubeConfigured } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MEDIA_DIR =
  process.env.CLIPPILOT_MEDIA_DIR || path.resolve(process.cwd(), "..", "media");

function videoIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  } catch {
    /* fall through */
  }
  return url;
}

function resolveFile(
  explicit: string | undefined,
  clip: Record<string, string>,
): { file: string | null; kind: string } {
  if (explicit && fs.existsSync(explicit)) return { file: explicit, kind: "explicit" };
  if (clip.clip_url && fs.existsSync(clip.clip_url))
    return { file: clip.clip_url, kind: "rendered" };
  if (clip.source_url) {
    const vid = videoIdFromUrl(clip.source_url);
    const candidate = path.join(MEDIA_DIR, `${vid}.mp4`);
    if (fs.existsSync(candidate)) return { file: candidate, kind: "source" };
  }
  return { file: null, kind: "none" };
}

export async function POST(req: Request) {
  if (!youtubeConfigured()) {
    return Response.json(
      { error: "YouTube OAuth not configured (set GOOGLE_CLIENT_ID/SECRET)." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const clipId = body.clip_id as string | undefined;
  const explicitPath = body.video_path as string | undefined;
  const privacy = (body.privacy as string) || "private";

  const r = redis();
  let clip: Record<string, string> = {};
  if (clipId) {
    clip = (await r.hgetall(resultKey(clipId))) || {};
    if (!clip || Object.keys(clip).length === 0) {
      return Response.json({ error: `unknown clip ${clipId}` }, { status: 404 });
    }
  }

  const { file, kind } = resolveFile(explicitPath, clip);
  if (!file) {
    return Response.json(
      {
        error:
          "No video file to upload yet. The 9:16 clip render is pending (OpenShorts). " +
          "Run the pipeline so the source video is ingested, or pass an explicit video_path.",
      },
      { status: 409 },
    );
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
    (body.title as string) ||
    clip.title ||
    clip.hook ||
    "ClipPilot upload";
  const description =
    (body.description as string) ||
    [clip.hook, clip.quote && `"${clip.quote}"`, clip.source_url]
      .filter(Boolean)
      .join("\n\n") ||
    "Uploaded by ClipPilot.";
  const tags = (body.tags as string[]) || (clip.topic ? [clip.topic] : []);

  try {
    const yt = google.youtube({ version: "v3", auth: auth.client });
    const res = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title: title.slice(0, 100), description, tags },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(file) },
    });

    const videoId = res.data.id || "";
    const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";

    if (clipId) {
      await r.hset(resultKey(clipId), {
        platform: "youtube",
        post_id: videoId,
        post_status: "posted",
        posted_at: new Date().toISOString(),
        ...(kind === "rendered" ? {} : { clip_url: watchUrl }),
      });
    }

    return Response.json({
      ok: true,
      video_id: videoId,
      watch_url: watchUrl,
      uploaded_file_kind: kind,
      channel: auth.account.channel_title,
      privacy,
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
