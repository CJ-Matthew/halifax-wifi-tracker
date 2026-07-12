"""One-time Spotify authorization → prints a SPOTIFY_REFRESH_TOKEN.

Run this ONCE on your own machine. It opens the Spotify consent page, catches the
redirect on http://127.0.0.1:8888/callback, exchanges the code, and prints the
long-lived refresh token. Paste that token into:
    - .env/local.env            (local dev)
    - Railway → Variables       (production)
as SPOTIFY_REFRESH_TOKEN.

Prereq: your Spotify app's Settings must list this exact Redirect URI:
    http://127.0.0.1:8888/callback

Usage:
    cd Wifi-Scan
    python3 -m backend.spotify_auth
"""
import base64
import json
import os
import secrets
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

from .supabase_devices import load_env_file

REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPE = "user-read-currently-playing user-read-playback-state"
_AUTH_URL = "https://accounts.spotify.com/authorize"
_TOKEN_URL = "https://accounts.spotify.com/api/token"

_result = {"code": None, "error": None, "state": None}
_expected_state = secrets.token_urlsafe(16)


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _result["code"] = (params.get("code") or [None])[0]
        _result["error"] = (params.get("error") or [None])[0]
        _result["state"] = (params.get("state") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        msg = "Authorization complete — you can close this tab and return to the terminal."
        if _result["error"]:
            msg = f"Authorization failed: {_result['error']}"
        self.wfile.write(f"<html><body style='font-family:sans-serif'>{msg}</body></html>".encode())

    def log_message(self, *args):                # silence the default request logging
        pass


def _exchange_code(code, client_id, client_secret):
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }).encode("utf-8")
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(_TOKEN_URL, data=body, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def main():
    load_env_file()
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not (client_id and client_secret):
        raise SystemExit("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env/local.env first.")

    query = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "state": _expected_state,
        "show_dialog": "true",
    })
    auth_url = f"{_AUTH_URL}?{query}"

    print("Opening the Spotify authorization page in your browser…")
    print("If it doesn't open, paste this URL manually:\n")
    print(auth_url + "\n")
    webbrowser.open(auth_url)

    server = HTTPServer(("127.0.0.1", 8888), _CallbackHandler)
    print("Waiting for the redirect on http://127.0.0.1:8888/callback …")
    while _result["code"] is None and _result["error"] is None:
        server.handle_request()

    if _result["error"]:
        raise SystemExit(f"Authorization failed: {_result['error']}")
    if _result["state"] != _expected_state:
        raise SystemExit("State mismatch — aborting (possible CSRF). Try again.")

    tokens = _exchange_code(_result["code"], client_id, client_secret)
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise SystemExit(f"No refresh_token in response: {tokens}")

    print("\n✅ Success! Add this line to .env/local.env AND to Railway → Variables:\n")
    print(f"SPOTIFY_REFRESH_TOKEN={refresh}\n")


if __name__ == "__main__":
    main()
