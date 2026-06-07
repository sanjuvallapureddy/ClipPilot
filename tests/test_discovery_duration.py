from discovery_orchestrator import discovery


def test_unknown_duration_long_podcast_is_kept_for_chunking(monkeypatch):
    monkeypatch.setenv("DISCOVERY_MIN_DURATION_SEC", "180")
    monkeypatch.setenv("DISCOVERY_MAX_SOURCE_DURATION_SEC", "10800")

    monkeypatch.setattr(
        discovery,
        "_probe_video_metadata",
        lambda url: {"duration": 7200, "view_count": 10_000, "like_count": 100},
    )

    items = discovery._resolve_unknown_durations([
        {
            "video_id": "long",
            "youtube_url": "https://youtube.com/watch?v=long",
            "title": "Two hour podcast",
            "podcast": "Long Show",
            "view_count": 0,
            "like_count": 0,
            "duration": 0,
            "published_at": "now",
        }
    ])

    assert len(items) == 1
    assert items[0]["duration"] == 7200


def test_extremely_long_source_is_dropped(monkeypatch):
    monkeypatch.setenv("DISCOVERY_MIN_DURATION_SEC", "180")
    monkeypatch.setenv("DISCOVERY_MAX_SOURCE_DURATION_SEC", "10800")

    monkeypatch.setattr(
        discovery,
        "_probe_video_metadata",
        lambda url: {"duration": 14_400, "view_count": 10_000, "like_count": 100},
    )

    items = discovery._resolve_unknown_durations([
        {
            "video_id": "too-long",
            "youtube_url": "https://youtube.com/watch?v=too-long",
            "title": "Four hour livestream",
            "podcast": "Long Show",
            "view_count": 0,
            "like_count": 0,
            "duration": 0,
            "published_at": "now",
        }
    ])

    assert items == []


def test_unknown_duration_short_video_is_kept(monkeypatch):
    monkeypatch.setenv("DISCOVERY_MIN_DURATION_SEC", "180")
    monkeypatch.setenv("DISCOVERY_MAX_SOURCE_DURATION_SEC", "10800")

    monkeypatch.setattr(
        discovery,
        "_probe_video_metadata",
        lambda url: {"duration": 900, "view_count": 10_000, "like_count": 100},
    )

    items = discovery._resolve_unknown_durations([
        {
            "video_id": "short",
            "youtube_url": "https://youtube.com/watch?v=short",
            "title": "Fifteen minute interview",
            "podcast": "Short Show",
            "view_count": 0,
            "like_count": 0,
            "duration": 0,
            "published_at": "now",
        }
    ])

    assert len(items) == 1
    assert items[0]["duration"] == 900
