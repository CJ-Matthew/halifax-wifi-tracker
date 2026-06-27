import os
import re
import subprocess

from .eero_client import get_connected_macs as _eero_get_connected_macs


ARP_ENTRY_PATTERNS = [
    re.compile(
        r"\? \((?P<ip>\d{1,3}(?:\.\d{1,3}){3})\) at (?P<mac>[0-9a-fA-F:]{17}|<incomplete>) on (?P<interface>\S+)"
    ),
    re.compile(
        r"(?P<ip>\d{1,3}(?:\.\d{1,3}){3})\s+"
        r"(?P<mac>[0-9a-fA-F:]{17}|[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}|<incomplete>)"
    ),
]


def _arp_get_connected_macs():
    arp_output = subprocess.check_output(["arp", "-a"], text=True)
    mac_entries = []
    seen = set()

    for line in arp_output.splitlines():
        match = next((pattern.search(line) for pattern in ARP_ENTRY_PATTERNS if pattern.search(line)), None)
        if not match:
            continue

        ip_address = match.group("ip")
        mac_address = match.group("mac").replace("-", ":").lower()
        if mac_address in {"<incomplete>", "ff:ff:ff:ff:ff:ff"}:
            continue
        if mac_address in seen:
            continue

        seen.add(mac_address)
        mac_entries.append({"ip_address": ip_address, "mac_address": mac_address})

    return mac_entries


def get_connected_macs():
    eero_token = os.getenv("EERO_USER_TOKEN")
    if eero_token:
        return _eero_get_connected_macs(eero_token)
    return _arp_get_connected_macs()