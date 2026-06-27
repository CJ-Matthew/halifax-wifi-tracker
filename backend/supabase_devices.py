import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


def load_env_file(env_path=".env/local.env"):
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_required_env(name):
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def build_rest_base_url(raw_url):
    cleaned = raw_url.strip().rstrip("/")
    if cleaned.endswith("/rest/v1"):
        return cleaned
    return f"{cleaned}/rest/v1"


def build_table_path(table_name):
    normalized = table_name.strip()
    if not normalized:
        raise ValueError("SUPABASE_TABLE cannot be empty")

    return urllib.parse.quote(normalized, safe="")


def _get_rest_config(table_name=None):
    supabase_url = build_rest_base_url(get_required_env("SUPABASE_URL"))
    supabase_key = get_required_env("SUPABASE_KEY")
    if table_name is None:
        table_name = os.getenv("SUPABASE_TABLE", "devices")
    table_path = build_table_path(table_name)
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    return supabase_url, table_path, headers


def _logs_table_name():
    return os.getenv("SUPABASE_LOGS_TABLE", "logs")


def insert_log(name, mac_address, is_leaving):
    supabase_url, table_path, headers = _get_rest_config(_logs_table_name())
    endpoint = f"{supabase_url}/{table_path}"
    row = {"name": name, "mac_address": mac_address, "is_leaving": bool(is_leaving)}
    payload = json.dumps(row).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")

    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status


def get_last_log_for_mac(mac_address):
    """The most recent presence event for one device, or None."""
    supabase_url, table_path, headers = _get_rest_config(_logs_table_name())
    query = urllib.parse.urlencode(
        {
            "select": "is_leaving,created_at",
            "mac_address": f"eq.{mac_address}",
            "order": "created_at.desc",
            "limit": "1",
        }
    )
    endpoint = f"{supabase_url}/{table_path}?{query}"
    request = urllib.request.Request(endpoint, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
        return payload[0] if isinstance(payload, list) and payload else None


def _seconds_since(iso_ts):
    try:
        ts = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds()


def insert_log_deduped(name, mac_address, is_leaving, window_seconds=30):
    """Log a presence transition, unless it duplicates a very recent one.

    Presence is a toggle, so a device's events must alternate enter/leave. If the
    last logged event is already this same state and happened within
    `window_seconds`, it's a duplicate — typically a second poller (e.g. a
    deployed instance racing local dev) writing the same transition a fraction of
    a second later — so we skip it. The time window keeps us from suppressing a
    *legitimate* repeat (e.g. a stale leave from a previous run, after the
    baseline was seeded silently on restart). Returns None when skipped.
    """
    last = get_last_log_for_mac(mac_address)
    if last is not None and bool(last.get("is_leaving")) == bool(is_leaving):
        elapsed = _seconds_since(last.get("created_at"))
        if elapsed is not None and elapsed < window_seconds:
            return None
    return insert_log(name, mac_address, is_leaving)


def get_recent_logs(limit=5):
    supabase_url, table_path, headers = _get_rest_config(_logs_table_name())
    query = urllib.parse.urlencode(
        {
            "select": "name,mac_address,is_leaving,created_at",
            "order": "created_at.desc",
            "limit": str(limit),
        }
    )
    endpoint = f"{supabase_url}/{table_path}?{query}"
    request = urllib.request.Request(endpoint, headers=headers, method="GET")

    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        payload = json.loads(body)
        return payload if isinstance(payload, list) else []


def get_logs_since(days=7, limit=10000):
    """All presence events newer than `days` ago, oldest-first.

    One query feeds both the 24h Gantt and the roster's 'last seen' lookups —
    fetching a wider slice than the Gantt window lets us seed each bar's left
    edge from the last event *before* the window, and find leaves older than 24h.
    """
    supabase_url, table_path, headers = _get_rest_config(_logs_table_name())
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query = urllib.parse.urlencode(
        {
            "select": "name,mac_address,is_leaving,created_at",
            "created_at": f"gte.{since}",
            "order": "created_at.asc",
            "limit": str(limit),
        }
    )
    endpoint = f"{supabase_url}/{table_path}?{query}"
    request = urllib.request.Request(endpoint, headers=headers, method="GET")

    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        payload = json.loads(body)
        return payload if isinstance(payload, list) else []


def insert_device_name(mac_address, name, colour=None):
    supabase_url, table_path, headers = _get_rest_config()
    headers = {**headers, "Prefer": "return=representation"}

    endpoint = f"{supabase_url}/{table_path}"
    row = {"mac_address": mac_address, "name": name}
    if colour:
        row["colour"] = colour
    payload = json.dumps(row).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")

    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        return response.status, body


def update_device(mac_address, fields):
    supabase_url, table_path, headers = _get_rest_config()
    headers = {**headers, "Prefer": "return=representation"}

    query = urllib.parse.urlencode({"mac_address": f"eq.{mac_address}"})
    endpoint = f"{supabase_url}/{table_path}?{query}"
    payload = json.dumps(fields).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="PATCH")

    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        return response.status, body


def get_registered_devices():
    supabase_url, table_path, headers = _get_rest_config()
    query = urllib.parse.urlencode(
        {
            "select": "mac_address,name,colour",
            "order": "name.asc",
        }
    )
    endpoint = f"{supabase_url}/{table_path}?{query}"
    request = urllib.request.Request(endpoint, headers=headers, method="GET")

    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        payload = json.loads(body)
        if not isinstance(payload, list):
            raise ValueError("Unexpected response format from Supabase")
        return payload


def get_registered_device_map():
    registered_devices = get_registered_devices()
    return {
        entry.get("mac_address"): {
            "mac_address": entry.get("mac_address"),
            "name": entry.get("name"),
            "colour": entry.get("colour"),
        }
        for entry in registered_devices
        if entry.get("mac_address")
    }


def get_connected_registered_devices(connected_devices):
    registered_device_map = get_registered_device_map()
    connected_registered_devices = []

    for device in connected_devices:
        mac_address = device.get("mac_address")
        registered = registered_device_map.get(mac_address)
        if not registered:
            continue

        connected_registered_devices.append(
            {
                "mac_address": mac_address,
                "name": registered.get("name"),
                "colour": registered.get("colour"),
                "ip_address": device.get("ip_address"),
            }
        )

    return connected_registered_devices