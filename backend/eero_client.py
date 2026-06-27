import http.cookiejar
import json
import os
import urllib.request

EERO_API_BASE = "https://api-user.e2ro.com/2.2"

_pending_jar = None


def _opener(jar=None, user_token=None):
    handlers = []
    if jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(jar))
    opener = urllib.request.build_opener(*handlers)
    if user_token:
        opener.addheaders = [("Cookie", f"s={user_token}")]
    return opener


def _request(opener, path, *, method="GET", body=None):
    url = f"{EERO_API_BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method=method
    )
    with opener.open(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def eero_login(login_identifier):
    global _pending_jar
    _pending_jar = http.cookiejar.CookieJar()
    opener = _opener(_pending_jar)
    _request(opener, "/login", method="POST", body={"login": login_identifier})


def eero_verify(code):
    global _pending_jar
    if _pending_jar is None:
        raise ValueError("No pending login — call eero_login first")

    opener = _opener(_pending_jar)
    _request(opener, "/login/verify", method="POST", body={"code": code})

    user_token = next((c.value for c in _pending_jar if c.name == "s"), None)
    _pending_jar = None

    if not user_token:
        raise ValueError("Verification succeeded but no session token was returned")

    return user_token


def _resolve_network_id(opener):
    account = _request(opener, "/account")
    networks = account.get("data", {}).get("networks", {}).get("data", [])
    if not networks:
        raise ValueError("No Eero networks found on this account")

    target_name = os.getenv("EERO_NETWORK_NAME", "").strip().lower()
    if target_name:
        match = next((n for n in networks if n.get("name", "").lower() == target_name), None)
        if not match:
            available = [n.get("name") for n in networks]
            raise ValueError(f"No Eero network named '{target_name}'. Available: {available}")
        network = match
    else:
        network = networks[0]

    return network["url"].rstrip("/").split("/")[-1]


def get_raw_devices(user_token):
    opener = _opener(user_token=user_token)
    network_id = _resolve_network_id(opener)
    return _request(opener, f"/networks/{network_id}/devices")


def get_connected_macs(user_token):
    opener = _opener(user_token=user_token)

    network_id = _resolve_network_id(opener)
    devices_data = _request(opener, f"/networks/{network_id}/devices")

    connected = []
    for device in devices_data.get("data", []):
        if not device.get("connected"):
            continue
        mac = device.get("mac", "").lower()
        if not mac:
            continue
        connected.append({
            "mac_address": mac,
            "ip_address": device.get("ip", ""),
        })

    return connected


def save_token_to_env(token, env_path=".env/local.env"):
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    key = "EERO_USER_TOKEN"
    updated = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
            lines[i] = f"{key}={token}\n"
            updated = True
            break

    if not updated:
        lines.append(f"{key}={token}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
