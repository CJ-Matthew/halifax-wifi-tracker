"""Current LED-matrix face, plus a scheduler that flips it at fixed times.

The ESP32 polls GET /display/state and renders whatever face this module reports.
State is a plain in-memory global — single-process http.server means it is shared
across all request threads (guarded by a Lock). Losing it on restart is desired:
the display defaults to `clock`, and a reboot resetting to `clock` is correct.

The schedule is anchored EXPLICITLY to Australia/Sydney (where the display lives),
not the host's local clock — the server runs in US-West California and we must not
add a California offset. A manual POST /display/state overrides stick until the
next boundary: the scheduler only writes on the *transition* into a boundary
minute, so a mid-window manual change is never stomped.
"""

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

# Faces the firmware knows how to render. Slugs must match the firmware's
# `faces[]` ids and the simulator's registered faces.
VALID_FACES = ("clock", "fire")
DEFAULT_FACE = "clock"

# (hour, minute) -> face, evaluated in Australia/Sydney local time.
_SCHEDULE = {
    (23, 30): "fire",
    (6, 0): "clock",
}
_TZ = ZoneInfo("Australia/Sydney")

_lock = threading.Lock()
_state = {"face": DEFAULT_FACE}


def get_face():
    with _lock:
        return _state["face"]


def set_face(face):
    """Set the current face. Returns the new face. Raises ValueError if unknown."""
    face = str(face).strip().lower()
    if face not in VALID_FACES:
        raise ValueError(f"unknown face '{face}'; valid faces: {', '.join(VALID_FACES)}")
    with _lock:
        _state["face"] = face
    return face


def _run():
    # Remember the last boundary we acted on so we fire exactly once per boundary
    # (on the transition into it), leaving manual overrides untouched in between.
    last_fired = None
    while True:
        try:
            now = datetime.now(_TZ)
            key = (now.hour, now.minute)
            if key in _SCHEDULE:
                if key != last_fired:
                    set_face(_SCHEDULE[key])
                    last_fired = key
                    print(f"[display] schedule → {_SCHEDULE[key]} at {now:%Y-%m-%d %H:%M} Sydney")
            else:
                # Outside any boundary minute → arm the boundaries to fire again.
                last_fired = None
        except Exception as exc:  # never let the scheduler thread die
            print(f"[display] scheduler error: {exc}")
        time.sleep(20)


def start():
    thread = threading.Thread(target=_run, daemon=True, name="display-scheduler")
    thread.start()
    return thread
