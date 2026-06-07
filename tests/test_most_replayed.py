"""Offline tests for the most-replayed peak window selection (engine/most_replayed.py).

These exercise the pure selection math with synthetic heatmaps — no network, no yt-dlp.
The real YouTube heatmap fetch (yt_dlp.extract_info) is covered by the live engine path.
"""
from engine.most_replayed import (
    PeakWindow,
    is_music_only,
    peak_window,
    peak_windows,
    rank_windows,
    transcript_score,
)


def test_centers_window_on_the_highest_marker():
    markers = [
        {"start_time": 0, "end_time": 20, "value": 0.1},
        {"start_time": 360, "end_time": 380, "value": 0.9},  # the peak
        {"start_time": 500, "end_time": 520, "value": 0.3},
    ]
    win = peak_window(markers, duration=600, window_seconds=120)
    assert win is not None
    center = (win.start + win.end) / 2
    assert abs(center - 370) < 1.0  # centered on the 360–380 marker
    assert round(win.window_seconds) == 120
    assert isinstance(win, PeakWindow)


def test_clamps_window_to_start_when_peak_is_early():
    markers = [
        {"start_time": 0, "end_time": 20, "value": 1.0},  # peak at the very start
        {"start_time": 300, "end_time": 320, "value": 0.2},
    ]
    win = peak_window(markers, duration=600, window_seconds=120)
    assert win is not None
    assert win.start == 0.0
    assert win.end == 120.0


def test_clamps_window_to_end_when_peak_is_late():
    markers = [
        {"start_time": 580, "end_time": 600, "value": 1.0},  # peak at the very end
        {"start_time": 0, "end_time": 20, "value": 0.2},
    ]
    win = peak_window(markers, duration=600, window_seconds=120)
    assert win is not None
    assert win.end == 600.0
    assert round(win.start) == 480


def test_short_video_returns_none():
    # Video already shorter than the window — hand the whole thing to OpenShorts.
    markers = [{"start_time": 0, "end_time": 20, "value": 1.0}]
    assert peak_window(markers, duration=90, window_seconds=120) is None


def test_no_heatmap_returns_none():
    assert peak_window([], duration=600, window_seconds=120) is None
    assert peak_window([{"start_time": 0, "end_time": 5, "value": 0.5}], duration=0) is None


# --- peak_windows (multi-peak selection) ---------------------------------------------


def test_single_dominant_peak_returns_one_window():
    markers = [
        {"start_time": 0, "end_time": 20, "value": 0.2},
        {"start_time": 600, "end_time": 620, "value": 1.0},  # clearly the tallest
        {"start_time": 1200, "end_time": 1220, "value": 0.3},
    ]
    wins = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.9, max_segments=3
    )
    assert len(wins) == 1
    assert abs((wins[0].start + wins[0].end) / 2 - 610) < 1.0


def test_three_near_equal_peaks_far_apart_return_three_windows():
    markers = [
        {"start_time": 300, "end_time": 320, "value": 1.0},
        {"start_time": 900, "end_time": 920, "value": 0.98},
        {"start_time": 1500, "end_time": 1520, "value": 0.95},
        {"start_time": 1700, "end_time": 1720, "value": 0.2},  # too low, excluded
    ]
    wins = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.9, max_segments=3
    )
    assert len(wins) == 3
    # Returned in chronological order, non-overlapping.
    assert [round(w.peak) for w in wins] == [310, 910, 1510]
    for a, b in zip(wins, wins[1:]):
        assert a.end <= b.start


def test_near_equal_peaks_that_overlap_are_deduped():
    # Two near-equal peaks only 30s apart -> their 120s windows overlap -> one window kept.
    markers = [
        {"start_time": 600, "end_time": 620, "value": 1.0},
        {"start_time": 630, "end_time": 650, "value": 0.97},  # within a window of the first
        {"start_time": 1400, "end_time": 1420, "value": 0.95},  # far away, kept
    ]
    wins = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.9, max_segments=3
    )
    assert len(wins) == 2
    # The taller (value 1.0) of the overlapping pair wins.
    assert abs(wins[0].peak - 610) < 1.0
    assert abs(wins[1].peak - 1410) < 1.0


def test_max_segments_cap_is_respected():
    markers = [
        {"start_time": 200, "end_time": 220, "value": 1.0},
        {"start_time": 600, "end_time": 620, "value": 0.99},
        {"start_time": 1000, "end_time": 1020, "value": 0.98},
        {"start_time": 1400, "end_time": 1420, "value": 0.97},
    ]
    wins = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.9, max_segments=2
    )
    assert len(wins) == 2
    # The two tallest peaks are chosen (200 and 600), returned chronologically.
    assert [round(w.peak) for w in wins] == [210, 610]


def test_similarity_threshold_excludes_lower_peaks():
    markers = [
        {"start_time": 300, "end_time": 320, "value": 1.0},
        {"start_time": 900, "end_time": 920, "value": 0.85},  # below 0.9 * top -> excluded
        {"start_time": 1500, "end_time": 1520, "value": 0.95},  # >= 0.9 * top -> kept
    ]
    wins = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.9, max_segments=3
    )
    assert len(wins) == 2
    assert [round(w.peak) for w in wins] == [310, 1510]
    # Lowering the bar pulls the 0.85 peak in too.
    loose = peak_windows(
        markers, duration=1800, window_seconds=120, similarity=0.8, max_segments=3
    )
    assert len(loose) == 3


def test_short_video_and_empty_return_empty_list():
    markers = [{"start_time": 0, "end_time": 20, "value": 1.0}]
    assert peak_windows(markers, duration=90, window_seconds=120) == []
    assert peak_windows([], duration=600, window_seconds=120) == []
    assert peak_windows(markers, duration=0, window_seconds=120) == []


def test_peak_window_singular_matches_first_of_plural():
    markers = [
        {"start_time": 0, "end_time": 20, "value": 0.1},
        {"start_time": 360, "end_time": 380, "value": 0.9},
        {"start_time": 500, "end_time": 520, "value": 0.85},
    ]
    win = peak_window(markers, duration=600, window_seconds=120)
    assert win is not None
    assert isinstance(win, PeakWindow)
    # Singular grabs only the single tallest peak even though 0.85 is near-equal.
    assert abs(win.peak - 370) < 1.0


# --- transcript_score (pure punchiness heuristic) ------------------------------------


def test_transcript_score_rewards_punchy_controversial_text():
    punchy = (
        "This is INSANE! Nobody tells you the truth — it's all lies. "
        "Absolutely crazy how much money is involved."
    )
    bland = (
        "So then we walked over to the table and sat down and had a calm quiet chat "
        "about the weather and the schedule for tomorrow."
    )
    assert transcript_score(punchy) > transcript_score(bland)
    # Empty / whitespace text is a hard zero (no signal).
    assert transcript_score("") == 0.0
    assert transcript_score("   ") == 0.0
    # A bland window with comparable length still scores well below the punchy one.
    assert transcript_score(bland) < transcript_score(punchy)


def test_transcript_score_monotonic_with_added_signals():
    base = "we talked about the plan for the trip and where to eat"
    hotter = base + " it was the most shocking insane secret nobody tells you"
    assert transcript_score(hotter) > transcript_score(base)


# --- is_music_only (pure non-speech detection) ---------------------------------------


def test_is_music_only_detects_music_and_empty_spans():
    assert is_music_only([]) is True  # empty span -> dead air / music for this check
    assert is_music_only([(0.0, "[Music]")]) is True
    assert is_music_only([(0.0, "♪ ♪ ♪"), (5.0, "[Applause]")]) is True
    assert is_music_only([(0.0, "(upbeat music)")]) is True
    assert is_music_only([(0.0, "[Intro music] ♪"), (3.0, "♫")]) is True


def test_is_music_only_allows_real_speech():
    speech = [
        (0.0, "welcome everybody to the show today we have an incredible guest"),
        (4.0, "and we are going to talk about something nobody expected"),
    ]
    assert is_music_only(speech) is False
    # A music marker followed by real talking is still speech.
    assert is_music_only([(0.0, "[Music] alright so here is the real story everyone")]) is False


# --- rank_windows (heatmap primary, transcript secondary) ----------------------------

# A punchy vs. a bland caption line we reuse across the rerank tests.
_PUNCHY = "This is INSANE! Nobody tells you the truth and it is all lies — absolutely crazy."
_BLAND = "so anyway we kept driving and then we parked the car near the building and waited."


def test_rank_windows_prefers_punchier_among_near_equal_peaks():
    # Two near-equal replay peaks; the later window's captions are far punchier.
    w_bland = PeakWindow(start=300, end=420, peak=360, intensity=1.0)
    w_punchy = PeakWindow(start=900, end=1020, peak=960, intensity=0.96)
    segments = [(360, _BLAND), (960, _PUNCHY)]
    ranked = rank_windows(
        [w_bland, w_punchy], segments, intro_skip_seconds=120, transcript_weight=0.25
    )
    # Within the similarity band, the punchier transcript wins the top slot.
    assert ranked[0].peak == 960
    assert {w.peak for w in ranked} == {360, 960}  # both kept (no cap), just reordered


def test_rank_windows_keeps_clearly_taller_peak_despite_blander_transcript():
    # Heatmap primacy: a 0.5 gap is larger than the 0.25 transcript weight, so the taller
    # (but blander) peak can never be overtaken.
    w_tall_bland = PeakWindow(start=300, end=420, peak=360, intensity=1.0)
    w_short_punchy = PeakWindow(start=900, end=1020, peak=960, intensity=0.5)
    segments = [(360, _BLAND), (960, _PUNCHY)]
    ranked = rank_windows(
        [w_tall_bland, w_short_punchy], segments,
        intro_skip_seconds=120, transcript_weight=0.25,
    )
    assert ranked[0].peak == 360


def test_rank_windows_skips_music_only_intro_for_later_real_speech():
    # The tallest peak sits in a music-only intro; a later real-speech peak must win.
    intro = PeakWindow(start=20, end=140, peak=60, intensity=1.0)
    later = PeakWindow(start=900, end=1020, peak=960, intensity=0.92)
    segments = [
        (30, "[Music]"),
        (60, "♪ ♪"),
        (110, "[Applause]"),
        (960, "honestly this is the craziest most shocking story i have ever told here"),
    ]
    ranked = rank_windows(
        [intro, later], segments, intro_skip_seconds=120, transcript_weight=0.25
    )
    assert [w.peak for w in ranked] == [960]  # intro music window dropped entirely


def test_rank_windows_keeps_intro_when_it_has_real_speech():
    # Real speech in the first 2 minutes is allowed (only music-only intros are dropped).
    intro = PeakWindow(start=20, end=140, peak=60, intensity=1.0)
    later = PeakWindow(start=900, end=1020, peak=960, intensity=0.92)
    segments = [
        (40, "welcome back everyone this is the most shocking interview we have ever done"),
        (960, "and then the whole story completely fell apart on live television"),
    ]
    ranked = rank_windows(
        [intro, later], segments, intro_skip_seconds=120, transcript_weight=0.25
    )
    assert {w.peak for w in ranked} == {60, 960}  # nothing dropped
    assert ranked[0].peak == 60  # intensity 1.0 stays on top


def test_rank_windows_preserves_heatmap_order_when_no_captions():
    # No captions for the whole video -> graceful fallback: windows untouched, order intact.
    w1 = PeakWindow(start=300, end=420, peak=360, intensity=1.0)
    w2 = PeakWindow(start=900, end=1020, peak=960, intensity=0.95)
    w3 = PeakWindow(start=1500, end=1620, peak=1560, intensity=0.92)
    windows = [w1, w2, w3]
    ranked = rank_windows(windows, [], intro_skip_seconds=120, transcript_weight=0.25)
    assert ranked == windows
    assert [w.peak for w in ranked] == [360, 960, 1560]


def test_rank_windows_cap_keeps_tallest_then_punchier_of_the_rest():
    # Capping among near-equal peaks: the clearly-tallest stays #1 (primacy); for the two
    # equal-height peaks the punchier transcript takes the remaining slot.
    tall = PeakWindow(start=300, end=420, peak=360, intensity=1.0)
    mid_bland = PeakWindow(start=900, end=1020, peak=960, intensity=0.7)
    mid_punchy = PeakWindow(start=1500, end=1620, peak=1560, intensity=0.7)
    segments = [
        (360, "this is the most shocking insane secret money story i have ever heard wow"),
        (960, "we drove to the store and bought milk and bread then walked back home calmly"),
        (1560, "nobody tells you the truth it is all lies absolutely insane and crazy money"),
    ]
    ranked = rank_windows(
        [tall, mid_bland, mid_punchy], segments,
        intro_skip_seconds=120, transcript_weight=0.25, max_segments=2,
    )
    assert [w.peak for w in ranked] == [360, 1560]  # tallest first, then the punchier 0.7
    assert all(w.peak != 960 for w in ranked)  # the blander 0.7 peak is dropped by the cap


def test_rank_windows_empty_input_returns_empty():
    assert rank_windows([], [(0.0, _PUNCHY)]) == []
    assert rank_windows([], []) == []
