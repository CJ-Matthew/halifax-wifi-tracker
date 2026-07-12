"""Spotify "now playing" for the LED-matrix display.

Holds the OAuth refresh token (SPOTIFY_REFRESH_TOKEN, minted once via
spotify_auth.py) and, on demand, swaps it for a short-lived access token to call
GET /v1/me/player/currently-playing. Results are cached briefly so the ESP32's
poll (and the separate art fetch) don't hammer the upstream API.

The album cover is resized here — the ESP32 never decodes JPEG. We download the
smallest Spotify image, resize it to 30×30 with Pillow, and expose it as raw
RGB565 bytes (big-endian, 900 pixels = 1800 bytes) that the firmware blits directly.

State the display cares about:
    active    — is a track loaded at all? (False when Spotify is closed/idle → 204)
    playing   — is it actually playing right now? (False when paused)
    title, artist, duration_ms, progress_ms, track_id, has_art

Env:
    SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET  — from the developer dashboard
    SPOTIFY_REFRESH_TOKEN                     — from spotify_auth.py (one-time)
"""
import base64
import io
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    from PIL import Image
    _HAVE_PIL = True
except ImportError:                              # art disabled, metadata still works
    _HAVE_PIL = False

ART_SIZE = 30                                     # px — matches the firmware album buffer
_TOKEN_URL = "https://accounts.spotify.com/api/token"
_NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing"

_STATE_TTL = 2.0                                  # s — cache now-playing between polls

_lock = threading.Lock()
_access = {"token": None, "expires_at": 0.0}      # cached access token
_state_cache = {"ts": 0.0, "data": None}          # cached now-playing state
_art_cache = {"track_id": None, "bytes": None}     # RGB565 art for the current track


def _client_creds():
    cid = os.getenv("SPOTIFY_CLIENT_ID")
    secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    refresh = os.getenv("SPOTIFY_REFRESH_TOKEN")
    return cid, secret, refresh


def is_configured():
    cid, secret, refresh = _client_creds()
    return bool(cid and secret and refresh)


def _get_access_token():
    """Return a valid access token, refreshing via the refresh token if needed."""
    with _lock:
        now = time.time()
        if _access["token"] and now < _access["expires_at"] - 30:
            return _access["token"]

        cid, secret, refresh = _client_creds()
        if not (cid and secret and refresh):
            raise RuntimeError("Spotify not configured (missing client id/secret/refresh token)")

        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh,
        }).encode("utf-8")
        auth = base64.b64encode(f"{cid}:{secret}".encode("utf-8")).decode("ascii")
        req = urllib.request.Request(_TOKEN_URL, data=body, headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))

        _access["token"] = payload["access_token"]
        _access["expires_at"] = now + int(payload.get("expires_in", 3600))
        return _access["token"]


def _smallest_image_url(images):
    """Spotify returns images largest-first; the last is the smallest (≈64×64)."""
    if not images:
        return None
    return sorted(images, key=lambda im: im.get("width") or 0)[0].get("url")


def _rgb565_bytes(image):
    """Resize a PIL image to ART_SIZE² and pack as big-endian RGB565 bytes."""
    img = image.convert("RGB").resize((ART_SIZE, ART_SIZE), Image.LANCZOS)
    out = bytearray(ART_SIZE * ART_SIZE * 2)
    px = img.load()
    i = 0
    for y in range(ART_SIZE):
        for x in range(ART_SIZE):
            r, g, b = px[x, y]
            c = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
            out[i] = (c >> 8) & 0xFF            # big-endian: high byte first
            out[i + 1] = c & 0xFF
            i += 2
    return bytes(out)


def _build_art(track_id, images):
    """Fetch + resize this track's cover into RGB565, cached by track_id."""
    if not _HAVE_PIL:
        return None
    with _lock:
        if _art_cache["track_id"] == track_id and _art_cache["bytes"] is not None:
            return _art_cache["bytes"]
    url = _smallest_image_url(images)
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "led-matrix/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
        data = _rgb565_bytes(Image.open(io.BytesIO(raw)))
    except Exception as exc:                     # bad image / network → no art, not fatal
        print(f"[spotify] art build failed: {exc}")
        return None
    with _lock:
        _art_cache["track_id"] = track_id
        _art_cache["bytes"] = data
    return data


def get_now_playing():
    """Current state for GET /spotify/state. Cached for _STATE_TTL seconds."""
    now = time.time()
    cached = _state_cache["data"]
    if cached is not None and now - _state_cache["ts"] < _STATE_TTL:
        return cached

    if not is_configured():
        data = {"active": False, "playing": False, "configured": False}
        _state_cache.update(ts=now, data=data)
        return data

    token = _get_access_token()
    req = urllib.request.Request(_NOW_PLAYING_URL, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            status = resp.status
            body = resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 401:                      # token rejected — drop it, next poll refreshes
            with _lock:
                _access["token"] = None
        raise

    # 204 (No Content) or empty body → nothing is playing (Spotify closed / idle).
    if status == 204 or not body:
        data = {"active": False, "playing": False}
        _state_cache.update(ts=now, data=data)
        return data

    payload = json.loads(body.decode("utf-8", errors="replace"))
    item = payload.get("item")
    if not item:                                 # ads / podcast with no track item
        data = {"active": False, "playing": False}
        _state_cache.update(ts=now, data=data)
        return data

    track_id = item.get("id")
    images = (item.get("album") or {}).get("images") or []
    art = _build_art(track_id, images)
    data = {
        "active": True,
        "playing": bool(payload.get("is_playing")),
        "title": item.get("name", ""),
        "artist": ", ".join(a.get("name", "") for a in item.get("artists", [])) or "",
        "duration_ms": item.get("duration_ms", 0),
        "progress_ms": payload.get("progress_ms", 0),
        "track_id": track_id,
        "has_art": art is not None,
    }
    _state_cache.update(ts=now, data=data)
    return data


def get_art_bytes():
    """Raw RGB565 bytes for the current track's cover, or None. Refreshes state first."""
    get_now_playing()                            # ensures _art_cache matches the current track
    with _lock:
        return _art_cache["bytes"]
