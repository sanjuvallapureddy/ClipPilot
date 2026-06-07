"""Lane C — YouTube "Most replayed" peak selection (SOURCE SELECTION only).

YouTube shows a "most replayed" graph on the scrubber (the wavy heatmap that marks the
moments viewers rewatch most). yt-dlp surfaces it as ``info['heatmap']`` — a list of
``{start_time, end_time, value}`` markers where ``value`` is the 0..1 replay intensity.

This module picks the single highest-value marker (the most-rewatched instant) and returns
a bounded window centered on it, so OpenShorts renders the short from the part of the video
the audience actually replays. It does NOT clip, transcribe, reframe, or caption anything —
OpenShorts still does all of that from the bounded source (the golden rule).

Note: "most replayed" is not part of the official YouTube Data API; yt-dlp reads it from the
same InnerTube response YouTube's own web player uses. It is real engagement data — never
simulated. Videos without enough watch data simply expose no heatmap, and callers fall back.

Transcript refinement (SECONDARY): :func:`rank_windows` can take the episode's real caption
segments and gently rerank the heatmap windows — favoring peaks whose words are more
controversial / quotable (:func:`transcript_score`) and vetoing a music-only intro
(:func:`is_music_only`). The heatmap always stays primary: the transcript boost is bounded,
so a clearly taller peak can never be overtaken, and we never invent a window that isn't
anchored on a real replay peak. This is fast pre-selection only — OpenShorts/GPT still does
the real moment detection. No LLM call here.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from shared.redis_client import coord

DEFAULT_WINDOW_SECONDS = int(os.getenv("MOST_REPLAYED_WINDOW_SECONDS", "120"))
# A secondary peak counts as "near-equal" when its replay value is at least this fraction
# of the top peak's value (0.9 -> within 10% of the tallest peak).
DEFAULT_PEAK_SIMILARITY = float(os.getenv("MOST_REPLAYED_PEAK_SIMILARITY", "0.9"))
# Hard cap on how many ~window_seconds chunks we will ever grab from one video.
DEFAULT_MAX_SEGMENTS = int(os.getenv("MOST_REPLAYED_MAX_SEGMENTS", "3"))
# SECONDARY transcript boost weight. final = intensity + WEIGHT * normalized_transcript_score.
# The boost is bounded to [0, WEIGHT]; keep it small so a peak that is more than WEIGHT taller
# always wins (heatmap stays primary). Default 0.25 > the default similarity band spread (0.1),
# so the transcript can still reorder peaks that are already near-equal in replay height.
DEFAULT_TRANSCRIPT_WEIGHT = float(os.getenv("MOST_REPLAYED_TRANSCRIPT_WEIGHT", "0.25"))
# Music-only intro guard: a candidate window starting within the first N seconds is dropped
# only when its captions are music/SFX cues or near-empty (see ``is_music_only``).
DEFAULT_INTRO_SKIP_SECONDS = float(os.getenv("MOST_REPLAYED_INTRO_SKIP_SECONDS", "120"))


@dataclass
class PeakWindow:
    """A bounded source window centered on the most-replayed moment."""

    start: float  # window start, seconds
    end: float  # window end, seconds
    peak: float  # center of the most-replayed marker, seconds
    intensity: float  # 0..1 replay value of that marker

    @property
    def window_seconds(self) -> float:
        return self.end - self.start


def enabled() -> bool:
    """Whether the most-replayed source path is turned on (default: on)."""
    return os.getenv("MOST_REPLAYED_SEGMENTS", "true").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def fetch_heatmap(youtube_url: str) -> tuple[list[dict], float]:
    """Return ``(markers, duration_seconds)`` from yt-dlp. Empty list if none exposed."""
    try:
        import yt_dlp

        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False) or {}
    except Exception as e:
        coord("C", "error", f"most-replayed probe failed: {e}")
        return [], 0.0

    markers = info.get("heatmap") or []
    duration = float(info.get("duration") or 0.0)
    clean = [
        m
        for m in markers
        if isinstance(m, dict)
        and m.get("start_time") is not None
        and m.get("end_time") is not None
    ]
    return clean, duration


def _bounded_window(center: float, duration: float, window_seconds: float) -> tuple[float, float]:
    """Center a ``window_seconds`` window on ``center``, clamped to ``[0, duration]``.

    The returned window always keeps the full ``window_seconds`` width (it slides inward at
    the edges instead of shrinking).
    """
    half = window_seconds / 2.0
    start = center - half
    end = center + half
    if start < 0:
        start, end = 0.0, window_seconds
    if end > duration:
        end, start = duration, max(0.0, duration - window_seconds)
    return start, end


def peak_windows(
    markers: list[dict],
    duration: float,
    *,
    window_seconds: float = DEFAULT_WINDOW_SECONDS,
    similarity: float = DEFAULT_PEAK_SIMILARITY,
    max_segments: int = DEFAULT_MAX_SEGMENTS,
) -> list[PeakWindow]:
    """Return 1..``max_segments`` non-overlapping windows on the most-replayed peaks.

    By default only the single tallest peak's window is returned. Additional peaks are
    included only when their replay ``value`` is "near-equal" to the top peak — at least
    ``similarity * top_value`` (so a couple of equally-rewatched moments each become their
    own ~2-min chunk). Windows whose spans overlap are deduped (the higher peak wins), and
    the total is capped at ``max_segments``. Pure / no network so it stays unit-testable.

    Returns ``[]`` when there is no usable heatmap or the video is already short enough that
    the whole thing should just go to OpenShorts (no segmentation to gain).
    """
    if not markers or duration <= 0 or max_segments < 1:
        return []
    if duration <= window_seconds * 1.1:
        return []

    valued = [(float(m.get("value") or 0.0), m) for m in markers]
    top_value = max(v for v, _ in valued)
    threshold = similarity * top_value
    # Highest peaks first so that when two near-equal peaks overlap, the taller one wins.
    candidates = sorted(
        (vm for vm in valued if vm[0] >= threshold),
        key=lambda vm: vm[0],
        reverse=True,
    )

    accepted: list[PeakWindow] = []
    for value, marker in candidates:
        if len(accepted) >= max_segments:
            break
        center = (float(marker["start_time"]) + float(marker["end_time"])) / 2.0
        start, end = _bounded_window(center, duration, window_seconds)
        if any(start < w.end and w.start < end for w in accepted):
            continue  # overlaps an already-chosen (taller) peak window — dedupe
        accepted.append(
            PeakWindow(
                start=round(start, 1),
                end=round(end, 1),
                peak=round(center, 1),
                intensity=value,
            )
        )

    accepted.sort(key=lambda w: w.start)  # chronological order for clean concat
    return accepted


def peak_window(
    markers: list[dict],
    duration: float,
    *,
    window_seconds: float = DEFAULT_WINDOW_SECONDS,
) -> PeakWindow | None:
    """Center a ``window_seconds`` window on the single most-replayed marker.

    Back-compat wrapper around :func:`peak_windows` (returns just the tallest peak's window,
    or ``None`` when there is no usable heatmap / the video is already short enough).
    """
    wins = peak_windows(
        markers,
        duration,
        window_seconds=window_seconds,
        similarity=1.0,
        max_segments=1,
    )
    return wins[0] if wins else None


# --- Transcript-aware refinement (SECONDARY signal; heatmap stays PRIMARY) ------------
#
# The most-replayed heatmap decides WHERE the audience rewinds — that is always the
# dominant driver. The transcript only refines the ordering among near-equal replay peaks
# and vetoes an obviously-bad window (a music-only intro). It can never invent a window
# that isn't anchored on a real replay peak, nor override a clearly taller peak.

# Strong controversy / shock / high-stakes vocabulary. This is the kind of language that
# rides along with the moments audiences replay, so each hit is a big nudge (token match,
# lower-cased).
_STRONG_WORDS = frozenset({
    # sweeping absolutes (opinion / controversy bait)
    "never", "always", "everyone", "everybody", "nobody", "anyone",
    # right / wrong / truth / lies / exposure
    "wrong", "right", "truth", "lie", "lies", "lying", "liar", "fake", "fraud",
    "honest", "secret", "secrets", "hidden", "exposed", "reveal", "revealed", "proof",
    # shock / strong emotion
    "crazy", "insane", "shocking", "shocked", "unbelievable", "ridiculous", "wild",
    "nuts", "terrifying", "scary", "fear", "afraid", "horror", "hate", "furious",
    "disgusting", "amazing", "incredible",
    # mortality / violence / danger (high stakes)
    "die", "died", "death", "dead", "kill", "killed", "killing", "blood", "war",
    "fight", "destroy", "destroyed", "attack", "dangerous", "danger", "threat",
    # money (always a hook)
    "money", "billion", "billions", "million", "millions", "billionaire",
    "millionaire", "rich", "broke", "poor", "fortune", "bankrupt",
    # profanity (real captions contain these; strong emotional signal)
    "damn", "hell", "crap", "shit", "shitty", "fuck", "fucking", "fucked", "ass",
    "asshole", "bullshit", "bitch", "piss", "dick", "wtf",
})

# Weaker intensifiers / superlatives — punchy, but common enough that they only lightly nudge.
_WEAK_WORDS = frozenset({
    "best", "worst", "most", "biggest", "greatest", "smartest", "dumbest", "ever",
    "literally", "actually", "absolutely", "completely", "totally",
    "huge", "massive", "epic", "ultimate",
})

# Multi-word hooks (substring match on the lower-cased text).
_PUNCHY_PHRASES = (
    "no one", "oh my god", "shut up", "i swear", "the truth", "you're wrong",
    "nobody tells you", "the secret", "what the", "blew my mind", "changed my life",
    "i can't believe", "you won't believe",
)

# Music symbols that mark non-spoken audio in caption tracks (♪ ♫ 🎵 🎶).
_MUSIC_SYMBOLS = ("\u266a", "\u266b", "\U0001f3b5", "\U0001f3b6")
# A span with fewer real spoken words than this (after stripping caption cues) is "music only".
_MIN_SPEECH_WORDS = 5
_SENT_END = (".", "!", "?")


def _proper_noun_count(text: str) -> int:
    """Count capitalized, mid-sentence words (named-entity-ish). Soft signal, capped at 10.

    Proper nouns (people, brands, places) tend to show up in quotable moments. We skip
    sentence-initial capitals (just grammar) and the pronoun "I". Only meaningful when the
    transcript preserves case (Whisper does; YouTube auto-captions often do not) — it is a
    bonus signal, never required.
    """
    count = 0
    sentence_start = True
    for tok in text.split():
        word = tok.strip("\"'.,!?;:()[]{}")
        if not word:
            if tok.endswith(_SENT_END):
                sentence_start = True
            continue
        if (
            not sentence_start
            and word[0].isupper()
            and word[1:].islower()
            and word != "I"
        ):
            count += 1
        sentence_start = tok.endswith(_SENT_END)
    return min(count, 10)


def transcript_score(text: str) -> float:
    """Heuristic "punchiness" of caption text — higher = more controversial / quotable.

    PURE and fast (no LLM): OpenShorts/GPT still does the real moment detection. This is a
    transparent pre-selection signal so that, among near-equal replay peaks, we lean toward
    the one whose words are more controversial / high-intensity / quotable. Returns a raw,
    non-negative weighted hit count; :func:`rank_windows` normalizes it across the candidate
    set before applying the (bounded) boost.

    Signals (additive; strong vocabulary dominates so bland-but-wordy windows don't win):
      * strong controversy / shock / stakes / money / profanity words   (x3.0 each)
      * weak intensifiers / superlatives                                (x1.0 each)
      * multi-word hooks ("the truth", "no one", ...)                   (x3.0 each)
      * exclamation marks                                               (x1.5 each)
      * question marks                                                  (x1.0 each)
      * ALL-CAPS "shouted" words                                        (x1.0 each)
      * named-entity-ish Capitalized words (capped)                     (x0.4 each)
      * direct-quote pairs                                              (x1.0 each)
    """
    if not text or not text.strip():
        return 0.0
    lowered = text.lower()
    words = re.findall(r"[a-z']+", lowered)
    if not words:
        return 0.0

    strong = sum(1 for w in words if w in _STRONG_WORDS)
    weak = sum(1 for w in words if w in _WEAK_WORDS)
    phrases = sum(lowered.count(p) for p in _PUNCHY_PHRASES)
    exclaim = text.count("!")
    question = text.count("?")
    caps_shout = sum(1 for w in re.findall(r"[A-Za-z]{2,}", text) if w.isupper())
    proper = _proper_noun_count(text)
    quotes = text.count('"') // 2 + text.count("\u201c")  # straight + “smart” open quotes

    return (
        3.0 * strong
        + 1.0 * weak
        + 3.0 * phrases
        + 1.5 * exclaim
        + 1.0 * question
        + 1.0 * caps_shout
        + 0.4 * proper
        + 1.0 * quotes
    )


def segments_in_window(
    segments: list[tuple[float, str]], window: PeakWindow
) -> list[tuple[float, str]]:
    """The caption segments whose timestamps fall inside ``window`` (pure helper)."""
    return [(t, txt) for t, txt in segments if window.start <= t < window.end]


def _window_text(segments: list[tuple[float, str]], window: PeakWindow) -> str:
    return " ".join(txt for _, txt in segments_in_window(segments, window))


def is_music_only(segments_in_span: list[tuple[float, str]]) -> bool:
    """True when a span carries no meaningful speech — empty, or only music / SFX cues.

    Used ONLY to veto a first-N-minutes window (e.g. an intro jingle). Caption tracks mark
    non-spoken audio with bracketed / parenthesized cues ("[Music]", "[Applause]",
    "(upbeat music)") and music symbols (♪). We strip those and count what real words
    remain; fewer than ``_MIN_SPEECH_WORDS`` means music-only.

    An empty span (no caption lines at all in this slice) counts as music / dead-air for
    THIS per-window check. The *whole-video* "no captions anywhere" case is handled
    separately in :func:`rank_windows`, so a caption-less video is never wrongly nuked.
    """
    if not segments_in_span:
        return True
    real_words = 0
    for _, txt in segments_in_span:
        low = re.sub(r"\[.*?\]", " ", txt.lower())  # [music], [applause], [laughter], ...
        low = re.sub(r"\(.*?\)", " ", low)          # (music), (crosstalk), ...
        for sym in _MUSIC_SYMBOLS:
            low = low.replace(sym, " ")
        real_words += len(re.findall(r"[a-z']+", low))
    return real_words < _MIN_SPEECH_WORDS


def rank_windows(
    windows: list[PeakWindow],
    segments: list[tuple[float, str]],
    *,
    intro_skip_seconds: float = DEFAULT_INTRO_SKIP_SECONDS,
    transcript_weight: float = DEFAULT_TRANSCRIPT_WEIGHT,
    max_segments: int | None = None,
) -> list[PeakWindow]:
    """Refine heatmap windows with the transcript. Heatmap stays PRIMARY. Pure / no network.

    Steps:
      1. Music-only intro guard — drop any window that begins within the first
         ``intro_skip_seconds`` AND whose captions are music-only / no real speech, so we
         never ship an intro-jingle clip. Never drops the last window standing.
      2. Combined score = ``intensity + transcript_weight * normalized_transcript_score``,
         where the transcript score is normalized to ``[0, 1]`` across the candidate set.
         Because the boost is bounded to ``[0, transcript_weight]``, any peak that is more
         than ``transcript_weight`` taller than another ALWAYS outranks it — the transcript
         can never override the heatmap, only reorder peaks that are already near-equal in
         replay height (the similarity band).
      3. Optionally cap to ``max_segments`` (the transcript decides which near-equal peaks
         survive the cap), returning the survivors best-first.

    Graceful fallback: if there are NO captions for the whole video we cannot tell speech
    from music, so we trust the heatmap and keep its windows as-is (only honoring the cap by
    replay height). The injected ``segments`` keep this unit-testable with no network.
    """
    if not windows:
        return []
    windows = list(windows)

    # Graceful fallback: no captions anywhere -> trust the heatmap, do not reorder/nuke.
    if not segments:
        if max_segments is not None and len(windows) > max_segments:
            keep = set(
                sorted(range(len(windows)), key=lambda i: windows[i].intensity,
                       reverse=True)[:max_segments]
            )
            return [w for i, w in enumerate(windows) if i in keep]
        return windows

    # 1) Music-only intro guard (only first-N-minutes windows are eligible to be dropped).
    survivors = [
        w
        for w in windows
        if not (
            w.start < intro_skip_seconds
            and is_music_only(segments_in_window(segments, w))
        )
    ]
    survivors = survivors or windows  # never nuke everything — heatmap is primary

    # 2) Combined score: heatmap intensity (primary) + bounded transcript boost (secondary).
    raws = [transcript_score(_window_text(segments, w)) for w in survivors]
    max_raw = max(raws) if raws else 0.0

    def combined(i: int) -> float:
        norm = (raws[i] / max_raw) if max_raw > 0 else 0.0
        return survivors[i].intensity + transcript_weight * norm

    # Stable sort: peaks with equal combined score keep their chronological order.
    order = sorted(range(len(survivors)), key=combined, reverse=True)
    ranked = [survivors[i] for i in order]

    # 3) Cap (best-first, so the transcript chooses which near-equal peaks survive).
    if max_segments is not None:
        ranked = ranked[:max_segments]
    return ranked


def select_peak_window(
    youtube_url: str,
    *,
    window_seconds: float = DEFAULT_WINDOW_SECONDS,
) -> PeakWindow | None:
    """Network helper: fetch the heatmap and return the peak window (or ``None``)."""
    markers, duration = fetch_heatmap(youtube_url)
    win = peak_window(markers, duration, window_seconds=window_seconds)
    if win:
        coord(
            "C",
            "info",
            f"most-replayed peak {win.intensity:.2f} at {win.peak / 60:.2f}m "
            f"-> window {win.start / 60:.2f}-{win.end / 60:.2f}m",
        )
    return win
