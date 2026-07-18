"""Current weather + temperature, sourced from the free Open-Meteo API.

Mapped to the three conditions the display understands (sunny / cloudy / rainy)
and cached in-memory so we don't hammer the upstream API — weather changes slowly.
Location defaults to Halifax; override with WEATHER_LAT / WEATHER_LON env vars.
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta

_CACHE = {"ts": 0.0, "data": None}
_TTL_SECONDS = 180  # 3 minutes


def _condition_from_code(code):
    """Collapse a WMO weather code into sunny / cloudy / rainy."""
    if code in (0, 1):                       # clear / mainly clear
        return "sunny"
    if code in (2, 3, 45, 48):               # partly cloudy / overcast / fog
        return "cloudy"
    return "rainy"                           # drizzle, rain, snow, showers, thunderstorm


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _precip_now(current, hourly):
    """Largest precipitation (mm) that applies to the present moment.

    Open-Meteo's `current` block lags real conditions — it routinely still
    reports 0 mm / "partly cloudy" for the first ~15-60 min of a rain event,
    which is exactly when the display fails to show rain. Hourly precipitation
    is a *preceding-hour sum*, so the reading that covers "now" is the next
    hour boundary (e.g. at 08:30 the rain shows up in the 09:00 bucket). We
    take the max of the current reading and that covering bucket so any real
    precipitation is caught.
    """
    precip = _as_float(current.get("precipitation"))

    times = hourly.get("time") or []
    amounts = hourly.get("precipitation") or []
    if times:
        try:
            now = datetime.fromisoformat(current.get("time"))
        except (TypeError, ValueError):
            now = None
        if now is not None:
            # Preceding-hour sum: the bucket covering "now" is the *next* hour
            # boundary (at 03:15 that's the 04:00 reading, spanning 03:00-04:00).
            # The current hour-floor bucket is already fully in the past, so it
            # must NOT count as rain now — doing so left rain on the display for
            # up to an hour after it had stopped.
            floor = now.replace(minute=0, second=0, microsecond=0)
            covering = (floor + timedelta(hours=1)).isoformat(timespec="minutes")
            for t, amt in zip(times, amounts):
                if t == covering:
                    precip = max(precip, _as_float(amt))
                    break

    return precip


def get_weather():
    now = time.time()
    cached = _CACHE["data"]
    if cached is not None and now - _CACHE["ts"] < _TTL_SECONDS:
        return cached

    lat = os.getenv("WEATHER_LAT", "44.6488")
    lon = os.getenv("WEATHER_LON", "-63.5752")
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}&timezone=GMT"
        "&current=temperature_2m,weather_code,precipitation"
        "&hourly=weather_code,precipitation&past_hours=1&forecast_hours=2"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "wifi-tracker/1.0"})
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))

    current = payload.get("current", {})
    code = int(current.get("weather_code", 0))
    condition = _condition_from_code(code)

    # Trust measured precipitation over the (laggy) summary code so that active
    # rain always reaches the display, even while `weather_code` still says dry.
    precip = _precip_now(current, payload.get("hourly", {}))
    if precip > 0:
        condition = "rainy"

    data = {
        "temperature": current.get("temperature_2m"),
        "condition": condition,
        "code": code,
        "precipitation": precip,
        "units": payload.get("current_units", {}).get("temperature_2m", "°C"),
    }
    _CACHE["ts"] = now
    _CACHE["data"] = data
    return data
