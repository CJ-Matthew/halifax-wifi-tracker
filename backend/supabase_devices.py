import json
import os
import urllib.error
import urllib.parse
import urllib.request


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