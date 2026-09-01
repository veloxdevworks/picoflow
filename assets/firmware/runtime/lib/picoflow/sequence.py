# On-device sequence.json loader (CircuitPython stdlib json).
import json

DEFAULT_SETTLE_MS = 1200
DEFAULT_BUTTON_PIN = "GP15"
DEFAULT_RUN_MODE = "auto"
DEFAULT_HID_PROFILE = "absolute_mouse_keyboard"


class Sequence:
    def __init__(self, data):
        if not isinstance(data, dict):
            raise ValueError("sequence must be an object")
        self.version = data.get("version", 1)
        self.run_mode = data.get("run_mode", DEFAULT_RUN_MODE)
        self.settle_ms = int(data.get("settle_ms", DEFAULT_SETTLE_MS))
        self.hid_profile = data.get("hid_profile", DEFAULT_HID_PROFILE)
        self.button_pin = data.get("button_pin", DEFAULT_BUTTON_PIN)
        events = list(data.get("events") or [])
        events.sort(key=lambda event: int(event.get("at_ms", 0)))
        self.events = events


def load(path):
    with open(path, "r") as handle:
        raw = handle.read()
    return Sequence(json.loads(raw))
