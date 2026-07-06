"""Current weather + temperature, sourced from the free Open-Meteo API.

Mapped to the three conditions the display understands (sunny / cloudy / rainy)
and cached in-memory so we don't hammer the upstream API — weather changes slowly.
Location defaults to Halifax; override with WEATHER_LAT / WEATHER_LON env vars.
"""
import json
import os
import time
import urllib.request

_CACHE = {"ts": 0.0, "data": None}
_TTL_SECONDS = 600  # 10 minutes


def _condition_from_code(code):
    """Collapse a WMO weather code into sunny / cloudy / rainy."""
    if code in (0, 1):                       # clear / mainly clear
        return "sunny"
    if code in (2, 3, 45, 48):               # partly cloudy / overcast / fog
        return "cloudy"
    return "rainy"                           # drizzle, rain, snow, showers, thunderstorm


def get_weather():
    now = time.time()
    cached = _CACHE["data"]
    if cached is not None and now - _CACHE["ts"] < _TTL_SECONDS:
        return cached

    lat = os.getenv("WEATHER_LAT", "44.6488")
    lon = os.getenv("WEATHER_LON", "-63.5752")
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "wifi-tracker/1.0"})
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))

    current = payload.get("current", {})
    code = int(current.get("weather_code", 0))
    data = {
        "temperature": current.get("temperature_2m"),
        "condition": _condition_from_code(code),
        "code": code,
        "units": payload.get("current_units", {}).get("temperature_2m", "°C"),
    }
    _CACHE["ts"] = now
    _CACHE["data"] = data
    return data
