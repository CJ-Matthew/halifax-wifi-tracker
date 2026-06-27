import json

from .device_discovery import get_connected_macs
from .eero_client import eero_login, eero_verify, get_raw_devices, save_token_to_env
from .supabase_devices import (
    get_connected_registered_devices,
    get_recent_logs,
    get_registered_devices,
    insert_device_name,
    update_device,
)


def read_json_request(handler):
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return {}

    raw_body = handler.rfile.read(content_length).decode("utf-8", errors="replace")
    if not raw_body.strip():
        return {}

    return json.loads(raw_body)


def validate_registered_device_payload(payload):
    mac_address = str(payload.get("mac_address", "")).strip().lower()
    name = str(payload.get("name", "")).strip()
    colour = str(payload.get("colour", "")).strip() or None

    if not mac_address:
        raise ValueError("mac_address is required")
    if not name:
        raise ValueError("name is required")

    return mac_address, name, colour


def handle_get_devices():
    return 200, {"devices": get_connected_macs()}


def handle_post_registered_devices(payload):
    mac_address, name, colour = validate_registered_device_payload(payload)
    status, response_body = insert_device_name(mac_address, name, colour)

    try:
        parsed_body = json.loads(response_body)
    except json.JSONDecodeError:
        parsed_body = response_body

    return status, parsed_body


def handle_patch_registered_device(payload):
    mac_address = str(payload.get("mac_address", "")).strip().lower()
    if not mac_address:
        raise ValueError("mac_address is required")

    fields = {}
    if "colour" in payload:
        fields["colour"] = str(payload["colour"]).strip()
    if "name" in payload:
        name = str(payload["name"]).strip()
        if not name:
            raise ValueError("name cannot be empty")
        fields["name"] = name

    if not fields:
        raise ValueError("No fields to update")

    status, response_body = update_device(mac_address, fields)

    try:
        parsed_body = json.loads(response_body)
    except json.JSONDecodeError:
        parsed_body = response_body

    return status, parsed_body


def handle_get_registered_devices():
    devices = get_registered_devices()
    return 200, {"registered_devices": devices}


def handle_get_connected_registered_devices():
    connected_devices = get_connected_macs()
    devices = get_connected_registered_devices(connected_devices)
    return 200, {"connected_devices": devices}


def handle_get_logs():
    return 200, {"logs": get_recent_logs(5)}


def handle_get_eero_debug():
    import os
    token = os.getenv("EERO_USER_TOKEN")
    if not token:
        raise ValueError("EERO_USER_TOKEN not set")
    return 200, get_raw_devices(token)


def handle_post_eero_login(payload):
    login_identifier = str(payload.get("login", "")).strip()
    if not login_identifier:
        raise ValueError("login (email or phone) is required")
    eero_login(login_identifier)
    return 200, {"message": "Verification code sent"}


def handle_post_eero_verify(payload):
    code = str(payload.get("code", "")).strip()
    if not code:
        raise ValueError("code is required")
    token = eero_verify(code)
    save_token_to_env(token)
    import os
    os.environ["EERO_USER_TOKEN"] = token
    return 200, {"message": "Eero connected successfully"}