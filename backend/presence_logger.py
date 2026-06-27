"""Background thread that watches who is home and logs enter/leave events.

It scans the network every PRESENCE_POLL_SECONDS, joins against the registered
devices (we only log people we have a name for), and diffs against the previous
scan. Enters are logged immediately; leaves are debounced — a person must be
absent for PRESENCE_LEAVE_SCANS consecutive scans before we log them as gone,
so phones briefly dropping off Wi-Fi don't create false exits.
"""

import os
import threading
import time
import urllib.error

from .device_discovery import get_connected_macs
from .supabase_devices import get_registered_device_map, insert_log_deduped


def _poll_interval():
    return int(os.getenv("PRESENCE_POLL_SECONDS", "5"))


def _leave_threshold():
    # 1 == log a leave the moment a device disappears (no debounce).
    return int(os.getenv("PRESENCE_LEAVE_SCANS", "1"))


def _dedupe_window():
    # Suppress an identical transition logged within this many seconds — guards
    # against duplicate rows when more than one poller writes to the same
    # Supabase (e.g. a deployed instance alongside local dev).
    return int(os.getenv("PRESENCE_DEDUPE_SECONDS", "30"))


def _scan_present():
    """Return {mac: name} for registered devices currently on the network."""
    connected = get_connected_macs()
    registered = get_registered_device_map()
    present = {}
    for device in connected:
        mac = device.get("mac_address")
        registered_entry = registered.get(mac)
        if registered_entry and registered_entry.get("name"):
            present[mac] = registered_entry["name"]
    return present


def run():
    previous = None   # {mac: name} confirmed present on the last settled scan
    missing = {}      # {mac: consecutive scans missing}

    while True:
        try:
            present = _scan_present()

            if previous is None:
                # First scan seeds the baseline silently — no spurious events.
                previous = present
            else:
                # New arrivals: log immediately.
                for mac, name in present.items():
                    if mac not in previous:
                        insert_log_deduped(name, mac, False, _dedupe_window())
                        previous[mac] = name
                    missing.pop(mac, None)

                # Departures: only after being absent for several scans.
                for mac in list(previous.keys()):
                    if mac in present:
                        continue
                    missing[mac] = missing.get(mac, 0) + 1
                    if missing[mac] >= _leave_threshold():
                        insert_log_deduped(previous[mac], mac, True, _dedupe_window())
                        del previous[mac]
                        del missing[mac]
        except urllib.error.HTTPError as exc:  # surface PostgREST's actual message
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            print(f"[presence] scan error: HTTP {exc.code} {exc.reason} {body}")
        except Exception as exc:  # never let the watcher thread die
            print(f"[presence] scan error: {exc}")

        time.sleep(_poll_interval())


def start():
    thread = threading.Thread(target=run, daemon=True, name="presence-logger")
    thread.start()
    return thread
